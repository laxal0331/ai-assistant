import express from "express";
import fs from "fs";
import path from "path";
import { createServer } from "http";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { recognizeImageBuffer } from "./server/aliyunOcr.js";
import {
  appendEvent,
  addClient,
  broadcast,
  clearSession,
  createSession,
  getSession,
  removeClient,
  sendSnapshot,
  setLiveTranscript,
} from "./server/sessionHub.js";
import { getNetworkInfo } from "./server/networkInfo.js";
import {
  checkCanConsume,
  computeChatCreditCost,
  consumeCredits,
  getUsageSnapshot,
  initUsageQuota,
  isQuotaEnabled,
  redeemRechargeCode,
} from "./server/usageQuota.js";
import {
  buildDeepgramListenUrl,
  buildDeepgramStreamUrl,
  getDefaultProfileId,
  initSttVocabulary,
  listSttVocabProfiles,
  normalizeProfileId,
  normalizeTranscript,
} from "./server/vocabulary/index.js";
import { initWecomBot } from "./server/wecomBot/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  process.env.DOTENV_CONFIG_PATH,
  path.join(__dirname, ".env"),
].filter(Boolean);
for (const envPath of envCandidates) {
  dotenv.config({ path: envPath });
}

let serverPort = Number(process.env.PORT) || 3000;
let screenshotTimingLogPath = "";

const app = express();
const httpServer = createServer(app);
app.use(express.json({ limit: "2mb" }));
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
const cerebrasApiKey = process.env.CEREBRAS_API_KEY;
const cerebrasModel = process.env.CEREBRAS_MODEL || "llama3.1-8b";
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const deepseekBaseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const dashscopeApiKey = process.env.DASHSCOPE_API_KEY || "";
const qwenBaseUrl = (process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
const qwenVlModel = process.env.QWEN_VL_MODEL || "qwen3-vl-flash";
const llmMaxTokens = Number(process.env.LLM_MAX_TOKENS) || 400;
const qwenVlMaxTokens = Number(process.env.QWEN_VL_MAX_TOKENS) || llmMaxTokens;
const llmProviderOrder = (process.env.LLM_PROVIDER_ORDER || "cerebras,deepseek")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const systemPrompt =
  process.env.SYSTEM_PROMPT ||
  "你是中文AI助手。先给结论，再给要点，语言简洁。";
let latestResumeSummary = "";

function isResumeRelated(question) {
  const q = (question || "").toLowerCase();
  const patterns = [
    /简历|经历|项目|实习|工作|教育|技能|你的背景|你做过/,
    /resume|experience|project|internship|background|your profile|what have you done/,
  ];
  return patterns.some((p) => p.test(q));
}

function buildResumeSummaryFromMarkdown(mdText) {
  const raw = (mdText || "").replace(/\r/g, "").trim();
  if (!raw) return "";
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean);
  return lines.slice(0, 40).join("\n").slice(0, 2000);
}

let vite;
async function setupClientServing({ isProduction, rootDir }) {
  if (isProduction) {
    app.use(express.static(path.join(rootDir, "dist/client"), { index: false }));
    return null;
  }
  vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
    appType: "custom",
  });
  app.use(vite.middlewares);
  return vite;
}

async function renderClientPage(url, { isProduction, rootDir, activeVite }) {
  if (isProduction) {
    const template = fs.readFileSync(path.join(rootDir, "dist/client/index.html"), "utf-8");
    return template.replace("<!--ssr-outlet-->", "");
  }
  const template = await activeVite.transformIndexHtml(
    url,
    fs.readFileSync(path.join(rootDir, "client/index.html"), "utf-8"),
  );
  const { render } = await activeVite.ssrLoadModule(path.join(rootDir, "client/entry-server.jsx"));
  const appHtml = await render(url);
  return template.replace("<!--ssr-outlet-->", appHtml?.html || "");
}

function buildChatPrompt(userText, options = {}) {
  const { useResumeContext = false, resumeSummary = "" } = options;
  const injectedResume = (resumeSummary || latestResumeSummary || "").trim();
  const shouldUseResume = useResumeContext && injectedResume;
  return shouldUseResume
    ? `${systemPrompt}\n\n补充约束：用户已启用参考资料上下文。请优先结合以下参考资料回答；如果问题与资料关系不明显，先说明资料中没有直接信息，再用通用知识补充，不要编造资料里不存在的经历或结论。\n\n参考资料摘要：\n${injectedResume}`
    : systemPrompt;
}

function formatLlmError(providerName, status, detail) {
  const text = (detail || "").trim();
  if (text.includes("Error 1009") || text.includes("banned the country or region")) {
    return `${providerName} 请求失败（${status}）：当前 IP 所在地区被限制访问，已尝试备用模型。`;
  }
  if (text.startsWith("<!doctype") || text.startsWith("<html")) {
    return `${providerName} 请求失败（${status}）：服务返回异常页面，已尝试备用模型。`;
  }
  const short = text.length > 240 ? `${text.slice(0, 240)}...` : text;
  return `${providerName} 请求失败（${status}）：${short || "unknown error"}`;
}

