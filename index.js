require("dotenv").config();
const tmi = require("tmi.js");

const client = new tmi.Client({
  identity: {
    username: process.env.BOT_NAME,
    password: process.env.TWITCH_TOKEN,
  },
  channels: [process.env.CHANNEL],
});

client.connect().then(() => {
  console.log(`Connected to #${process.env.CHANNEL}`);
});

client.on("message", (channel, tags, message, self) => {
  if (self) return;
  console.log(`[${channel}] ${tags["display-name"]}: ${message}`);
});
