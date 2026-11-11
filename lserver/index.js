
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import sharp from "sharp";

dotenv.config();

const app = express();

const {
  LINE_TOKEN,
  LINE_SECRET,
  TARGET_USER_ID,
  PUBLIC_BASE_URL,
  PORT = 3000
} = process.env;

const BASE_URL = PUBLIC_BASE_URL?.replace(/\/$/, "");

const mediaStore = new Map();
const MEDIA_TTL = 30 * 60 * 1000;
const MAX_MEDIA_SIZE = 50 * 1024 * 1024;

// 起動時の設定確認
if (!LINE_TOKEN || !LINE_SECRET || !TARGET_USER_ID || !BASE_URL) {
  console.error("必要な環境変数が設定されていません。");
}

// メディアを一時保存して公開URLを作る
function saveMedia(buffer, mimeType) {
  const id = crypto.randomBytes(24).toString("hex");

  mediaStore.set(id, { buffer, mimeType });

  const timer = setTimeout(() => {
    mediaStore.delete(id);
  }, MEDIA_TTL);

  timer.unref?.();

  return `${BASE_URL}/media/${id}`;
}

// Webhook署名の検証
function verifySignature(body, signature) {
  if (!LINE_SECRET || !signature) return false;

  const hash = crypto
    .createHmac("sha256", LINE_SECRET)
    .update(body)
    .digest("base64");

  const a = Buffer.from(hash);
  const b = Buffer.from(signature);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

// LINE APIへリクエスト
async function lineRequest(url, options = {}) {
  return axios({
    url,
    ...options,
    headers: {
      Authorization: `Bearer ${LINE_TOKEN}`,
      ...options.headers
    },
    timeout: 30000
  });
}

// 自分のLINEへメッセージを送る
async function pushMessage(messages) {
  if (!TARGET_USER_ID) {
    throw new Error("TARGET_USER_IDが設定されていません");
  }

  await lineRequest(
    "https://api.line.me/v2/bot/message/push",
    {
      method: "POST",
      data: {
        to: TARGET_USER_ID,
        messages
      }
    }
  );
}

// 発言者の名前を取得
async function getSenderName(groupId, userId) {
  try {
    const response = await lineRequest(
      `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`
    );

    return response.data.displayName;
  } catch {
    return `ユーザーID末尾: ${userId.slice(-6)}`;
  }
}

// LINEから画像・動画を取得
async function getContent(messageId) {
  const response = await lineRequest(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      responseType: "arraybuffer",
      maxContentLength: MAX_MEDIA_SIZE
    }
  );

  return {
    buffer: Buffer.from(response.data),
    mimeType: response.headers["content-type"]?.split(";")[0]
      || "application/octet-stream"
  };
}

// 動画のプレビューを取得
async function getVideoPreview(messageId) {
  const response = await lineRequest(
    `https://api-data.line.me/v2/bot/message/${messageId}/content/preview`,
    {
      responseType: "arraybuffer",
      maxContentLength: 5 * 1024 * 1024
    }
  );

  return Buffer.from(response.data);
}

// 画像を転送
async function forwardImage(message, header) {
  const content = await getContent(message.id);

  // LINEで使えるJPEG形式に変換
  const original = await sharp(content.buffer)
    .rotate()
    .jpeg({ quality: 90 })
    .toBuffer();

  // 小さなプレビュー画像を作成
  const preview = await sharp(original)
    .resize(1024, 1024, {
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: 70 })
    .toBuffer();

  const originalUrl = saveMedia(original, "image/jpeg");
  const previewUrl = saveMedia(preview, "image/jpeg");

  await pushMessage([
    {
      type: "text",
      text: `${header}\n\n🖼 画像`
    },
    {
      type: "image",
      originalContentUrl: originalUrl,
      previewImageUrl: previewUrl
    }
  ]);
}

// 動画を転送
async function forwardVideo(message, header) {
  const content = await getContent(message.id);
  const preview = await getVideoPreview(message.id);

  if (content.mimeType !== "video/mp4") {
    throw new Error(
      `動画形式が対応外です: ${content.mimeType}`
    );
  }

  const videoUrl = saveMedia(content.buffer, "video/mp4");
  const previewUrl = saveMedia(preview, "image/jpeg");

  await pushMessage([
    {
      type: "text",
      text: `${header}\n\n🎥 動画`
    },
    {
      type: "video",
      originalContentUrl: videoUrl,
      previewImageUrl: previewUrl
    }
  ]);
}

// イベント処理
async function handleEvent(event) {
  if (event.type !== "message") return;

  // グループのメッセージだけを対象にする
  if (event.source?.type !== "group") return;

  const message = event.message;
  const userId = event.source.userId;
  const groupId = event.source.groupId;

  if (!userId || !groupId) return;

  const senderName = await getSenderName(groupId, userId);

  const date = new Date(event.timestamp).toLocaleString(
    "ja-JP",
    { timeZone: "Asia/Tokyo" }
  );

  const header =
    `📩 グループの新着メッセージ\n` +
    `👤 発言者：${senderName}\n` +
    `🕒 日時：${date}`;

  if (message.type === "text") {
    await pushMessage([
      {
        type: "text",
        text: `${header}\n\n${message.text}`
      }
    ]);
    return;
  }

  if (message.type === "image") {
    await forwardImage(message, header);
    return;
  }

  if (message.type === "video") {
    await forwardVideo(message, header);
    return;
  }

  await pushMessage([
    {
      type: "text",
      text: `${header}\n\n📎 メッセージ形式：${message.type}`
    }
  ]);
}

// LINEが取得するメディアの公開URL
app.get("/media/:id", (req, res) => {
  const media = mediaStore.get(req.params.id);

  if (!media) {
    return res.status(404).send("Media expired");
  }

  res.setHeader("Content-Type", media.mimeType);
  res.setHeader("Content-Length", media.buffer.length);
  res.setHeader("Cache-Control", "public, max-age=300");

  res.send(media.buffer);
});

// Webhook
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.headers["x-line-signature"];

    if (!verifySignature(req.body, signature)) {
      console.error("Webhook署名の検証に失敗しました");
      return res.sendStatus(401);
    }

    let body;

    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }

    res.sendStatus(200);

    for (const event of body.events || []) {
      // 個人チャットで自分のユーザーIDを確認
      if (event.source?.type === "user" && event.source.userId) {
        console.log("USER ID:", event.source.userId);
      }

      handleEvent(event).catch(error => {
        console.error(
          "Message processing error:",
          error.response?.status || "",
          error.response?.data || error.message
        );
      });
    }
  }
);

app.get("/", (req, res) => {
  res.send("LINE Forward Bot is running!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