function getProviderCatalog() {
  return {
    cerebras: {
      name: "Cerebras",
      enabled: Boolean(cerebrasApiKey),
      url: "https://api.cerebras.ai/v1/chat/completions",
      apiKey: cerebrasApiKey,
      model: cerebrasModel,
    },
    deepseek: {
      name: "DeepSeek",
      enabled: Boolean(deepseekApiKey),
      url: `${deepseekBaseUrl}/v1/chat/completions`,
      apiKey: deepseekApiKey,
      model: deepseekModel,
    },
  };
}

function getOrderedProviders(catalog) {
  const ordered = [];
  for (const key of llmProviderOrder) {
    const provider = catalog[key];
    if (provider?.enabled) ordered.push({ ...provider });
  }
  for (const provider of Object.values(catalog)) {
    if (provider.enabled && !ordered.some((p) => p.name === provider.name)) {
      ordered.push({ ...provider });
    }
  }
  return ordered;
}

function resolveLlmProviders(modelChoice) {
  const catalog = getProviderCatalog();
  const choice = (modelChoice || "auto").trim();

  if (!choice || choice === "auto") {
    return getOrderedProviders(catalog);
  }

  const sep = choice.indexOf(":");
  if (sep <= 0) return getOrderedProviders(catalog);

  const providerKey = choice.slice(0, sep).toLowerCase();
  const modelId = choice.slice(sep + 1).trim();
  const base = catalog[providerKey];
  if (!base?.enabled) return [];

  return [{ ...base, model: modelId || base.model }];
}

function isDeepSeekV4FlashModel(provider) {
  if (provider?.name !== "DeepSeek") return false;
  const model = String(provider.model || "").toLowerCase();
  return model.includes("v4-flash") || model === "deepseek-chat";
}

function buildLlmRequestBody(provider, prompt, userText, stream) {
  const body = {
    model: provider.model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userText },
    ],
    max_tokens: llmMaxTokens,
  };
  if (stream) body.stream = true;
  if (isDeepSeekV4FlashModel(provider)) {
    body.thinking = { type: "disabled" };
  }
  return body;
}

function normalizeImageDataUrl(imageBase64) {
  const value = String(imageBase64 || "").trim();
  if (!value) return "";
  if (/^data:image\/(png|jpe?g|webp);base64,/i.test(value)) return value;
  return "";
}

function imageBufferToDataUrl(buffer, mimeType = "image/jpeg") {
  if (!buffer?.length) return "";
  const safeMimeType = /^image\/(png|jpe?g|webp)$/i.test(mimeType)
    ? mimeType
    : "image/jpeg";
  return `data:${safeMimeType};base64,${buffer.toString("base64")}`;
}

function buildVisionRequestBody(prompt, userText, imageDataUrl, stream) {
  const body = {
    model: qwenVlModel,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: imageDataUrl },
          },
          {
            type: "text",
            text: userText,
          },
        ],
      },
    ],
    max_tokens: qwenVlMaxTokens,
    enable_thinking: false,
  };
  if (stream) body.stream = true;
  return body;
}

async function readSseCompletion(resp, onChunk) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed?.choices?.[0]?.delta?.content || "";
        if (chunk) {
          fullText += chunk;
          if (onChunk) onChunk(chunk);
        }
      } catch {
        // ignore malformed chunks
      }
    }
  }

  return fullText.trim();
}

