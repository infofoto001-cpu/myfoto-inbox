const LINE_TOKEN = "qf72BVH/RuT1PFJJhQ56R6Mtii5Dcl7etMc6dBdV/c/XW8ZCgGXKr1zYJsYIkXL2po5U+Ej/M7WY5UCn/vvmCjmGDhKEnHJiVDOzVcHTPNd93kEhyI3K6uUg0CkdXJdph0ofE1Z6RZOu27FvXWapLAdB04t89/1O/w1cDnyilFU=";

// In-memory storage (resets on cold start - use external DB for production)
if (!global.inbox) global.inbox = [];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // POST - รับข้อมูลจาก Make.com
  if (req.method === "POST") {
    try {
      let data = req.body;
      if (typeof data === "string") data = JSON.parse(data);
      if (!data) return res.status(400).json({ error: "No body" });

      const item = {
        id: Date.now(),
        userId: data.userId || "",
        displayName: data.displayName || "ลูกค้า",
        userMessage: data.userMessage || "",
        aiDraft: data.aiDraft || "",
        timestamp: new Date().toISOString(),
        status: "PENDING"
      };
      global.inbox.push(item);
      console.log("Received:", item.userMessage, "Total:", global.inbox.length);
      return res.json({ status: "ok", id: item.id, count: global.inbox.length });
    } catch (e) {
      console.error("POST error:", e);
      return res.status(500).json({ error: e.message });
    }
  }

  // GET actions
  const { action, id, message, userId } = req.query;

  if (action === "getInbox") {
    const pending = global.inbox.filter(x => x.status === "PENDING");
    return res.json(pending);
  }

  if (action === "getAll") {
    return res.json(global.inbox);
  }

  if (action === "approve") {
    const item = global.inbox.find(x => x.id === parseInt(id));
    if (item) {
      item.status = "SENT";
      item.sentMessage = decodeURIComponent(message || "");
      const uid = decodeURIComponent(userId || "");
      if (uid && uid.length > 5 && !uid.startsWith("anon")) {
        try {
          const fetch = require("node-fetch");
          const r = await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + LINE_TOKEN
            },
            body: JSON.stringify({
              to: uid,
              messages: [{ type: "text", text: decodeURIComponent(message || "") }]
            })
          });
          const result = await r.json();
          console.log("LINE send result:", result);
        } catch (e) {
          console.error("LINE error:", e);
        }
      }
    }
    return res.json({ status: "sent" });
  }

  if (action === "skip") {
    const item = global.inbox.find(x => x.id === parseInt(id));
    if (item) item.status = "SKIPPED";
    return res.json({ status: "skipped" });
  }

  return res.status(400).json({ error: "Unknown action" });
};
