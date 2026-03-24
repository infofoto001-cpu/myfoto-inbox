const { createClient } = require('redis');

const LINE_TOKEN = 'qf72BVH/RuT1PFJJhQ56R6Mtii5Dcl7etMc6dBdV/c/XW8ZCgGXKr1zYJsYIkXL2po5U+Ej/M7WY5UCn/vvmCjmGDhKEnHJiVDOzVcHTPNd93kEhyI3K6uUg0CkdXJdph0ofE1Z6RZOu27FvXWapLAdB04t89/1O/w1cDnyilFU=';

let _redis = null;
async function getRedis() {
  if (_redis) return _redis;
  _redis = createClient({ url: process.env.REDIS_URL });
  _redis.on('error', () => { _redis = null; });
  await _redis.connect();
  return _redis;
}

async function getLineProfile(userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_TOKEN}` }
    });
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

async function sendLineMessage(userId, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_TOKEN}`
    },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] })
  });
  return res.ok;
}

async function getAllConvs(redis) {
  const keys = await redis.keys('conv:*');
  if (!keys.length) return [];
  const convs = await Promise.all(keys.map(k => redis.get(k).then(v => v ? JSON.parse(v) : null)));
  return convs.filter(Boolean).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const redis = await getRedis();
  const action = req.query.action || (req.body && req.body.action);

  // ── SSE stream for realtime updates ──
  if (req.method === 'GET' && action === 'stream') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial data immediately
    const initial = await getAllConvs(redis);
    res.write(`data: ${JSON.stringify({ type: 'inbox', data: initial })}\n\n`);

    // Subscribe to Redis pub/sub for new messages
    const sub = _redis.duplicate();
    await sub.connect();
    await sub.subscribe('myfoto:updates', async (msg) => {
      try {
        const payload = JSON.parse(msg);
        if (payload.type === 'new_message') {
          const convs = await getAllConvs(redis);
          res.write(`data: ${JSON.stringify({ type: 'inbox', data: convs })}\n\n`);
          if (payload.userId) {
            const raw = await redis.get(`conv:${payload.userId}`);
            if (raw) res.write(`data: ${JSON.stringify({ type: 'conv', data: JSON.parse(raw) })}\n\n`);
          }
        }
      } catch(e) {}
    });

    // Keep alive ping every 20s
    const ping = setInterval(() => {
      res.write(': ping\n\n');
    }, 20000);

    req.on('close', async () => {
      clearInterval(ping);
      await sub.unsubscribe();
      await sub.disconnect();
    });
    return;
  }

  // ── GET all conversations ──
  if (req.method === 'GET' && action === 'getInbox') {
    const convs = await getAllConvs(redis);
    return res.json(convs);
  }

  // ── GET single conversation ──
  if (req.method === 'GET' && action === 'getConv') {
    const { userId } = req.query;
    const raw = await redis.get(`conv:${userId}`);
    return res.json(raw ? JSON.parse(raw) : null);
  }

  // ── POST new message from Make ──
  if (req.method === 'POST' && !action) {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'bad json' }); }
    }

    const { userId, userMessage, aiDraft: rawDraft, displayName } = body || {};
    if (!userId || !userMessage) return res.status(400).json({ error: 'missing fields' });

    const aiDraft = (rawDraft || '').replace(/^\*{1,3}\s*/gm, '').replace(/\*{1,3}$/gm, '').trim();

    const profile = await getLineProfile(userId);
    const name = profile?.displayName || displayName || 'ลูกค้า';
    const picture = profile?.pictureUrl || null;

    const key = `conv:${userId}`;
    const raw = await redis.get(key);
    const existing = raw ? JSON.parse(raw) : {
      userId, displayName: name, pictureUrl: picture,
      messages: [], pendingDraft: null,
      lastMessageAt: new Date().toISOString(), status: 'PENDING'
    };

    existing.displayName = name;
    existing.pictureUrl = picture;
    existing.messages.push({ id: Date.now(), role: 'customer', text: userMessage, timestamp: new Date().toISOString() });
    existing.pendingDraft = aiDraft;
    existing.lastMessageAt = new Date().toISOString();
    existing.status = 'PENDING';

    await redis.set(key, JSON.stringify(existing));

    // Publish update so SSE clients get notified instantly
    await redis.publish('myfoto:updates', JSON.stringify({ type: 'new_message', userId }));

    return res.json({ ok: true });
  }

  // ── POST approve ──
  if (req.method === 'POST' && action === 'approve') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
    const { userId, text } = body || {};
    if (!userId || !text) return res.status(400).json({ error: 'missing' });

    const ok = await sendLineMessage(userId, text);
    const key = `conv:${userId}`;
    const raw = await redis.get(key);
    if (raw) {
      const conv = JSON.parse(raw);
      conv.messages.push({ id: Date.now(), role: 'admin', text, timestamp: new Date().toISOString() });
      conv.pendingDraft = null;
      conv.status = 'REPLIED';
      await redis.set(key, JSON.stringify(conv));
      await redis.publish('myfoto:updates', JSON.stringify({ type: 'new_message', userId }));
    }
    return res.json({ ok });
  }

  return res.status(404).json({ error: 'not found' });
};
