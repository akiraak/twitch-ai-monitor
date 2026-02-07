require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const tmi = require("tmi.js");
const { GoogleGenAI } = require("@google/genai");
const OpenAI = require("openai");

const { upsertChannel, getChannels, insertMessage, insertTranscription } = require("./lib/db");
const { createTranslator } = require("./lib/translator");
const { Transcriber } = require("./lib/transcription");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const translator = createTranslator(ai);

let tmiClient = null;
let currentChannel = null;
let transcriptionId = 0;

const transcriber = new Transcriber(openai, {
  onTranscription: (text) => {
    const timestamp = new Date().toISOString();
    if (currentChannel) {
      insertTranscription.run(currentChannel, text, timestamp);
    }
    const id = ++transcriptionId;
    io.emit("transcription", { id, text, timestamp });
    translator.translateTranscription(text, currentChannel)
      .then((translation) => {
        if (translation) io.emit("transcription-translation", { id, translation });
      })
      .catch((e) => console.error("Transcription translation error:", e.message));
  },
  onStopped: () => {
    io.emit("transcription-stopped");
  },
});

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
    const result = insertMessage.run(ch, tags["display-name"], message, timestamp);
    const id = Number(result.lastInsertRowid);
    const data = { id, channel: ch, username: tags["display-name"], message, timestamp };
    console.log(`[${ch}] ${data.username}: ${message}`);
    io.emit("chat-message", data);
    translator.translateChat(data)
      .then((translation) => {
        if (translation) io.emit("chat-translation", { id: data.id, translation });
      })
      .catch((e) => console.error("Translation error:", e.message));
  });

  return client;
}

app.use(express.static("public"));

io.on("connection", (socket) => {
  if (currentChannel) {
    socket.emit("current-channel", currentChannel);
  }
  socket.emit("channel-list", getChannels.all().map((r) => r.name));

  socket.on("join-channel", async (channel) => {
    if (!channel || typeof channel !== "string") return;
    channel = channel.trim().toLowerCase().replace(/^#/, "");
    if (!channel) return;

    if (tmiClient) {
      try { await tmiClient.disconnect(); } catch (e) {}
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
      io.emit("channel-list", getChannels.all().map((r) => r.name));
      transcriber.start(channel);
    } catch (e) {
      console.error(`Failed to connect to #${channel}:`, e);
      tmiClient = null;
      socket.emit("channel-error", `Failed to connect to #${channel}`);
    }
  });

  socket.on("manual-translate", async (text) => {
    if (!text || typeof text !== "string") return;
    text = text.trim();
    if (!text) return;
    try {
      const result = await translator.translateManual(text);
      socket.emit("manual-translate-result", result);
    } catch (e) {
      console.error("Manual translation error:", e.message);
      socket.emit("manual-translate-result", "翻訳エラー");
    }
  });

  socket.on("leave-channel", async () => {
    transcriber.stop();
    if (tmiClient) {
      try { await tmiClient.disconnect(); } catch (e) {}
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
