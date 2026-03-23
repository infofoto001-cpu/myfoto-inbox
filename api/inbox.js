const LINE_TOKEN = "qf72BVH/RuT1PFJJhQ56R6Mtii5Dcl7etMc6dBdV/c/XW8ZCgGXKr1zYJsYIkXL2po5U+Ej/M7WY5UCn/vvmCjmGDhKEnHJiVDOzVcHTPNd93kEhyI3K6uUg0CkdXJdph0ofE1Z6RZOu27FvXWapLAdB04t89/1O/w1cDnyilFU=";

let inbox = [];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Make.com ส่งข้อมูลมา
  if (req.method === "POST") {
    try {
      const data = req.body || JSON.parse(await getRawBody(req));
      inbox.push({
        id: Date.now(),
        userId: data.userId || "",
        displayName: data.displayName || "ลูกค้า",
        userMessage: data.userMessage || "",
        aiDraft: data.aiDraft || "",
        timestamp: new Date().toISOString(),
        status: "PENDING"
      });
      return res.json({ status: "ok", count: inbox.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const { action, id, message, userId } = req.query;

  // ดึง inbox
  if (action === "getInbox") {
    return res.json(inbox.filter(x => x.status === "PENDING"));
  }

  // Approve + ส่ง LINE
  if (action === "approve") {
    const item = inbox.find(x => x.id === parseInt(id));
    if (item) {
      item.status = "SENT";
      item.sentMessage = decodeURIComponent(message || "");
      if (userId && userId.length > 5) {
        try {
          const fetch = require("node-fetch");
          await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + LINE_TOKEN
            },
            body: JSON.stringify({
              to: decodeURIComponent(userId),
              messages: [{ type: "text", text: decodeURIComponent(message) }]
            })
          });
        } catch (e) {
          console.error("LINE send error:", e);
        }
      }
    }
    return res.json({ status: "sent" });
  }

  // Skip
  if (action === "skip") {
    const item = inbox.find(x => x.id === parseInt(id));
    if (item) item.status = "SKIPPED";
    return res.json({ status: "skipped" });
  }

  // History ทั้งหมด
  if (action === "getAll") {
    return res.json(inbox);
  }

  return res.status(400).json({ error: "Unknown action" });
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
