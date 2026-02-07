# Twitch AI Monitor

Twitchチャットをリアルタイムで監視し、非日本語コメントをAIで自動翻訳するWebアプリケーションです。

## 機能

- Twitchチャットのリアルタイム表示
- 非日本語コメントをGemini 3 Flashで自動翻訳
- 過去の会話を考慮した文脈のある翻訳
- 接続チャンネル履歴のサジェスト表示

## セットアップ

```bash
npm install
```

`.env` ファイルを作成して環境変数を設定します。

```
TWITCH_TOKEN=oauth:your_token
BOT_NAME=your_bot_name
GEMINI_API_KEY=your_api_key
```

| 変数 | 説明 | 取得先 |
|------|------|--------|
| `TWITCH_TOKEN` | Twitch OAuth トークン | https://twitchapps.com/tmi/ |
| `BOT_NAME` | Twitch ユーザー名 | あなたのTwitchアカウント名 |
| `GEMINI_API_KEY` | Google Gemini API キー | https://aistudio.google.com/apikey |

## 起動

```bash
npm start
```

http://localhost:3000 を開き、チャンネル名を入力して「開始」をクリックします。

## 技術スタック

- Node.js / Express v5 / Socket.IO v4
- tmi.js (Twitch IRC)
- SQLite (better-sqlite3)
- Google Gemini 3 Flash (@google/genai)
