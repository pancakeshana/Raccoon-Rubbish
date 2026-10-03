const crypto = require('crypto');
const fetch = require('node-fetch');

const MAX_SUBMISSIONS_PER_MINUTE = 10;
const ALLOWED_COLORS = new Set(['#FEF08A', '#BAE6FD', '#BBF7D0', '#FBCFE8', '#E9D5FF']);
const NOTE_COLUMNS = 'id,text,author,color,date,created_at';

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isLocalDevelopmentHostname(hostname = '') {
  const normalized = hostname.toLowerCase().split(':')[0];
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized.endsWith('.local');
}

function getSupabaseConfig() {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw createError(503, 'Advice service is not configured');

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw createError(503, 'Advice service is not configured');
  }
  if ((url.protocol !== 'https:' && url.hostname !== 'localhost') || url.origin !== baseUrl) {
    throw createError(503, 'Advice service is not configured');
  }
  return { baseUrl, serviceKey };
}

function supabaseRequest(path, options = {}) {
  const { baseUrl, serviceKey } = getSupabaseConfig();
  return fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...options.headers
    },
    timeout: 5000
  });
}

function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor !== 'string') return null;
  return forwardedFor.split(',').map((ip) => ip.trim()).filter(Boolean).pop() || null;
}

async function verifyTurnstile(token, ip, hostname) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (isLocalDevelopmentHostname(hostname) && (!secret || !process.env.TURNSTILE_SITE_KEY)) {
    return true;
  }
  if (!secret || !process.env.TURNSTILE_SITE_KEY) return false;

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    timeout: 5000
  });
  if (!response.ok) return false;

  const result = await response.json();
  return result.success && result.hostname === hostname && result.action === 'advice_submit';
}

function formatDateForTimeZone(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toNote(record) {
  return {
    id: record.id,
    text: record.text,
    author: record.author,
    color: record.color,
    date: record.date,
    createdAt: Date.parse(record.created_at)
  };
}

module.exports = async (req, res) => {
  res.setHeader(
    'Cache-Control',
    req.method === 'GET' ? 'public, s-maxage=15, stale-while-revalidate=60' : 'no-store'
  );

  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const localDev = isLocalDevelopmentHostname(req.headers.host || '');

    if (req.method === 'GET') {
      try {
        const { baseUrl } = getSupabaseConfig();
        const response = await supabaseRequest(
          `advice_notes?select=${NOTE_COLUMNS}&order=created_at.desc&limit=500`
        );
        if (!response.ok) throw createError(502, 'Could not load community notes');
        const records = await response.json();
        return res.status(200).json({
          notes: records.map(toNote),
          turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || (localDev ? '1x00000000000000000000AA' : null)
        });
      } catch (error) {
        if (localDev) {
          return res.status(200).json({
            notes: [],
            turnstileSiteKey: '1x00000000000000000000AA'
          });
        }
        throw error;
      }
    }

    const allowedOrigin = process.env.ADVICE_ALLOWED_ORIGIN;
    let originUrl;
    try {
      originUrl = new URL(allowedOrigin);
    } catch {
      return res.status(503).json({ error: 'Advice submissions are not configured' });
    }
    if (originUrl.origin !== allowedOrigin || req.headers.origin !== allowedOrigin) {
      return res.status(403).json({ error: 'Request origin is not allowed' });
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      return res.status(415).json({ error: 'JSON requests are required' });
    }

    const { text, author, color, turnstileToken } = req.body || {};
    const cleanText = typeof text === 'string' ? text.trim() : '';
    const cleanAuthor = typeof author === 'string' ? author.trim() : '';
    if (!cleanText || cleanText.length > 280 || cleanAuthor.length > 40 || !ALLOWED_COLORS.has(color)) {
      return res.status(400).json({ error: 'Invalid note details' });
    }
    if (typeof turnstileToken !== 'string' || turnstileToken.length > 2048) {
      return res.status(400).json({ error: 'Complete the verification challenge' });
    }

    const ip = getRequestIp(req);
    const rateLimitSecret = process.env.ADVICE_RATE_LIMIT_SECRET;
    if (!ip || !rateLimitSecret) {
      return res.status(503).json({ error: 'Advice submissions are not configured' });
    }

    let verified = false;
    try {
      verified = await verifyTurnstile(turnstileToken, ip, originUrl.hostname);
    } catch {
      return res.status(503).json({ error: 'Verification service is unavailable' });
    }
    if (!verified) return res.status(403).json({ error: 'Verification failed; please try again' });

    const ipHash = crypto.createHmac('sha256', rateLimitSecret).update(ip).digest('hex');
    const limitResponse = await supabaseRequest('rpc/consume_advice_rate_limit', {
      method: 'POST',
      body: JSON.stringify({ p_ip_hash: ipHash })
    });
    if (!limitResponse.ok) throw createError(502, 'Could not apply submission limit');
    if (!await limitResponse.json()) {
      res.setHeader('Retry-After', String(60 - Math.floor((Date.now() % 60000) / 1000)));
      return res.status(429).json({ error: 'Please wait before submitting another note' });
    }

    const createdAt = new Date();
    const response = await supabaseRequest(`advice_notes?select=${NOTE_COLUMNS}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        text: cleanText,
        author: cleanAuthor || 'Anonymous',
        color,
        date: formatDateForTimeZone(createdAt, 'America/Los_Angeles')
      })
    });
    if (!response.ok) throw createError(502, 'Could not save this note');

    const [record] = await response.json();
    return res.status(201).json({ note: toNote(record) });
  } catch (error) {
    console.error('Advice API request failed');
    return res.status(error.statusCode || 503).json({ error: error.statusCode ? error.message : 'Advice service unavailable' });
  }
};