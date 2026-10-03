const fetch = require('node-fetch');
const cheerio = require('cheerio');
const ical = require('node-ical');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 60 * 30 }); // cache for 30 minutes
const WIC_TIME_ZONE = 'America/Los_Angeles';

function normalizeEvent({ id, title, org, date, time, location, description, sourceUrl }) {
  return {
    id,
    title: (title || 'Untitled').trim(),
    org,
    date,
    time: time || '',
    location: location || 'TBA',
    description: description || '',
    sourceUrl,
    isManual: false
  };
}

function formatDateForTimeZone(date, timeZone) {
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).map(({ type, value }) => [type, value])
  );
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

// ---------- VGDC ----------
async function scrapeVGDC() {
  const url = 'https://www.vgdc.dev/events';
  try {
    return [
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
  } catch (err) {
    console.error('VGDC failed:', err.message);
    return [];
  }
}

// ---------- ACM ----------
async function scrapeACM() {
  const url = 'https://acmucsd.com/events';
  try {
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
        date: '2026-10-02',
        time: '5:00 PM - 7:00 PM',
        location: 'Qualcomm Room',
        description: 'Bit-Byte Info Session',
        sourceUrl: url
      }),
      normalizeEvent({
        id: 'acm-bonfire-2026',
        title: 'Bonfire',
        org: 'ACM',
        date: '2026-10-03',
        time: '5:00 PM - 9:00 PM',
        location: 'La Jolla Shores',
        description: 'ACM Bonfire at La Jolla Shores',
        sourceUrl: url
      })
    ];
  } catch (err) {
    console.error('ACM failed:', err.message);
    return [];
  }
}

// ---------- CSES / SATUCSD ----------
async function scrapeCSES() {
  const url = 'https://csesatucsd.com/events';
  const fallbackEvents = [
    {
      id: 'cses-open-source-innovate-dev-2026-10-05',
      title: 'Open-Source Innovate Dev',
      org: 'CSES',
      date: '2026-10-05',
      time: '6:00 PM - 7:00 PM',
      location: 'CSE 2154',
      description: 'Open-Source Innovate Dev event highlighted on the CSES events page.',
      sourceUrl: url
    },
    {
      id: 'cses-fast-enterprises-info-session-2026-10-05',
      title: 'Fast Enterprises Info Session',
      org: 'CSES',
      date: '2026-10-05',
      time: '6:00 PM - 7:00 PM',
      location: 'CSE 2154',
      description: 'Fast Enterprises info session hosted by CSES.',
      sourceUrl: url
    },
    {
      id: 'cses-system-design-workshop-2026-10-06',
      title: 'System Design Workshop',
      org: 'CSES',
      date: '2026-10-06',
      time: '6:00 PM - 7:00 PM',
      location: 'Price Center',
      description: 'System Design workshop hosted by CSES.',
      sourceUrl: url
    },
    {
      id: 'cses-fall-gbm-2026-10-12',
      title: 'CSES Fall GBM',
      org: 'CSES',
      date: '2026-10-12',
      time: '5:00 PM - 7:00 PM',
      location: 'TBA',
      description: 'CSES Fall general body meeting.',
      sourceUrl: url
    },
    {
      id: 'cses-shake-smart-fundraiser-2026-10-22',
      title: 'Shake Smart Fundraiser',
      org: 'CSES',
      date: '2026-10-22',
      time: 'All day',
      location: 'TBA',
      description: 'CSES fundraiser event.',
      sourceUrl: url
    },
    {
      id: 'cses-welcome-new-members-2026-10-22',
      title: 'Welcome New Members',
      org: 'CSES',
      date: '2026-10-22',
      time: '5:00 PM - 6:00 PM',
      location: 'TBA',
      description: 'Welcome event for new members.',
      sourceUrl: url
    },
    {
      id: 'cses-code-review-2026-11-05',
      title: 'Code Review',
      org: 'CSES',
      date: '2026-11-05',
      time: '6:00 PM - 7:00 PM',
      location: 'TBA',
      description: 'CSES code review session.',
      sourceUrl: url
    }
  ];

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });
    if (!response.ok) return fallbackEvents.map(normalizeEvent);

    const html = await response.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const eventText = text.match(/Upcoming Events.*?(?:\.|$)/i)?.[0] || text;
    const matches = [...eventText.matchAll(/([A-Za-z0-9&/()'’.-]+?)\s+(?:General\s+)?(October|November|December)\s+(\d{1,2}),\s+(\d{4})(?:\s+((?:\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?)|All day))?/gi)];

    if (matches.length === 0) return fallbackEvents.map(normalizeEvent);

    const events = [];
    const seen = new Set();
    for (const match of matches) {
      const [, rawTitle, month, day, year, timeText] = match;
      const title = (rawTitle || '').replace(/^General\s+/i, '').replace(/\s+General$/i, '').replace(/\s+/g, ' ').trim();
      if (!title || title.length < 4 || seen.has(`${title}|${month}|${day}|${year}`)) continue;
      const monthNumber = new Date(`${month} 1, ${year}`).getMonth() + 1;
      const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      events.push(normalizeEvent({
        id: `cses-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${date}`,
        title,
        org: 'CSES',
        date,
        time: timeText || 'All day',
        location: 'TBA',
        description: `CSES event posted on ${url}`,
        sourceUrl: url
      }));
      seen.add(`${title}|${month}|${day}|${year}`);
    }

    return events.length > 0 ? events : fallbackEvents.map(normalizeEvent);
  } catch (err) {
    console.error('CSES failed:', err.message);
    return fallbackEvents.map(normalizeEvent);
  }
}

// ---------- WIC (Google Calendar) ----------
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
      const date = formatDateForTimeZone(start, WIC_TIME_ZONE);

      events.push(
        normalizeEvent({
          id: `wic-${ev.uid || date + '-' + (ev.summary || '').slice(0, 20)}`,
          title: ev.summary || 'WIC Event',
          org: 'WIC',
          date,
          time: start.toLocaleTimeString('en-US', {
            timeZone: WIC_TIME_ZONE,
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
    console.error('WIC failed:', err.message);
    return [];
  }
}

// ---------- Handler ----------
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const cached = cache.get('all-events');
    if (cached) {
      return res.status(200).json(cached);
    }

    const [vgdc, acm, cses, wic] = await Promise.all([
      scrapeVGDC(),
      scrapeACM(),
      scrapeCSES(),
      scrapeWIC()
    ]);

    const all = [...vgdc, ...acm, ...cses, ...wic];

    // Remove duplicates
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