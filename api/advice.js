const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const DATABASE_NAME = process.env.MONGODB_DB || 'raccoontips';
const ALLOWED_COLORS = new Set(['#FEF08A', '#BAE6FD', '#BBF7D0', '#FBCFE8', '#E9D5FF']);

let clientPromise;
let collectionPromise;
let rateLimitCollectionPromise;

async function getAdviceCollection() {
  if (!process.env.MONGODB_URI) {
    const error = new Error('MONGODB_URI is not configured');
    error.statusCode = 503;
    throw error;
  }

  if (!clientPromise) {
    clientPromise = new MongoClient(process.env.MONGODB_URI).connect().catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  }

  if (!collectionPromise) {
    collectionPromise = clientPromise.then(async (client) => {
      const collection = client.db(DATABASE_NAME).collection('advice_notes');
      await collection.createIndex({ clientId: 1 }, { unique: true, sparse: true });
      await collection.createIndex({ createdAt: -1 });
      return collection;
    }).catch((error) => {
      collectionPromise = undefined;
      throw error;
    });
  }

  return collectionPromise;
}

async function isWithinSubmissionLimit(headers) {
  if (!rateLimitCollectionPromise) {
    rateLimitCollectionPromise = clientPromise.then(async (client) => {
      const collection = client.db(DATABASE_NAME).collection('advice_rate_limits');
      await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      return collection;
    }).catch((error) => {
      rateLimitCollectionPromise = undefined;
      throw error;
    });
  }

  const forwardedFor = headers['x-forwarded-for'];
  const ip = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : 'unknown';
  const window = Math.floor(Date.now() / 60000);
  const key = crypto.createHash('sha256').update(`${ip}:${window}`).digest('hex');
  const collection = await rateLimitCollectionPromise;

  try {
    await collection.updateOne(
      { _id: key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * 60000) } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    await collection.updateOne({ _id: key }, { $inc: { count: 1 } });
  }

  const usage = await collection.findOne({ _id: key });
  return usage.count <= 10;
}

function toNote(document) {
  return {
    id: document._id.toString(),
    text: document.text,
    author: document.author,
    color: document.color,
    date: document.date,
    createdAt: document.createdAt.getTime()
  };
}

function isValidDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) &&
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
}

function passwordsMatch(candidate, expected) {
  if (typeof candidate !== 'string' || !expected) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const collection = await getAdviceCollection();

    if (req.method === 'GET') {
      const documents = await collection.find({}).sort({ createdAt: -1 }).limit(500).toArray();
      return res.status(200).json({ notes: documents.map(toNote) });
    }

    if (req.method === 'POST') {
      const { text, author, color, date, clientId } = req.body || {};
      const cleanText = typeof text === 'string' ? text.trim() : '';
      const cleanAuthor = typeof author === 'string' ? author.trim() : '';

      if (!cleanText || cleanText.length > 280 || cleanAuthor.length > 40 ||
          !ALLOWED_COLORS.has(color) || !isValidDate(date) ||
          typeof clientId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(clientId)) {
        return res.status(400).json({ error: 'Invalid note details' });
      }
      if (!await isWithinSubmissionLimit(req.headers)) {
        return res.status(429).json({ error: 'Please wait before submitting another note' });
      }

      const document = {
        text: cleanText,
        author: cleanAuthor || 'Anonymous',
        color,
        date,
        clientId,
        createdAt: new Date()
      };

      try {
        await collection.updateOne({ clientId }, { $setOnInsert: document }, { upsert: true });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }

      const saved = await collection.findOne({ clientId });
      return res.status(200).json({ note: toNote(saved) });
    }

    const adminPassword = process.env.ADVICE_ADMIN_PASSWORD;
    if (!adminPassword) {
      return res.status(503).json({ error: 'Advice deletion is not configured' });
    }
    if (!passwordsMatch(req.headers['x-admin-password'], adminPassword)) {
      return res.status(403).json({ error: 'Admin password required' });
    }

    const { id } = req.body || {};
    if (typeof id !== 'string' || !ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid note ID' });
    }

    const result = await collection.deleteOne({ _id: new ObjectId(id) });
    if (!result.deletedCount) return res.status(404).json({ error: 'Note not found' });
    return res.status(200).json({ deleted: true });
  } catch (error) {
    console.error('Advice API failed:', error);
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Advice service unavailable' });
  }
};