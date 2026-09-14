import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const LINE_TOKEN = process.env.LINE_TOKEN;

// ユーザーごとのスタンプ履歴
const stampHistory = {};

// Webhook受信
app.post("/webhook", (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    // スタンプメッセージだけを見る
    if (event.type === "message" && event.message.type === "sticker") {
      const userId = event.source.userId;
      const now = Date.now();

      if (!stampHistory[userId]) {
        stampHistory[userId] = [];
      }

      // 今回のスタンプ時刻を追加
      stampHistory[userId].push(now);

      // 5秒以内のスタンプだけ残す
      stampHistory[userId] = stampHistory[userId].filter(
        (t) => now - t <= 5000
      );

      // 5回以上ならスタ連判定
      if (stampHistory[userId].length >= 5) {
        replyText(event.replyToken, "スタ連検知！スタ連検知！");
      }
    }
  }

  res.sendStatus(200);
});

// テキスト返信関数
function replyText(replyToken, text) {
  axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text }],
    },
    {
      headers: {
        Authorization: `Bearer ${LINE_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  ).catch((err) => {
    console.error("LINE返信エラー:", err.response?.data || err.message);
  });
}

app.get("/", (req, res) => {
  res.send("スタ連検知Bot稼働中");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
