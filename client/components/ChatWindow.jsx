import { useMemo } from "react";

function safeString(v) {
  return typeof v === "string" ? v : "";
}

function countImagesInParts(parts) {
  if (!Array.isArray(parts)) return 0;
  let count = 0;
  parts.forEach((p) => {
    const t = safeString(p?.type);
    if (t.toLowerCase().includes("image")) count += 1;
    if (p?.image_url) count += 1;
  });
  return count;
}

function extractUserFromConversationItem(event) {
  if (!event || event.role !== "user") return null;
  const content = event.content;

  const texts = [];
  let imageCount = 0;

  if (Array.isArray(content)) {
    content.forEach((part) => {
      const partType = safeString(part?.type).toLowerCase();
      if (partType === "input_text" || partType === "text") {
        const text = safeString(part?.text);
        if (text) texts.push(text);
      } else if (partType.includes("image") || part?.image_url) {
        imageCount += 1;
      }
    });
  }

  const text = texts.join("").trim();
  if (!text && imageCount === 0) return null;

  return { text, imageCount };
}

function findAllTextValues(obj, acc) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((x) => findAllTextValues(x, acc));
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if ((k === "text" || k === "transcript") && typeof v === "string") {
      if (v.trim()) acc.push(v);
      continue;
    }
    // 图片信息不展开，最多计数
    if (k === "image_url") continue;
    findAllTextValues(v, acc);
  }
}

function extractAssistantFromResponseEvent(event) {
  // 常见形态：delta.text 或 response.output[].content[].text
  const texts = [];
  let imageCount = 0;

  if (event?.delta && typeof event.delta === "object") {
    if (typeof event.delta.text === "string" && event.delta.text.trim()) {
      texts.push(event.delta.text);
    }
    if (
      typeof event.delta.transcript === "string" &&
      event.delta.transcript.trim()
    ) {
      texts.push(event.delta.transcript);
    }
    // delta 里如果包含 parts，统计图片占位
    imageCount += countImagesInParts(event.delta?.content);
    imageCount += countImagesInParts(event.delta?.parts);
  }

  const outputs = event?.response?.output;
  if (Array.isArray(outputs)) {
    outputs.forEach((out) => {
      const parts = out?.content;
      if (Array.isArray(parts)) {
        parts.forEach((part) => {
          const partType = safeString(part?.type).toLowerCase();
          if (partType === "output_text" || partType === "text") {
            if (typeof part?.text === "string" && part.text.trim()) {
              texts.push(part.text);
            }
          } else if (partType.includes("transcript")) {
            const t = safeString(part?.transcript) || safeString(part?.text);
            if (t.trim()) texts.push(t);
          } else if (partType.includes("image") || part?.image_url) {
            imageCount += 1;
          }
        });
      }
    });
  }

  // 兜底：把 response 里所有 text 收集一下（不展开图片）
  if (texts.length === 0 && event && typeof event === "object") {
    findAllTextValues(event, texts);
    // 在通用兜底里粗略计数图片（避免把大段 data URL 展示出来）
    const imgStr = JSON.stringify(event);
    if (imgStr.includes("image_url")) imageCount = Math.max(imageCount, 1);
  }

  const text = texts.join("").trim();
  if (!text && imageCount === 0) return null;
  return { text, imageCount };
}

function extractFromConversationItem(item) {
  if (!item) return null;
  const role = safeString(item.role);
  if (role !== "user" && role !== "assistant") return null;

  const texts = [];
  let imageCount = 0;
  const content = item.content;
  if (Array.isArray(content)) {
    content.forEach((part) => {
      const type = safeString(part?.type).toLowerCase();
      const t = safeString(part?.text) || safeString(part?.transcript);
      if (
        type.includes("text") ||
        type.includes("transcript") ||
        type === "message" ||
        type === "output"
      ) {
        if (t) texts.push(t);
      } else if (type.includes("image") || part?.image_url) {
        imageCount += 1;
      }
    });
  }

  const text = texts.join("").trim();
  if (!text && imageCount === 0) return null;
  return { role, text, imageCount };
}

function normalizeMessage(role, text, imageCount) {
  const finalText = text || "";
  const withImage =
    imageCount > 0
      ? `${finalText}${finalText ? " " : ""}（${imageCount}张图片）`
      : finalText;
  return {
    role,
    text: withImage,
    imageCount,
  };
}