async function callLlmProvider(provider, userText, options, { stream = false, onChunk } = {}) {
  const prompt = buildChatPrompt(userText, options);
  const resp = await fetch(provider.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildLlmRequestBody(provider, prompt, userText, stream)),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(formatLlmError(provider.name, resp.status, detail));
  }

  if (stream) {
    return readSseCompletion(resp, onChunk);
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function callQwenVision(userText, options, { stream = false, onChunk } = {}) {
  if (!dashscopeApiKey) {
    throw new Error("Missing DASHSCOPE_API_KEY for Qwen vision");
  }
  const imageDataUrl = normalizeImageDataUrl(options.imageBase64);
  if (!imageDataUrl) {
    throw new Error("Invalid image payload for Qwen vision");
  }

  const prompt = buildChatPrompt(userText, options);
  const started = Date.now();
  const resp = await fetch(`${qwenBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dashscopeApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildVisionRequestBody(prompt, userText, imageDataUrl, stream)),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(formatLlmError("Qwen-VL", resp.status, detail));
  }

  if (stream) {
    const answer = await readSseCompletion(resp, onChunk);
    console.log(`Qwen-VL success: model=${qwenVlModel}, elapsedMs=${Date.now() - started}`);
    return answer;
  }

  const data = await resp.json();
  console.log(`Qwen-VL success: model=${qwenVlModel}, elapsedMs=${Date.now() - started}`);
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

async function askLlm(userText, options = {}) {
  const providers = resolveLlmProviders(options.modelChoice);
  if (!providers.length) {
    throw new Error("Missing LLM API key: set CEREBRAS_API_KEY and/or DEEPSEEK_API_KEY");
  }

  let lastError;
  for (let i = 0; i < providers.length; i += 1) {
    const provider = providers[i];
    try {
      const answer = await callLlmProvider(provider, userText, options, { stream: false });
      if (i > 0) {
        console.log(`LLM fallback succeeded via ${provider.name}`);
      }
      return answer;
    } catch (error) {
      lastError = error;
      console.warn(`${provider.name} failed:`, error.message);
    }
  }
  throw lastError;
}

async function streamLlm(userText, options, onChunk) {
  const providers = resolveLlmProviders(options.modelChoice);
  if (!providers.length) {
    throw new Error("Missing LLM API key: set CEREBRAS_API_KEY and/or DEEPSEEK_API_KEY");
  }

  let lastError;
  for (let i = 0; i < providers.length; i += 1) {
    const provider = providers[i];
    try {
      const answer = await callLlmProvider(provider, userText, options, {
        stream: true,
        onChunk,
      });
      if (i > 0) {
        console.log(`LLM fallback succeeded via ${provider.name}`);
      }
      return answer;
    } catch (error) {
      lastError = error;
      console.warn(`${provider.name} failed:`, error.message);
    }
  }
  throw lastError;
}

async function streamVisionLlm(userText, options, onChunk) {
  return callQwenVision(userText, options, {
    stream: true,
    onChunk,
  });
}

function makeUserEvent(text, source = "pc") {
  return {
    type: "conversation.item.create",
    event_id: crypto.randomUUID(),
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
      source,
    },
  };
}

function makeAssistantEvent(text) {
  return {
    type: "response.done",
    event_id: crypto.randomUUID(),
    response: {
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        },
      ],
    },
  };
}

function broadcastUsageUpdate(session) {
  broadcast(session, {
    type: "usage.update",
    usage: getUsageSnapshot(),
  });
}

function logScreenshotTiming(requestId, label, startedAt) {
  if (!requestId) return;
  const elapsed = startedAt ? ` elapsedMs=${Date.now() - startedAt}` : "";
  const line = `[${new Date().toISOString()}] [screenshot:${requestId}] ${label}${elapsed}`;
  console.log(line);
  if (!screenshotTimingLogPath) return;
  try {
    fs.appendFileSync(screenshotTimingLogPath, `${line}\n`);
  } catch (error) {
    console.error("failed to write screenshot timing log:", error);
  }
}

async function handleSessionChatSend(session, msg) {
  if (session.busy) {
    broadcast(session, {
      type: "system.error",
      text: "上一条消息仍在处理中，请稍候。",
    });
    return;
  }

  const text = (msg.text || "").trim();
  if (!text) return;

  const creditCost = computeChatCreditCost({
    useResumeContext: Boolean(msg.useResumeContext),
    imageCount: msg.imageCount,
  });
  const quotaCheck = checkCanConsume(creditCost);
  if (!quotaCheck.ok) {
    broadcast(session, {
      type: "system.error",
      text: quotaCheck.message,
    });
    return;
  }

  session.busy = true;
  const userEvent = makeUserEvent(text, msg.source || "pc");
  appendEvent(session, userEvent);
  broadcast(session, { type: "event.append", event: userEvent });

  const responseId = crypto.randomUUID();
  try {
    const llmOptions = {
      useResumeContext: Boolean(msg.useResumeContext),
      resumeSummary: msg.resumeSummary || "",
      modelChoice: msg.modelChoice || "auto",
    };
    const answer = await streamLlm(
      text,
      llmOptions,
      (chunk) => {
        broadcast(session, {
          type: "response.delta",
          event_id: crypto.randomUUID(),
          response_id: responseId,
          delta: { text: chunk },
        });
      },
    );

    if (isQuotaEnabled()) {
      consumeCredits(creditCost, {
        source: msg.source || "pc",
        useResumeContext: Boolean(msg.useResumeContext),
        imageCount: Math.max(0, Number(msg.imageCount) || 0),
      });
      broadcastUsageUpdate(session);
    }

    const doneEvent = makeAssistantEvent(answer || "未生成回复。");
    appendEvent(session, doneEvent);
    broadcast(session, {
      type: "response.done",
      response_id: responseId,
      event: doneEvent,
    });
  } catch (error) {
    console.error("session chat error:", error);
    const errEvent = makeAssistantEvent(`请求失败：${error.message || error}`);
    appendEvent(session, errEvent);
    broadcast(session, {
      type: "response.done",
      response_id: responseId,
      event: errEvent,
    });
  } finally {
    session.busy = false;
  }
}

async function handleSessionVisionChat(session, msg) {
  if (session.busy) {
    broadcast(session, {
      type: "system.error",
      text: "上一条消息仍在处理中，请稍候。",
    });
    return;
  }

  const text = (msg.text || "").trim();
  const imageBase64 = normalizeImageDataUrl(msg.imageBase64);
  if (!text || !imageBase64) return;
  const requestId = msg.requestId || "";
  const startedAt = Date.now();
  logScreenshotTiming(requestId, `vision chat start imageChars=${imageBase64.length}`);

  const creditCost = computeChatCreditCost({
    useResumeContext: Boolean(msg.useResumeContext),
    imageCount: 1,
  });
  const quotaCheck = checkCanConsume(creditCost);
  if (!quotaCheck.ok) {
    broadcast(session, {
      type: "system.error",
      text: quotaCheck.message,
    });
    return;
  }

  session.busy = true;
  const userEvent = makeUserEvent(`${text}\n[screenshot]`, msg.source || "pc");
  appendEvent(session, userEvent);
  broadcast(session, { type: "event.append", event: userEvent });

  const responseId = crypto.randomUUID();
  try {
    const llmStartedAt = Date.now();
    let firstTokenLogged = false;
    const answer = await streamVisionLlm(
      text,
      {
        useResumeContext: Boolean(msg.useResumeContext),
        resumeSummary: msg.resumeSummary || "",
        modelChoice: "qwen-vl",
        imageBase64,
      },
      (chunk) => {
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          logScreenshotTiming(requestId, "vision llm first token", llmStartedAt);
        }
        broadcast(session, {
          type: "response.delta",
          event_id: crypto.randomUUID(),
          response_id: responseId,
          delta: { text: chunk },
        });
      },
    );
    logScreenshotTiming(requestId, `vision llm complete chars=${answer.length}`, llmStartedAt);

    if (isQuotaEnabled()) {
      consumeCredits(creditCost, {
        source: msg.source || "pc",
        useResumeContext: Boolean(msg.useResumeContext),
        imageCount: 1,
      });
      broadcastUsageUpdate(session);
    }

    const doneEvent = makeAssistantEvent(answer || "未生成回复。");
    appendEvent(session, doneEvent);
    broadcast(session, {
      type: "response.done",
      response_id: responseId,
      event: doneEvent,
    });
  } catch (error) {
    logScreenshotTiming(requestId, `vision chat failed error=${error?.message || String(error)}`);
    console.error("session vision chat error:", error);
    const errEvent = makeAssistantEvent(`请求失败：${error.message || error}`);
    appendEvent(session, errEvent);
    broadcast(session, {
      type: "response.done",
      response_id: responseId,
      event: errEvent,
    });
  } finally {
    session.busy = false;
    logScreenshotTiming(requestId, "vision chat complete", startedAt);
  }
}

async function handleSessionOcrChat(session, msg) {
  if (session.busy) {
    broadcast(session, {
      type: "system.error",
      text: "上一条消息仍在处理中，请稍候。",
    });
    return;
  }

  const text = (msg.text || "").trim() || "请解答图中内容，先给结论再给要点。";
  const imageBuffer = msg.imageBuffer;
  if (!imageBuffer?.length) return;
  const requestId = msg.requestId || "";
  const startedAt = Date.now();
  logScreenshotTiming(requestId, `ocr chat start bytes=${imageBuffer.length}`);

  const creditCost = computeChatCreditCost({
    useResumeContext: Boolean(msg.useResumeContext),
    imageCount: 1,
  });
  const quotaCheck = checkCanConsume(creditCost);
  if (!quotaCheck.ok) {
    broadcast(session, {
      type: "system.error",
      text: quotaCheck.message,
    });
    return;
  }

  session.busy = true;
  const userEvent = makeUserEvent(`${text}\n[screenshot]`, msg.source || "pc");
  appendEvent(session, userEvent);
  broadcast(session, { type: "event.append", event: userEvent });

  const responseId = crypto.randomUUID();
  try {
    const ocrStartedAt = Date.now();
    const ocrText = await recognizeImageBuffer(imageBuffer, msg.languageMode || "zh-CN");
    logScreenshotTiming(requestId, `ocr complete chars=${ocrText.length}`, ocrStartedAt);
    const llmText = `${text}\n\n${ocrText}`.trim();
    const llmStartedAt = Date.now();
    let firstTokenLogged = false;
    const answer = await streamLlm(
      llmText,
      {
        useResumeContext: Boolean(msg.useResumeContext),
        resumeSummary: msg.resumeSummary || "",
        modelChoice: msg.modelChoice || "auto",
      },
      (chunk) => {
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          logScreenshotTiming(requestId, "llm first token", llmStartedAt);
        }
        broadcast(session, {
          type: "response.delta",
          event_id: crypto.randomUUID(),
          response_id: responseId,
          delta: { text: chunk },
        });
      },
    );
    logScreenshotTiming(requestId, `llm complete chars=${answer.length}`, llmStartedAt);

    if (isQuotaEnabled()) {
      consumeCredits(creditCost, {
        source: msg.source || "pc",
        useResumeContext: Boolean(msg.useResumeContext),
        imageCount: 1,
      });
      broadcastUsageUpdate(session);
    }

    const doneEvent = makeAssistantEvent(answer || "未生成回复。");
    appendEvent(session, doneEvent);
    broadcast(session, {
      type: "response.done",
      response_id: responseId,
      event: doneEvent,
    });
  } catch (error) {
    console.error("session ocr chat error:", error);
    const errEvent = makeAssistantEvent(`请求失败：${error.message || error}`);
    appendEvent(session, errEvent);
    broadcast(session, {
      type: "response.done",
      response_id: responseId,
      event: errEvent,
    });
  } finally {
    session.busy = false;
    logScreenshotTiming(requestId, "ocr chat complete", startedAt);
  }
}

function handleSessionSystemNotify(session, text) {
  const t = (text || "").trim();
  if (!t) return;
  const event = makeAssistantEvent(t);
  appendEvent(session, event);
  broadcast(session, { type: "event.append", event });
}

function handleSessionTranscriptUpdate(session, text) {
  setLiveTranscript(session, text || "");
  broadcast(session, { type: "transcript.live", text: session.liveTranscript });
}

function handleSessionClear(session) {
  clearSession(session);
  broadcast(session, { type: "session.clear" });
}

function renderWatchPage(sessionId) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>&#25163;&#34920;&#21516;&#27493;</title>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; }
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: Arial, sans-serif;
      font-size: 19px;
      overflow: hidden;
    }
    .page { box-sizing: border-box; height: 100%; display: flex; flex-direction: column; }
    .top {
      flex: 0 0 auto;
      border-bottom: 1px solid #334155;
      background: #111827;
      padding: 7px 9px 6px;
    }
    .title { font-weight: bold; font-size: 18px; line-height: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { color: #cbd5e1; font-size: 14px; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #messages { flex: 1 1 auto; overflow-y: auto; padding: 8px 7px 10px; }
    .card {
      border-radius: 10px;
      background: #1e293b;
      color: #f8fafc;
      margin-bottom: 8px;
      padding: 8px 9px;
      font-size: 20px;
      line-height: 27px;
      word-break: break-word;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
    .user { background: #1d4ed8; color: #eff6ff; }
    .assistant { background: #1e293b; color: #f8fafc; }
    .empty { color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="title">&#25163;&#34920;&#21482;&#35835;&#21516;&#27493;</div>
      <div id="status" class="status">&#36830;&#25509;&#20013;</div>
    </div>
    <div id="messages"><div class="card empty">&#31561;&#24453;&#21516;&#27493;&#20869;&#23481;</div></div>
  </div>
  <script>
    (function () {
      var sessionId = ${JSON.stringify(sessionId)};
      var messages = [];
      var statusEl = document.getElementById("status");
      var messagesEl = document.getElementById("messages");

      function textOf(value) {
        return typeof value === "string" ? value : "";
      }

      function pushText(value, out) {
        value = textOf(value).replace(/^\s+|\s+$/g, "");
        if (value) out.push(value);
      }

      function collectContent(parts, out) {
        var i, part;
        if (!parts) return;
        if (typeof parts === "string") {
          pushText(parts, out);
          return;
        }
        if (Object.prototype.toString.call(parts) !== "[object Array]") return;
        for (i = 0; i < parts.length; i += 1) {
          part = parts[i] || {};
          pushText(part.text, out);
          pushText(part.transcript, out);
        }
      }

      function collectResponse(response, out) {
        var i, j, output, content;
        if (!response || !response.output) return;
        for (i = 0; i < response.output.length; i += 1) {
          output = response.output[i] || {};
          content = output.content || [];
          for (j = 0; j < content.length; j += 1) {
            pushText(content[j] && content[j].text, out);
            pushText(content[j] && content[j].transcript, out);
          }
        }
      }

      function eventToMessage(event) {
        var texts = [];
        var role = "assistant";
        if (!event || typeof event !== "object") return null;
        if (event.item && event.item.role) role = event.item.role;
        if (event.role) role = event.role;
        if (event.type && event.type.indexOf("input_audio_transcription") >= 0) role = "user";
        if (event.type === "conversation.item.create" && event.item && event.item.role === "user") role = "user";
        if (event.delta) {
          pushText(event.delta.text, texts);
          pushText(event.delta.transcript, texts);
        }
        if (event.item) collectContent(event.item.content || event.item.transcript, texts);
        if (event.response) collectResponse(event.response, texts);
        var text = texts.join("").replace(/^\s+|\s+$/g, "");
        if (!text) return null;
        return { role: role === "user" ? "user" : "assistant", text: text };
      }

      function compactMessages(list) {
        var out = [];
        var i, msg, prev;
        for (i = 0; i < list.length; i += 1) {
          msg = list[i];
          if (!msg || !msg.text) continue;
          prev = out[out.length - 1];
          if (prev && prev.role === msg.role && msg.text.length <= 3) {
            prev.text += msg.text;
          } else {
            out.push({ role: msg.role, text: msg.text, streaming: msg.streaming });
          }
        }
        return out;
      }

      function setStatus(text) {
        statusEl.innerHTML = "";
        statusEl.appendChild(document.createTextNode(text));
      }

      function appendMessage(msg) {
        if (!msg || !msg.text) return;
        messages.push({ role: msg.role, text: msg.text });
        messages = compactMessages(messages);
        if (messages.length > 18) messages = messages.slice(messages.length - 18);
        render();
      }

      function appendAssistantDelta(text) {
        var last;
        text = textOf(text);
        if (!text) return;
        last = messages[messages.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          last.text += text;
        } else {
          messages.push({ role: "assistant", text: text, streaming: true });
        }
        if (messages.length > 18) messages = messages.slice(messages.length - 18);
        render();
      }

      function finishAssistant(msg) {
        var last;
        if (!msg || !msg.text) return;
        last = messages[messages.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          last.text = msg.text;
          last.streaming = false;
          render();
          return;
        }
        appendMessage(msg);
      }

      function render() {
        var i, div;
        messagesEl.innerHTML = "";
        if (!messages.length) {
          div = document.createElement("div");
          div.className = "card empty";
          div.appendChild(document.createTextNode("已打开，等待同步内容"));
          messagesEl.appendChild(div);
          return;
        }
        for (i = 0; i < messages.length; i += 1) {
          div = document.createElement("div");
          div.className = "card " + messages[i].role;
          div.appendChild(document.createTextNode(messages[i].text));
          messagesEl.appendChild(div);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function handleMessage(raw) {
        var msg, list, i, parsed;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        if (msg.type === "snapshot") {
          messages = [];
          list = msg.events || [];
          for (i = list.length - 1; i >= 0; i -= 1) {
            parsed = eventToMessage(list[i]);
            if (parsed) messages.push(parsed);
          }
          messages = compactMessages(messages);
          setStatus("已连接");
          render();
        } else if (msg.type === "event.append") {
          appendMessage(eventToMessage(msg.event));
        } else if (msg.type === "response.done") {
          finishAssistant(eventToMessage(msg.event));
        } else if (msg.type === "response.delta") {
          appendAssistantDelta(msg.delta && msg.delta.text);
        } else if (msg.type === "transcript.live") {
          setStatus(msg.text ? "转写: " + msg.text : "已连接");
        } else if (msg.type === "session.clear") {
          messages = [];
          render();
        } else if (msg.type === "error") {
          setStatus(msg.message || "连接错误");
        }
      }

      function connect() {
        var proto = location.protocol === "https:" ? "wss:" : "ws:";
        var wsUrl = proto + "//" + location.host + "/ws/session?sessionId=" + encodeURIComponent(sessionId) + "&role=watch";
        try {
          var ws = new WebSocket(wsUrl);
          ws.onopen = function () { setStatus("已连接"); };
          ws.onmessage = function (event) { handleMessage(event.data); };
          ws.onerror = function () { setStatus("连接错误"); };
          ws.onclose = function () {
            setStatus("连接断开，重连中");
            setTimeout(connect, 2000);
          };
        } catch (e) {
          setStatus("浏览器不支持同步");
        }
      }

      render();
      connect();
    })();
  </script>
</body>
</html>`;
}
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/network-info", (_req, res) => {
  res.json(getNetworkInfo(serverPort));
});

