import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json();

// 1秒スタ連用：ユーザーごとの前回メッセージ時間
const lastMessageTime = {};

// 10秒10回用：ユーザーごとのメッセージ履歴（タイムスタンプ配列）
const userMessageHistory = {};

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const userMessage = event.message.text;
      const now = Date.now();

      console.log("ユーザーのメッセージ:", userMessage);

      // ---------- ① 10秒間に10回メッセージ検知 ----------
      if (!userMessageHistory[userId]) {
        userMessageHistory[userId] = [];
      }

      // 今のメッセージ時刻を履歴に追加
      userMessageHistory[userId].push(now);

      // 10秒より古いメッセージを履歴から削除
      userMessageHistory[userId] = userMessageHistory[userId].filter(
        (t) => now - t <= 10000
      );

      const countLast10Sec = userMessageHistory[userId].length;

      // ---------- ② 1秒以内のスタ連検知 ----------
      const isFastSpam =
        lastMessageTime[userId] && now - lastMessageTime[userId] < 1000;

      // ---------- ③ 判定＆返信 ----------
      if (isFastSpam) {
        // 1秒以内のスタ連
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

      // 最後のメッセージ時間を更新（スタ連用）
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
