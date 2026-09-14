import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// 1秒スタ連用
const lastMessageTime = {};

// 10秒10回用
const userMessageHistory = {};

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const now = Date.now();

      // -------------------------
      // ① 10秒間のメッセージ履歴管理
      // -------------------------
      if (!userMessageHistory[userId]) {
        userMessageHistory[userId] = [];
      }

      // 今のメッセージ時刻を追加
      userMessageHistory[userId].push(now);

      // 10秒より古いメッセージを削除
      userMessageHistory[userId] = userMessageHistory[userId].filter(
        (t) => now - t <= 10000
      );

      const countLast10Sec = userMessageHistory[userId].length;

      // -------------------------
      // ② 1秒以内のスタ連検知
      -------------------------
      const isFastSpam =
        lastMessageTime[userId] && now - lastMessageTime[userId] < 1000;

      // -------------------------
      // ③ 判定
      // -------------------------
      if (isFastSpam) {
        // スタ連検知
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: "⚠ スタ連を検知したよ！（1秒以内の連投）"
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
      } else if (countLast10Sec >= 10) {
        // 10秒間に10回メッセージ
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: "⚠ 10秒間に10回のメッセージ連打を検知したよ！"
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

      // スタ連用の最終メッセージ時間更新
      lastMessageTime[userId] = now;
    }
  }

  res.sendStatus(200);
});

// Railway 用 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