app.post("/api/session", (_req, res) => {
  const sessionId = createSession();
  res.json({
    sessionId,
    mobilePath: `/m/${sessionId}`,
    ...getNetworkInfo(serverPort),
  });
});

app.get("/api/session/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  res.json({
    sessionId: session.id,
    eventCount: session.events.length,
    mobilePath: `/m/${session.id}`,
  });
});

app.get("/w/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).send("session not found");
    return;
  }
  res.status(200).set({ "Content-Type": "text/html; charset=utf-8" }).send(
    renderWatchPage(req.params.sessionId),
  );
});

app.get("/api/usage", (_req, res) => {
  res.json(getUsageSnapshot());
});

app.get("/api/stt/vocab-profiles", (_req, res) => {
  res.json({
    profiles: listSttVocabProfiles(),
    defaultProfile: getDefaultProfileId(),
  });
});

app.post("/api/usage/redeem", (req, res) => {
  try {
    const code = (req.body?.code || "").trim();
    if (!code) {
      res.status(400).json({ ok: false, error: "请输入充值码" });
      return;
    }
    const result = redeemRechargeCode(code);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (error) {
    console.error("usage redeem error:", error);
    res.status(500).json({ ok: false, error: "兑换失败，请稍后重试。" });
  }
});

app.post("/api/chat-text", async (req, res) => {
  try {
    const text = (req.body?.text || "").trim();
    const useResumeContext = Boolean(req.body?.useResumeContext);
    const resumeSummary = (req.body?.resumeSummary || "").trim();
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const creditCost = computeChatCreditCost({
      useResumeContext,
      imageCount: req.body?.imageCount,
    });
    const quotaCheck = checkCanConsume(creditCost);
    if (!quotaCheck.ok) {
      res.status(402).json({ error: quotaCheck.message, usage: getUsageSnapshot() });
      return;
    }
    const answer = await askLlm(text, {
      useResumeContext,
      resumeSummary,
      modelChoice: req.body?.modelChoice || "auto",
    });
    if (isQuotaEnabled()) {
      consumeCredits(creditCost, {
        source: "api",
        useResumeContext,
        imageCount: Math.max(0, Number(req.body?.imageCount) || 0),
      });
    }
    res.json({ transcript: text, answer, usage: getUsageSnapshot() });
  } catch (error) {
    console.error("chat-text error:", error);
    res.status(500).json({ error: "Failed to process text" });
  }
});

app.post("/api/vision-chat", imageUpload.single("image"), (req, res) => {
  try {
    const requestId = req.body?.requestId || "";
    logScreenshotTiming(requestId, `api vision-chat received bytes=${req.file?.buffer?.length || 0}`);
    const session = getSession(req.body?.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    if (session.busy) {
      res.status(409).json({ error: "busy" });
      return;
    }
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: "image is required" });
      return;
    }
    const imageBase64 = imageBufferToDataUrl(req.file.buffer, req.file.mimetype);
    if (!imageBase64) {
      res.status(400).json({ error: "unsupported image" });
      return;
    }

    res.json({ ok: true });
    handleSessionVisionChat(session, {
      requestId,
      text: req.body?.text || "请解答图中内容，先给结论再给要点。",
      imageBase64,
      source: req.body?.source || "pc",
      useResumeContext: req.body?.useResumeContext === "true",
      resumeSummary: req.body?.resumeSummary || "",
    }).catch((error) => {
      console.error("vision chat background error:", error);
      broadcast(session, {
        type: "system.error",
        text: `请求失败：${error.message || error}`,
      });
    });
  } catch (error) {
    console.error("vision-chat error:", error);
    res.status(500).json({ error: error.message || "vision chat failed" });
  }
});