function buildChatMessages(events) {
  const ordered = [...events].reverse(); // oldest -> newest
  const messages = [];
  const keyToIndex = new Map();
  let unknownAudioSeq = 0;
  let unknownAssistantSeq = 0;
  let currentAssistantStreamKey = null;

  function upsertMessage(key, role, text, imageCount) {
    const msg = normalizeMessage(role, text, imageCount);
    if (!msg.text) return;
    if (keyToIndex.has(key)) {
      const idx = keyToIndex.get(key);
      messages[idx] = msg;
      return;
    }
    keyToIndex.set(key, messages.length);
    messages.push(msg);
  }

  ordered.forEach((event) => {
    const type = safeString(event?.type);

    // 1) 用户本地发送：直接显示一次
    if (type === "conversation.item.create" && event?.item?.role === "user") {
      const user = extractUserFromConversationItem(event.item);
      if (user) {
        const key = `user-local:${safeString(event.event_id) || messages.length}`;
        upsertMessage(key, "user", user.text, user.imageCount);
      }
      return;
    }

    // 2) 服务器最终项：优先使用 done（最稳定）
    if (type === "conversation.item.done" && event.item) {
      const msg = extractFromConversationItem(event.item);
      if (msg) {
        const itemId = safeString(event.item?.id) || safeString(event.item_id);
        const key = `${msg.role}-item:${itemId || messages.length}`;
        upsertMessage(key, msg.role, msg.text, msg.imageCount);
      }
      return;
    }

    // 2.5) 语音输入转写：把用户说的话显示在用户侧聊天气泡
    if (type.startsWith("conversation.item.input_audio_transcription.")) {
      const itemId = safeString(event?.item_id) || safeString(event?.item?.id);
      const key = `user-audio:${itemId || `unknown-${unknownAudioSeq}`}`;
      const isDelta = type.endsWith(".delta");
      const chunk =
        safeString(event?.delta) ||
        safeString(event?.transcript) ||
        safeString(event?.item?.transcript);

      if (!itemId && isDelta) unknownAudioSeq += 1;

      if (!chunk) return;

      if (keyToIndex.has(key) && isDelta) {
        const idx = keyToIndex.get(key);
        const prev = safeString(messages[idx]?.text);
        upsertMessage(key, "user", `${prev}${chunk}`, 0);
      } else {
        upsertMessage(key, "user", chunk, 0);
      }
      return;
    }

    // 3) 兜底：部分会话只在 response.*.done 提供 transcript/text
    if (type.startsWith("response.") && type.endsWith(".delta")) {
      const extracted = extractAssistantFromResponseEvent(event);
      if (extracted?.text || extracted?.imageCount) {
        const responseId =
          safeString(event?.response_id) ||
          safeString(event?.response?.id) ||
          safeString(event?.item_id);
        const streamKey =
          responseId ||
          currentAssistantStreamKey ||
          `assistant-stream-unknown-${unknownAssistantSeq++}`;
        currentAssistantStreamKey = streamKey;
        const key = `assistant-stream:${streamKey}`;

        if (keyToIndex.has(key)) {
          const idx = keyToIndex.get(key);
          const prev = safeString(messages[idx]?.text);
          upsertMessage(
            key,
            "assistant",
            `${prev}${extracted.text || ""}`,
            (messages[idx]?.imageCount || 0) + (extracted.imageCount || 0),
          );
        } else {
          upsertMessage(
            key,
            "assistant",
            extracted.text,
            extracted.imageCount,
          );
        }
      }
      return;
    }

    // 4) done 事件用于收尾与兜底
    if (type.endsWith(".done") && type.startsWith("response.")) {
      const extracted = extractAssistantFromResponseEvent(event);
      if (extracted) {
        const respId =
          safeString(event?.response?.id) ||
          safeString(event?.response_id) ||
          safeString(event?.item_id) ||
          currentAssistantStreamKey ||
          safeString(event?.event_id) ||
          `${messages.length}`;
        upsertMessage(
          `assistant-response:${respId}`,
          "assistant",
          extracted.text,
          extracted.imageCount,
        );
      }
      currentAssistantStreamKey = null;
    }
  });

  return messages;
}

export default function ChatWindow({ events }) {
  const messages = useMemo(() => buildChatMessages(events || []), [events]);

  return (
    <div className="chat-window flex flex-col gap-3">
      {messages.length === 0 ? (
        <div className="text-gray-500">开始会话后，聊天内容会在这里显示。</div>
      ) : (
        messages.map((m, idx) => (
          <div
            key={`${idx}-${m.role}`}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`chat-message max-w-[95%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-blue-100 text-blue-900"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
