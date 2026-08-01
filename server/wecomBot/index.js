import crypto from "crypto";
import WebSocket from "ws";

const DEFAULT_WS_URL = "wss://openws.work.weixin.qq.com";
const PING_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;

let ws = null;
let pingTimer = null;
let reconnectTimer = null;
let stopped = false;
let onChatHandler = null;
let config = { botId: "", secret: "", wsUrl: DEFAULT_WS_URL, enabled: false };

function makeReqId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
}

function sendFrame(frame) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

function stripMention(text) {
  return String(text || "")
    .replace(/^@\S+\s+/u, "")
    .trim();
}

async function replyStream(reqId, streamId, content, finish) {
  sendFrame({
    cmd: "aibot_respond_msg",
    headers: { req_id: reqId },
    body: {
      msgtype: "stream",
      stream: {
        id: streamId,
        finish: Boolean(finish),
        content: String(content || ""),
      },
    },
  });
}

async function handleMessageCallback(frame) {
  const body = frame.body || {};
  const reqId = frame.headers?.req_id;
  if (!reqId) return;

  if (body.msgtype === "event") return;

  let userText = "";
  if (body.msgtype === "text") {
    userText = stripMention(body.text?.content || "");
  } else if (body.msgtype === "voice" && body.voice?.content) {
    userText = stripMention(body.voice.content);
  } else {
    await replyStream(reqId, makeReqId(), "暂仅支持文字消息；单聊里也可发语音（会自动转文字）。", true);
    return;
  }

  if (!userText) return;

  const streamId = makeReqId();
  await replyStream(reqId, streamId, "正在思考…", false);

  if (!onChatHandler) {
    await replyStream(reqId, streamId, "服务端未配置问答处理函数。", true);
    return;
  }

  try {
    const answer = await onChatHandler(userText, {
      userid: body.from?.userid,
      chattype: body.chattype,
      chatid: body.chatid,
    });
    await replyStream(reqId, streamId, answer || "未生成回复。", true);
  } catch (error) {
    await replyStream(reqId, streamId, error?.message || "处理失败，请稍后重试。", true);
  }
}

function handleEventCallback(frame) {
  const body = frame.body || {};
  const reqId = frame.headers?.req_id;
  if (!reqId) return;

  if (body.event?.eventtype === "enter_chat") {
    sendFrame({
      cmd: "aibot_respond_welcome_msg",
      headers: { req_id: reqId },
      body: {
        msgtype: "text",
        text: {
          content: "你好！我是 AI Assistant，直接发文字或语音即可提问。",
        },
      },
    });
  }
}

function handleIncoming(raw) {
  let frame;
  try {
    frame = JSON.parse(raw);
  } catch {
    return;
  }

  if (frame.errcode && frame.errcode !== 0) {
    console.error("[wecom-bot] frame error:", frame.errcode, frame.errmsg || "");
  }

  switch (frame.cmd) {
    case "aibot_msg_callback":
      handleMessageCallback(frame).catch((error) => {
        console.error("[wecom-bot] message handler failed:", error);
      });
      break;
    case "aibot_event_callback":
      handleEventCallback(frame);
      break;
    default:
      break;
  }
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    sendFrame({
      cmd: "ping",
      headers: { req_id: makeReqId() },
    });
  }, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function scheduleReconnect() {
  if (stopped || !config.enabled) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function connect() {
  if (stopped || !config.enabled || !config.botId || !config.secret) return;

  if (ws) {
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }

  ws = new WebSocket(config.wsUrl);

  ws.on("open", () => {
    console.log("[wecom-bot] connected, subscribing…");
    sendFrame({
      cmd: "aibot_subscribe",
      headers: { req_id: makeReqId() },
      body: {
        bot_id: config.botId,
        secret: config.secret,
      },
    });
    startPing();
  });

  ws.on("message", (data) => {
    handleIncoming(data.toString());
  });

  ws.on("close", () => {
    console.log("[wecom-bot] disconnected");
    stopPing();
    scheduleReconnect();
  });

  ws.on("error", (error) => {
    console.error("[wecom-bot] socket error:", error.message);
  });
}

export function initWecomBot(options = {}) {
  onChatHandler = options.onChat || null;

  const enabledFlag = (process.env.WECOM_BOT_ENABLED ?? "0").trim().toLowerCase();
  config.enabled = !["0", "false", "no", "off"].includes(enabledFlag);
  config.botId = (process.env.WECOM_BOT_ID || "").trim();
  config.secret = (process.env.WECOM_BOT_SECRET || "").trim();
  config.wsUrl = (process.env.WECOM_BOT_WS_URL || DEFAULT_WS_URL).trim() || DEFAULT_WS_URL;

  stopped = false;

  if (!config.enabled) {
    console.log("[wecom-bot] disabled (WECOM_BOT_ENABLED=1 to enable)");
    return { stop: () => {} };
  }

  if (!config.botId || !config.secret) {
    console.warn("[wecom-bot] enabled but WECOM_BOT_ID / WECOM_BOT_SECRET missing");
    return { stop: () => {} };
  }

  console.log("[wecom-bot] starting long-connection client…");
  connect();

  return {
    stop: () => {
      stopped = true;
      clearReconnect();
      stopPing();
      if (ws) {
        ws.removeAllListeners();
        ws.close();
        ws = null;
      }
    },
  };
}