app.post("/api/ocr-chat", imageUpload.single("image"), (req, res) => {
  try {
    const requestId = req.body?.requestId || "";
    logScreenshotTiming(requestId, `api ocr-chat received bytes=${req.file?.buffer?.length || 0}`);
    const session = getSession(req.body?.sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    if (session.busy) {
      res.status(409).json({ error: "busy" });
      return;
    }
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: "image is required" });
      return;
    }

    res.json({ ok: true });
    handleSessionOcrChat(session, {
      requestId,
      text: req.body?.text || "请解答图中内容，先给结论再给要点。",
      imageBuffer: req.file.buffer,
      source: req.body?.source || "pc",
      languageMode: req.body?.languageMode || "zh-CN",
      modelChoice: req.body?.modelChoice || "auto",
      useResumeContext: req.body?.useResumeContext === "true",
      resumeSummary: req.body?.resumeSummary || "",
    }).catch((error) => {
      console.error("ocr chat background error:", error);
      broadcast(session, {
        type: "system.error",
        text: `请求失败：${error.message || error}`,
      });
    });
  } catch (error) {
    console.error("ocr-chat error:", error);
    res.status(500).json({ error: error.message || "ocr chat failed" });
  }
});

app.post("/api/ocr", imageUpload.single("image"), async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: "请上传图片" });
      return;
    }
    const languageMode = (req.body?.languageMode || "zh-CN").trim();
    const text = await recognizeImageBuffer(req.file.buffer, languageMode);
    res.json({ text });
  } catch (error) {
    console.error("ocr error:", error);
    res.status(500).json({ error: error.message || "OCR 识别失败" });
  }
});

