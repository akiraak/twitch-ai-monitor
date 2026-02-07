require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const tmi = require("tmi.js");
const Database = require("better-sqlite3");
const { GoogleGenAI } = require("@google/genai");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Gemini AI setup
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// SQLite setup
const db = new Database(path.join(__dirname, "data.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    last_connected_at TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )
`);

const upsertChannel = db.prepare(`
  INSERT INTO channels (name, last_connected_at) VALUES (?, ?)
  ON CONFLICT(name) DO UPDATE SET last_connected_at = excluded.last_connected_at
`);
const getChannels = db.prepare(
  `SELECT name FROM channels ORDER BY last_connected_at DESC`
);
const insertMessage = db.prepare(
  `INSERT INTO messages (channel, username, message, timestamp) VALUES (?, ?, ?, ?)`
);
const getRecentMessages = db.prepare(
  `SELECT username, message FROM messages WHERE channel = ? ORDER BY id DESC LIMIT 20`
);

// Translation
const SYSTEM_INSTRUCTION = `あなたはTwitchチャットの翻訳者です。

ルール:
- メッセージが日本語の場合、正確に「SKIP」とだけ返してください
- 翻訳不要なもの（エモート、スタンプ、万国共通の短い語、URLのみ等）は「SKIP」と返してください
- それ以外は自然な日本語に翻訳してください
- 会話の文脈を考慮して翻訳してください
- 翻訳文のみを返してください。説明や注釈は不要です`;

async function translateIfNeeded(msgData) {
  try {
    const recent = getRecentMessages.all(msgData.channel).reverse();
    let context = "";
    if (recent.length > 0) {
      context =
        "最近のチャット:\n" +
        recent.map((m) => `${m.username}: ${m.message}`).join("\n") +
        "\n\n";
    }

    const prompt = `${context}翻訳対象メッセージ (${msgData.username}): ${msgData.message}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    });

    const translation = response.text.trim();
    if (translation && translation !== "SKIP") {
      io.emit("chat-translation", {
        id: msgData.id,
        translation,
      });
    }
  } catch (e) {
    console.error("Translation error:", e.message);
  }
}

app.use(express.static("public"));

let tmiClient = null;
let currentChannel = null;

function createTmiClient(channel) {
  const client = new tmi.Client({
    identity: {
      username: process.env.BOT_NAME,
      password: process.env.TWITCH_TOKEN,
    },
    channels: [channel],
  });

  client.on("message", (ch, tags, message, self) => {
    if (self) return;
    const timestamp = new Date().toISOString();

    // Save to DB and get ID
    const result = insertMessage.run(ch, tags["display-name"], message, timestamp);
    const id = Number(result.lastInsertRowid);

    const data = { id, channel: ch, username: tags["display-name"], message, timestamp };
    console.log(`[${ch}] ${data.username}: ${message}`);
    io.emit("chat-message", data);

    // Translate in background (non-blocking)
    translateIfNeeded(data);
  });

  return client;
}

io.on("connection", (socket) => {
  if (currentChannel) {
    socket.emit("current-channel", currentChannel);
  }

  // Send saved channel list
  socket.emit("channel-list", getChannels.all().map((r) => r.name));

  socket.on("join-channel", async (channel) => {
    if (!channel || typeof channel !== "string") return;
    channel = channel.trim().toLowerCase().replace(/^#/, "");
    if (!channel) return;

    if (tmiClient) {
      try {
        await tmiClient.disconnect();
      } catch (e) {
        // ignore disconnect errors
      }
      tmiClient = null;
      currentChannel = null;
    }

    tmiClient = createTmiClient(channel);
    try {
      await tmiClient.connect();
      currentChannel = channel;
      upsertChannel.run(channel, new Date().toISOString());
      console.log(`Connected to #${channel}`);
      io.emit("channel-joined", channel);
      // Broadcast updated channel list to all clients
      io.emit("channel-list", getChannels.all().map((r) => r.name));
    } catch (e) {
      console.error(`Failed to connect to #${channel}:`, e);
      tmiClient = null;
      socket.emit("channel-error", `Failed to connect to #${channel}`);
    }
  });

  socket.on("leave-channel", async () => {
    if (tmiClient) {
      try {
        await tmiClient.disconnect();
      } catch (e) {
        // ignore disconnect errors
      }
      tmiClient = null;
      currentChannel = null;
      console.log("Disconnected from channel");
      io.emit("channel-left");
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
