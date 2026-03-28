const { createClient } = require('redis');

const LINE_TOKEN = 'gp1dCEjAcjC2ChP+wpJ6SLG6Zq14pMcPg8oIxxqCcmhLyW2qcqSE1cGzLrJNSIcPxlja6zAHyIahW2FnVSU4MH255qKe0BnjEOHUZ/cjojnns2t3 EL6IKNZE9_TTEOJKzEINq 5=U k'Eg8pn1mdiCYELj0AZcSjuCz2oCthUPv+cwkp8JR6FSKLlGE6tZpq01H4ApdMBc0P4gt88o9I/x1xOq/Cwc1mchDLnyyWi2lqFcUq=S'E;1cGzLrJNSIcPxlja6zAHyIahW2FnVSU4MH255qKe0BnjEOHUZ/jjn23E6KZ9TEJzIq5UkE8nmiYL0ZSuzotUvck8RFKlEtp0HAdB04t89/1O/w1cDnyilFU=';
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
const GDOC_URL = 'https://docs.google.com/document/d/e/2PACX-1vQMycXWaI5JVclpwSbqoKfi5_aTcqER9_HD29vXY2sf4AQahlpntbNkOn2-BEy16eKkwUH4g73hg2af/pub?output=txt';

let _redis = null;
async function getRedis() {
  if (_redis) return _redis;
  _redis = createClient({ url: process.env.REDIS_URL });
  _redis.on('error', () => { _redis = null; });
  await _redis.connect();
  return _redis;
}

// Cache Google Doc in Redis for 10 minutes to avoid hitting Google too often
async function getKnowledgeBase(redis) {
  try {
    const cached = await redis.get('cache:gdoc');
    if (cached) return cached;
    const res = await fetch(GDOC_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 100) {
        await redis.setEx('cache:gdoc', 600, text); // cache 10 min
        return text;
      }
    }
  } catch(e) { console.error('gdoc fetch error:', e.message); }
  return null;
}

async function generateAIDraft(userMessage, knowledgeBase) {
  const systemPrompt = knowledgeBase || `คุณคือหยก เจ้าของ MY FOTO บริการช่างภาพเซี่ยงไฮ้สำหรับนักท่องเที่ยวไทย
สไตล์: พิมสั้น กันเอง ใช้ ค่า/ค้าบ/ค่ะ สลับกัน ใช้ 55555 แทนหัวเราะ emoji เบาๆ`;

  const userMsg = `ตอบข้อความลูกค้านี้ 3 แบบ ในสไตล์หยก:\n\nลูกค้าพูดว่า: ${userMessage}\n\nตอบในรูปแบบนี้เท่านั้น ห้ามใส่วงเล็บ [ ]:\nSHORT: ข้อความสั้น 1-2 ประโยค กันเอง\nMEDIUM: ข้อความกลาง 3-4 ประโยค มีข้อมูลพอดี\nLONG: ข้อความยาว 5-8 ประโยค ครบรายละเอียด ส่งลิ้งช่างถ้าเกี่ยวข้อง`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMsg }]
    })
  });

  if (!res.ok) {
    console.error('Claude error:', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data?.content?.[0]?.text || null;
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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
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

  // SSE stream
  if (req.method === 'GET' && action === 'stream') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const initial = await getAllConvs(redis);
    res.write(`data: ${JSON.stringify({ type: 'inbox', data: initial })}\n\n`);
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
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', async () => {
      clearInterval(ping);
      await sub.unsubscribe();
      await sub.disconnect();
    });
    return;
  }

  // GET all conversations
  if (req.method === 'GET' && action === 'getInbox') {
    return res.json(await getAllConvs(redis));
  }

  // GET single conversation
  if (req.method === 'GET' && action === 'getConv') {
    const raw = await redis.get(`conv:${req.query.userId}`);
    return res.json(raw ? JSON.parse(raw) : null);
  }

  // POST new message from Make — now handles Claude + Google Doc itself
  if (req.method === 'POST' && !action) {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'bad json' }); }
    }

    const { userId, userMessage, displayName } = body || {};
    if (!userId || !userMessage) return res.status(400).json({ error: 'missing fields' });

    // Fetch knowledge base + generate AI draft in parallel with profile fetch
    const [knowledgeBase, profile] = await Promise.all([
      getKnowledgeBase(redis),
      getLineProfile(userId)
    ]);

    const rawDraft = await generateAIDraft(userMessage, knowledgeBase);
    const aiDraft = (rawDraft || '').replace(/^\*{1,3}\s*/gm, '').replace(/\*{1,3}$/gm, '').trim();

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
    await redis.publish('myfoto:updates', JSON.stringify({ type: 'new_message', userId }));

    return res.json({ ok: true });
  }

  // POST approve
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