app.post("/api/resume-md", async (req, res) => {
  try {
    const content = (req.body?.content || "").trim();
    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    latestResumeSummary = buildResumeSummaryFromMarkdown(content);
    res.json({ summary: latestResumeSummary });
  } catch (error) {
    console.error("resume-md error:", error);
    res.status(500).json({ error: "Failed to process resume markdown" });
  }
});

app.post(
  "/api/transcribe-and-answer",
  express.raw({ type: () => true, limit: "25mb" }),
  async (req, res) => {
    try {
      if (!deepgramApiKey) {
        res.status(500).json({ error: "Missing DEEPGRAM_API_KEY" });
        return;
      }
      const audioBuffer = req.body;
      if (!audioBuffer || !audioBuffer.length) {
        res.status(400).json({ error: "audio body is required" });
        return;
      }

      const vocabProfile = normalizeProfileId(req.query.vocab || req.headers["x-stt-vocab-profile"]);
      const dgListenUrl = buildDeepgramListenUrl(
        {
          model: "nova-3",
          smart_format: "true",
          punctuate: "true",
        },
        vocabProfile,
      );
      const dgResp = await fetch(dgListenUrl, {
        method: "POST",
        headers: {
          Authorization: `Token ${deepgramApiKey}`,
          "Content-Type": req.headers["content-type"] || "audio/webm",
        },
        body: audioBuffer,
      });

      if (!dgResp.ok) {
        const detail = await dgResp.text();
        throw new Error(`Deepgram request failed (${dgResp.status}): ${detail}`);
      }
      const dgData = await dgResp.json();
      const applyReplacements = true;
      const transcript = normalizeTranscript(
        dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "",
        { profileId: vocabProfile, applyReplacements },
      );
      if (!transcript) {
        res.json({ transcript: "", answer: "未识别到有效语音内容。" });
        return;
      }

      const answer = await askLlm(transcript, {
        modelChoice: req.body?.modelChoice || "auto",
      });
      res.json({ transcript, answer });
    } catch (error) {
      console.error("transcribe-and-answer error:", error);
      res.status(500).json({ error: "Failed to transcribe audio or answer" });
    }
  },
);

