import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// ユーザーごとのメッセージ履歴（タイムスタンプ配列）
const userMessageHistory = {};

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const userMessage = event.message.text;
      const now = Date.now();

      console.log("ユーザーのメッセージ:", userMessage);

      // 履歴がなければ作成
      if (!userMessageHistory[userId]) {
        userMessageHistory[userId] = [];
      }

      // 現在のメッセージを履歴に追加
      userMessageHistory[userId].push(now);

      // 10秒より古いメッセージを削除
      userMessageHistory[userId] = userMessageHistory[userId].filter(
        (t) => now - t <= 10000
      );

      // 10秒間に10回以上ならスタ連判定
      if (userMessageHistory[userId].length >= 10) {
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: "⚠ 10秒間に10回の連打を検知したよ！"
              }
            ]
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.LINE_TOKEN}`
            }
          }
        );
      } else {
        // 通常メッセージ返信
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: `メッセージを検知したよ！\n内容: ${userMessage}`
              }
            ]
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.LINE_TOKEN}`
            }
          }
        );
      }
    }
  }

  res.sendStatus(200);
});

// Railway 用 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
