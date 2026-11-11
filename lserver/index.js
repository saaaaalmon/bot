
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();

const {
  LINE_TOKEN,
  LINE_SECRET,
  TARGET_USER_ID,
  PUBLIC_BASE_URL,
  PORT = 3000
} = process.env;

// 一時メディア保存（15分）
const mediaStore = new Map();
const MEDIA_TTL = 15 * 60 * 1000;

function saveMedia(buffer, mimeType) {
  const id = crypto.randomBytes(24).toString("hex");

  mediaStore.set(id, { buffer, mimeType });

  const timer = setTimeout(() => {
    mediaStore.delete(id);
  }, MEDIA_TTL);

  timer.unref?.();

  return `${PUBLIC_BASE_URL}/media/${id}`;
}

// LINEのWebhook署名を検証
function verifySignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", LINE_SECRET)
    .update(body)
    .digest("base64");

  const a = Buffer.from(hash);
  const b = Buffer.from(signature || "");

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

// LINEへプッシュ送信
async function pushMessage(messages) {
  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    {
      to: TARGET_USER_ID,
      messages
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_TOKEN}`
      }
    }
  );
}

// グループの発言者名を取得
async function getSenderName(groupId, userId) {
  try {
    const response = await axios.get(
      `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${LINE_TOKEN}`
        }
      }
    );

    return response.data.displayName;
  } catch {
    return `ユーザーID末尾: ${userId.slice(-6)}`;
  }
}

// LINEから画像・動画を取得
async function getContent(messageId) {
  const response = await axios.get(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: {
        Authorization: `Bearer ${LINE_TOKEN}`
      },
      responseType: "arraybuffer",
      maxContentLength: 25 * 1024 * 1024
    }
  );

  return Buffer.from(response.data);
}

// 画像・動画のプレビューを取得
async function getPreview(messageId) {
  const response = await axios.get(
    `https://api-data.line.me/v2/bot/message/${messageId}/content/preview`,
    {
      headers: {
        Authorization: `Bearer ${LINE_TOKEN}`
      },
      responseType: "arraybuffer",
      maxContentLength: 5 * 1024 * 1024
    }
  );

  return Buffer.from(response.data);
}

// メッセージ処理
async function handleEvent(event) {
  if (event.type !== "message") return;

  // グループ以外は対象外
  if (event.source.type !== "group") return;

  const message = event.message;
  const userId = event.source.userId;
  const groupId = event.source.groupId;

  if (!userId) return;

  const senderName = await getSenderName(groupId, userId);

  const date = new Date(event.timestamp).toLocaleString(
    "ja-JP",
    { timeZone: "Asia/Tokyo" }
  );

  const header =
    `📩 グループの新着メッセージ\n` +
    `👤 発言者：${senderName}\n` +
    `🕒 日時：${date}`;

  // テキスト
  if (message.type === "text") {
    await pushMessage([
      {
        type: "text",
        text: `${header}\n\n${message.text}`
      }
    ]);
    return;
  }

  // 画像
  if (message.type === "image") {
    const original = await getContent(message.id);
    const preview = await getPreview(message.id);

    const originalUrl = saveMedia(original, "image/jpeg");
    const previewUrl = saveMedia(preview, "image/jpeg");

    await pushMessage([
      {
        type: "text",
        text: header + "\n\n🖼 画像"
      },
      {
        type: "image",
        originalContentUrl: originalUrl,
        previewImageUrl: previewUrl
      }
    ]);
    return;
  }

  // 動画
  if (message.type === "video") {
    const original = await getContent(message.id);
    const preview = await getPreview(message.id);

    const videoUrl = saveMedia(original, "video/mp4");
    const previewUrl = saveMedia(preview, "image/jpeg");

    await pushMessage([
      {
        type: "text",
        text: header + "\n\n🎥 動画"
      },
      {
        type: "video",
        originalContentUrl: videoUrl,
        previewImageUrl: previewUrl
      }
    ]);
    return;
  }

  // その他
  await pushMessage([
    {
      type: "text",
      text: `${header}\n\n📎 メッセージ形式：${message.type}`
    }
  ]);
}

// メディア配信用URL
app.get("/media/:id", (req, res) => {
  const media = mediaStore.get(req.params.id);

  if (!media) {
    return res.status(404).send("Media expired");
  }

  res.setHeader("Content-Type", media.mimeType);
  res.setHeader("Cache-Control", "no-store");
  res.send(media.buffer);
});

// Webhook
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["x-line-signature"];

    if (!verifySignature(req.body, signature)) {
      return res.sendStatus(401);
    }

    let body;

    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }

    // LINEにはすぐに受信完了を返す
    res.sendStatus(200);

for (const event of body.events || []) {
  if (event.source?.type === "user" && event.source.userId) {
    console.log("USER ID:", event.source.userId);
  }

  handleEvent(event).catch(error => {
    console.error("Message processing error:", error.message);
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
