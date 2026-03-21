const fetch = require('node-fetch');

const SHEET_ID = '1zvsrW2S_W53i_Bs73VLxXW6oHC95uFPxdg1--6SrHEk';
const LINE_TOKEN = 'qf72BVH/RuT1PFJJhQ56R6Mtii5Dcl7etMc6dBdV/c/XW8ZCgGXKr1zYJsYIkXL2po5U+Ej/M7WY5UCn/vvmCjmGDhKEnHJiVDOzVcHTPNd93kEhyI3K6uUg0CkdXJdph0ofE1Z6RZOu27FvXWapLAdB04t89/1O/w1cDnyilFU=';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzZoC3ajCp2rDVjG9jOINvFwItzfdE50O7R6KOhRKCLKqjEfchS7Wb192K9B-wtwp6BzA/exec';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, row, userId, message } = req.query;

  if (action === 'getInbox') {
    try {
      const r = await fetch(`${APPS_SCRIPT_URL}?action=getInbox`);
      const data = await r.json();
      return res.json(data);
    } catch (e) {
      return res.json([]);
    }
  }

  if (action === 'approve') {
    try {
      await fetch(`${APPS_SCRIPT_URL}?action=approve&row=${row}&userId=${encodeURIComponent(userId)}&message=${encodeURIComponent(message)}`);
      if (userId && userId.length > 5) {
        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${LINE_TOKEN}`
          },
          body: JSON.stringify({
            to: userId,
            messages: [{ type: 'text', text: message }]
          })
        });
      }
      return res.json({ status: 'sent' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === 'skip') {
    try {
      await fetch(`${APPS_SCRIPT_URL}?action=skip&row=${row}`);
      return res.json({ status: 'skipped' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
};
