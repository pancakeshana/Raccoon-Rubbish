const fetch = require('node-fetch');
const cheerio = require('cheerio');
const ical = require('node-ical');
const NodeCache = require('node-cache');

// Cache lives for the lifetime of the serverless instance (~minutes)
const cache = new NodeCache({ stdTTL: 60 * 30 }); // 30 minutes

function normalizeEvent({ id, title, org, date, time, location, description, sourceUrl }) {
  return {
    id,
    title: (title || 'Untitled').trim(),
    org,
    date,                 // YYYY-MM-DD
    time: time || '',
    location: location || 'TBA',
    description: description || '',
    sourceUrl,
    isManual: false
  };
}

// ---------- VGDC ----------
async function scrapeVGDC() {
  const url = 'https://www.vgdc.dev/events';
  try {
    const res = await fetch(url, { timeout: 8000 });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Keep a reliable known event + any others you can parse
    const events = [
      normalizeEvent({
        id: 'vgdc-fall-gbm-2026',
        title: 'Fall GBM',
        org: 'VGDC',
        date: '2026-10-02',
        time: '7:00 PM - 10:00 PM',
        location: 'Multipurpose Room',
        description: 'Join us Friday, October 2nd in the Multipurpose Room (MPR) to see what VGDC has planned for the quarter, and enjoy some FREE PANDA EXPRESS!!',
        sourceUrl: url
      })
    ];

    return events;
  } catch (err) {
    console.error('VGDC scrape failed:', err.message);
    return [];
  }
}

// ---------- ACM ----------
async function scrapeACM() {
  const url = 'https://acmucsd.com/events';
  try {
    // For now we return the known current events.
    // You can later improve the cheerio selectors.
    return [
      normalizeEvent({
        id: 'acm-census-2026',
        title: 'ACM Fall 2026 Census',
        org: 'ACM',
        date: '2026-09-28',
        time: 'All day',
        location: 'UCSD',
        description: 'ACM Fall 2026 Census',
        sourceUrl: url
      }),
      normalizeEvent({
        id: 'acm-bitbyte-2026',
        title: 'Bit-Byte Info Session',
        org: 'ACM',
        date: '2026-10-03',
        time: '5:00 PM - 7:00 PM',
        location: 'Qualcomm Room',
        description: 'Bit-Byte Info Session',
        sourceUrl: url
      }),
      normalizeEvent({
        id: 'acm-bonfire-2026',
        title: 'Bonfire',
        org: 'ACM',
        date: '2026-10-04',
        time: '5:00 PM - 9:00 PM',
        location: 'La Jolla Shores',
        description: 'ACM Bonfire at La Jolla Shores',
        sourceUrl: url
      })
    ];
  } catch (err) {
    console.error('ACM scrape failed:', err.message);
    return [];
  }
}

// ---------- WIC (Google Calendar ICS – most reliable) ----------
async function scrapeWIC() {
  const icsUrl =
    'https://calendar.google.com/calendar/ical/b26bef81734ab97310db8207bc9121bbd10e83cff8e05cdb009fe82b64fb5f6e%40group.calendar.google.com/public/basic.ics';

  try {
    const data = await ical.async.fromURL(icsUrl);
    const events = [];

    for (const key of Object.keys(data)) {
      const ev = data[key];
      if (ev.type !== 'VEVENT' || !ev.start) continue;

      const start = new Date(ev.start);
      const date = start.toISOString().slice(0, 10);

      events.push(
        normalizeEvent({
          id: `wic-${ev.uid || date + '-' + (ev.summary || '').slice(0, 20)}`,
          title: ev.summary || 'WIC Event',
          org: 'WIC',
          date,
          time: start.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
          }),
          location: ev.location || 'TBA',
          description: (ev.description || '').replace(/\n/g, ' ').slice(0, 300),
          sourceUrl: 'https://wicucsd.vercel.app/events'
        })
      );
    }
    return events;
  } catch (err) {
    console.error('WIC ICS failed:', err.message);
    return [];
  }
}

// ---------- Serverless handler ----------
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Return cached result if available
    const cached = cache.get('all-events');
    if (cached) {
      return res.status(200).json(cached);
    }

    const [vgdc, acm, wic] = await Promise.all([
      scrapeVGDC(),
      scrapeACM(),
      scrapeWIC()
    ]);

    const all = [...vgdc, ...acm, ...wic];

    // Simple deduplication
    const seen = new Set();
    const unique = all.filter((e) => {
      const key = `${e.title}|${e.date}|${e.org}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    cache.set('all-events', unique);
    return res.status(200).json(unique);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
};