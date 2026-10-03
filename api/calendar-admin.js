const crypto = require('crypto');

function getAdminPasswords() {
  if (!process.env.CALENDAR_ADMIN_PASSWORDS) return [];

  try {
    const passwords = JSON.parse(process.env.CALENDAR_ADMIN_PASSWORDS);
    if (!Array.isArray(passwords) || passwords.length === 0 ||
        passwords.some((password) => typeof password !== 'string' || password.length === 0 || password.length > 128)) {
      return [];
    }
    return passwords;
  } catch {
    return [];
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const passwords = getAdminPasswords();
  if (passwords.length === 0) {
    return res.status(503).json({ error: 'Admin access is not configured' });
  }

  const candidate = req.body && req.body.password;
  if (typeof candidate !== 'string' || candidate.length > 128) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  const candidateBuffer = Buffer.from(candidate);
  let authorized = false;
  for (const password of passwords) {
    const passwordBuffer = Buffer.from(password);
    if (candidateBuffer.length === passwordBuffer.length && crypto.timingSafeEqual(candidateBuffer, passwordBuffer)) {
      authorized = true;
    }
  }

  if (!authorized) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  return res.status(200).json({ authorized: true });
};