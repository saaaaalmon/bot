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
      userMessageHistory[user
