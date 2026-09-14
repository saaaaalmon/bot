import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// ユーザーごとの前回メッセージ時間を記録する
const lastMessageTime = {};

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    // ① メッセージイベントかどうか
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      const userMessage = event.message.text;
      const now = Date.now();

      console.log("ユーザーのメッセージ:", userMessage);

      // ② スタ連検知（前回から1秒以内）
      if (lastMessageTime[userId] && now - lastMessageTime[userId] < 1000) {
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: "スパム検知"
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
        // ③ 通常メッセージへの返信
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: `スパム検知\n内容: ${userMessage}`
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

      // 最後のメッセージ時間を更新
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
