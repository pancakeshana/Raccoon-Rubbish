const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const ical = require('node-ical');
const NodeCache = require('node-cache');

const app = express();
const cache = new NodeCache({ stdTTL: 60 * 30 }); // cache 30 minutes

app.use(cors()); // allow your frontend origin

// ---------- Helpers ----------
function normalizeEvent({ id, title, org, date, time, location, description, sourceUrl }) {
  return {
    id,
    title: title?.trim() || 'Untitled',
    org,
    date,               // YYYY-MM-DD
    time: time || '',
    location: location || 'TBA',
    description: description || '',
    sourceUrl,
    isManual: false
  };
}

// ---------- VGDC scraper ----------
async function scrapeVGDC() {
  const url = 'https://www.vgdc.dev/events';
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  const events = [];

  // The page structure changes, so we look for the main event cards
  $('a[href*="/events/"]').each((i, el) => {
    const card = $(el);
    const title = card.find('h3').first().text().trim();
    const location = card.find('h4').first().text().trim();
    const dateTimeText = card.find('h4').eq(1).text().trim() || card.text();

    // Very rough date extraction – improve with better selectors or regex
    const dateMatch = dateTimeText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
    // For production you would parse more carefully or use a date library

    if (title) {
      events.push(normalizeEvent({
        id: `vgdc-${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        title,
        org: 'VGDC',
        date: '2026-10-02', // fallback – replace with real parsed date
        time: dateTimeText,
        location,
        description: card.find('p').text().trim(),
        sourceUrl: url
      }));
    }
  });

  // Hard-code the known good event as a reliable seed while you refine the parser
  events.push(normalizeEvent({
    id: 'vgdc-fall-gbm-2026',
    title: 'Fall GBM',
    org: 'VGDC',
    date: '2026-10-02',
    time: '7:00 PM - 10:00 PM',
    location: 'Multipurpose Room',
    description: 'Join us Friday, October 2nd… FREE PANDA EXPRESS!!',
    sourceUrl: url
  }));

  return events;
}

// ---------- ACM scraper ----------
async function scrapeACM() {
  const url = 'https://acmucsd.com/events';
  const res = await fetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  const events = [];

  // ACM renders events with month/day headings
  // This is a simplified example – inspect the live HTML and adjust selectors
  $('h3, [class*="event"]').each((i, el) => {
    const text = $(el).text().trim();
    if (text.length > 5 && text.length < 80) {
      // Very naive – in practice you walk the DOM more carefully
    }
  });

  // Reliable seed from current page content
  const known = [
    {
      id: 'acm-census-2026',
      title: 'ACM Fall 2026 Census',
      org: 'ACM',
      date: '2026-09-28',
      time: 'All day',
      location: 'UCSD',
      description: 'ACM Fall 2026 Census',
      sourceUrl: url
    },
    {
      id: 'acm-bitbyte-2026',
      title: 'Bit-Byte Info Session',
      org: 'ACM',
      date: '2026-10-02',
      time: '5:00 PM - 7:00 PM',
      location: 'Qualcomm Room',
      description: 'Bit-Byte Info Session',
      sourceUrl: url
    },
    {
      id: 'acm-bonfire-2026',
      title: 'Bonfire',
      org: 'ACM',
      date: '2026-10-03',
      time: '5:00 PM - 9:00 PM',
      location: 'La Jolla Shores',
      description: 'ACM Bonfire',
      sourceUrl: url
    }
  ];

  return known.map(normalizeEvent);
}

// ---------- WIC via Google Calendar ICS (best method) ----------
async function scrapeWIC() {
  // Public ICS feed discovered from their site
  const icsUrl = 'https://calendar.google.com/calendar/ical/b26bef81734ab97310db8207bc9121bbd10e83cff8e05cdb009fe82b64fb5f6e%40group.calendar.google.com/public/basic.ics';

  const data = await ical.async.fromURL(icsUrl);
  const events = [];

  for (const k of Object.keys(data)) {
    const ev = data[k];
    if (ev.type !== 'VEVENT') continue;

    const start = ev.start;
    const date = start.toISOString().slice(0, 10); // YYYY-MM-DD

    events.push(normalizeEvent({
      id: `wic-${ev.uid || date + '-' + ev.summary}`,
      title: ev.summary || 'WIC Event',
      org: 'WIC',
      date,
      time: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      location: ev.location || 'TBA',
      description: (ev.description || '').slice(0, 300),
      sourceUrl: 'https://wicucsd.vercel.app/events'
    }));
  }

  return events;
}

// ---------- Main endpoint ----------
app.get('/api/events', async (req, res) => {
  try {
    const cached = cache.get('all-events');
    if (cached) return res.json(cached);

    const [vgdc, acm, wic] = await Promise.all([
      scrapeVGDC().catch(e => { console.error('VGDC failed', e); return []; }),
      scrapeACM().catch(e => { console.error('ACM failed', e); return []; }),
      scrapeWIC().catch(e => { console.error('WIC failed', e); return []; })
    ]);

    const all = [...vgdc, ...acm, ...wic];

    // Deduplicate by title + date (simple)
    const seen = new Set();
    const unique = all.filter(e => {
      const key = `${e.title}|${e.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    cache.set('all-events', unique);
    res.json(unique);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.get('/', (req, res) => res.send('Campus Events API is running'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));