export async function startServer(options = {}) {
  const rootDir = options.rootDir || __dirname;
  const isProduction = options.production ?? process.env.NODE_ENV === "production";
  serverPort = Number(options.port || process.env.PORT) || 3000;
  const port = serverPort;

  if (options.envPath) {
    dotenv.config({ path: options.envPath, override: true });
  }

  const usageDataDir =
    options.userDataDir || path.join(rootDir, ".data", "usage");
  screenshotTimingLogPath = path.join(usageDataDir, "screenshot-timing.log");
  initUsageQuota({ dataDir: usageDataDir });
  initSttVocabulary();

  const activeVite = await setupClientServing({ isProduction, rootDir });

  app.use("*", async (req, res, next) => {
    try {
      const html = await renderClientPage(req.originalUrl, { isProduction, rootDir, activeVite });
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      if (activeVite) activeVite.ssrFixStacktrace(e);
      next(e);
    }
  });

  if (httpServer.listening) {
    return { port, httpServer, close: () => Promise.resolve() };
  }

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "0.0.0.0", () => {
      httpServer.removeListener("error", reject);
      const network = getNetworkInfo(port);
      console.log(`Express server running on port ${port}`);
      if (network.lanIp) {
        console.log(`  PC:     http://localhost:${port}`);
        console.log(`  Mobile: http://${network.lanIp}:${port}`);
      }
      const wecomBot = initWecomBot({
        onChat: async (text) => askLlm(text, { modelChoice: "auto" }),
      });
      resolve({
        port,
        httpServer,
        close: () =>
          new Promise((res, rej) => {
            wecomBot.stop();
            httpServer.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  await startServer();
}

const dgWss = new WebSocketServer({ noServer: true });
const sessionWss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname === "/ws/deepgram-stt") {
    dgWss.handleUpgrade(req, socket, head, (ws) => {
      dgWss.emit("connection", ws, req);
    });
    return;
  }
  if (pathname === "/ws/session") {
    sessionWss.handleUpgrade(req, socket, head, (ws) => {
      sessionWss.emit("connection", ws, req);
    });
    return;
  }
  // Vite already handles its own HMR upgrades through hmr.server.
});

dgWss.on("connection", (clientWs, req) => {
  if (!deepgramApiKey) {
    clientWs.send(JSON.stringify({ type: "error", message: "Missing DEEPGRAM_API_KEY" }));
    clientWs.close();
    return;
  }

  const requestUrl = new URL(req.url || "/ws/deepgram-stt", "http://localhost");
  const lang = requestUrl.searchParams.get("lang") || "zh-CN";
  const vocabProfile = normalizeProfileId(requestUrl.searchParams.get("vocab"));
  const applyReplacements = lang === "zh-CN" || lang === "ja";
  const dgUrl = buildDeepgramStreamUrl(
    {
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      punctuate: "true",
      model: "nova-3",
      language: lang,
      endpointing: "300",
      vad_events: "true",
    },
    vocabProfile,
  );
  const dgWs = new WebSocket(dgUrl, {
    headers: { Authorization: `Token ${deepgramApiKey}` },
  });

  dgWs.on("open", () => {
    clientWs.send(JSON.stringify({ type: "ready" }));
  });

  dgWs.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const alt = msg?.channel?.alternatives?.[0];
      const text = normalizeTranscript(alt?.transcript?.trim(), {
        profileId: vocabProfile,
        applyReplacements,
      });
      if (!text) return;
      clientWs.send(
        JSON.stringify({
          type: "transcript",
          text,
          isFinal: Boolean(msg?.is_final),
        }),
      );
    } catch {
      // ignore parse errors
    }
  });

  dgWs.on("error", (err) => {
    clientWs.send(JSON.stringify({ type: "error", message: String(err) }));
  });

  dgWs.on("close", (code, reason) => {
    if (code !== 1000) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          message: `Deepgram websocket closed: code=${code}, reason=${reason?.toString() || ""}`,
        }),
      );
    }
  });

  clientWs.on("message", (data, isBinary) => {
    if (dgWs.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      dgWs.send(data);
    } else {
      const text = data.toString();
      if (text === "close") {
        dgWs.send(JSON.stringify({ type: "CloseStream" }));
      }
    }
  });

  const cleanup = () => {
    if (dgWs.readyState === WebSocket.OPEN) {
      try {
        dgWs.send(JSON.stringify({ type: "CloseStream" }));
      } catch {}
      dgWs.close();
    }
  };
  clientWs.on("close", cleanup);
  clientWs.on("error", cleanup);
});

sessionWss.on("connection", (clientWs, req) => {
  const requestUrl = new URL(req.url || "/ws/session", "http://localhost");
  const sessionId = requestUrl.searchParams.get("sessionId");
  const role = requestUrl.searchParams.get("role") || "pc";

  if (!sessionId) {
    clientWs.send(JSON.stringify({ type: "error", message: "sessionId is required" }));
    clientWs.close();
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    clientWs.send(JSON.stringify({ type: "error", message: "session not found" }));
    clientWs.close();
    return;
  }

  clientWs.sessionRole = role;
  addClient(session, clientWs);
  sendSnapshot(clientWs, session);

  clientWs.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case "chat.send":
          await handleSessionChatSend(session, msg);
          break;
        case "system.notify":
          handleSessionSystemNotify(session, msg.text);
          break;
        case "transcript.update":
          handleSessionTranscriptUpdate(session, msg.text);
          break;
        case "session.clear":
          handleSessionClear(session);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error("session ws message error:", error);
      clientWs.send(
        JSON.stringify({ type: "error", message: error.message || "invalid message" }),
      );
    }
  });

  const cleanup = () => {
    removeClient(session, clientWs);
  };
  clientWs.on("close", cleanup);
  clientWs.on("error", cleanup);
});
