const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.CALENDAR_ADMIN_PASSWORD;
  if (!expected) {
    return res.status(503).json({ error: 'Admin access is not configured' });
  }

  const candidate = req.body && req.body.password;
  if (typeof candidate !== 'string' || candidate.length > 128) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  const matches = candidateBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, expectedBuffer);

  if (!matches) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  return res.status(200).json({ authorized: true });
};