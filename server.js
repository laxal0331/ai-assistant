import express from "express";
import fs from "fs";
import { createServer } from "http";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import "dotenv/config";
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

const app = express();
const port = Number(process.env.PORT) || 3000;
const httpServer = createServer(app);
app.use(express.json({ limit: "2mb" }));
const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
const cerebrasApiKey = process.env.CEREBRAS_API_KEY;
const cerebrasModel = process.env.CEREBRAS_MODEL || "llama3.1-8b";
const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const deepseekBaseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const llmMaxTokens = Number(process.env.LLM_MAX_TOKENS) || 400;
const llmProviderOrder = (process.env.LLM_PROVIDER_ORDER || "cerebras,deepseek")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const systemPrompt =
  process.env.SYSTEM_PROMPT ||
  "你是中文AI助手。先给结论，再给要点，语言简洁。";
let latestResumeSummary = "";

const TERM_NORMALIZATIONS = [
  [/\bmy\s*sql\b/gi, "MySQL"],
  [/\bpost\s*gre\s*sql\b/gi, "PostgreSQL"],
  [/\bredis\b/gi, "Redis"],
  [/\bspring\s*boot\b/gi, "Spring Boot"],
  [/\bspring\s*cloud\b/gi, "Spring Cloud"],
  [/\bj\s*v\s*m\b/gi, "JVM"],
  [/\bjava\s*script\b/gi, "JavaScript"],
  [/\btype\s*script\b/gi, "TypeScript"],
  [/\bnode\s*js\b/gi, "Node.js"],
  [/\breact\s*js\b/gi, "React"],
  [/\bvue\s*js\b/gi, "Vue"],
  [/\bnext\s*js\b/gi, "Next.js"],
  [/\bnuxt\s*js\b/gi, "Nuxt.js"],
  [/\brest\s*api\b/gi, "REST API"],
  [/\bgraphql\b/gi, "GraphQL"],
  [/\bkafka\b/gi, "Kafka"],
  [/\brabbit\s*mq\b/gi, "RabbitMQ"],
  [/\bnginx\b/gi, "Nginx"],
  [/\bkubernetes\b/gi, "Kubernetes"],
  [/\bdocker\b/gi, "Docker"],
  [/\bci\s*cd\b/gi, "CI/CD"],
];

function normalizeTranscript(text, applyEnglishTerms = true) {
  let out = (text || "").trim();
  if (!out) return out;
  if (!applyEnglishTerms) return out;
  for (const [pattern, replacement] of TERM_NORMALIZATIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

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

// Configure Vite middleware for React client (HMR shares httpServer to avoid port conflicts)
const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: { server: httpServer },
  },
  appType: "custom",
});
app.use(vite.middlewares);

function buildChatPrompt(userText, options = {}) {
  const { useResumeContext = false, resumeSummary = "" } = options;
  const injectedResume = (resumeSummary || latestResumeSummary || "").trim();
  const shouldUseResume = useResumeContext && injectedResume && isResumeRelated(userText);
  return shouldUseResume
    ? `${systemPrompt}\n\n补充约束：仅当问题涉及候选人经历时，参考以下简历摘要回答；若是基础通识题，按通用标准答案回答，不要强行套简历。\n\n简历摘要：\n${injectedResume}`
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

function getLlmProviders(modelChoice) {
  return resolveLlmProviders(modelChoice);
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

async function askLlm(userText, options = {}) {
  const providers = getLlmProviders(options.modelChoice);
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
  const providers = getLlmProviders(options.modelChoice);
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

  session.busy = true;
  const userEvent = makeUserEvent(text, msg.source || "pc");
  appendEvent(session, userEvent);
  broadcast(session, { type: "event.append", event: userEvent });

  const responseId = crypto.randomUUID();
  try {
    const answer = await streamLlm(
      text,
      {
        useResumeContext: Boolean(msg.useResumeContext),
        resumeSummary: msg.resumeSummary || "",
        modelChoice: msg.modelChoice || "auto",
      },
      (chunk) => {
        broadcast(session, {
          type: "response.delta",
          event_id: crypto.randomUUID(),
          response_id: responseId,
          delta: { text: chunk },
        });
      },
    );

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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/network-info", (_req, res) => {
  res.json(getNetworkInfo(port));
});

app.post("/api/session", (_req, res) => {
  const sessionId = createSession();
  res.json({
    sessionId,
    mobilePath: `/m/${sessionId}`,
    ...getNetworkInfo(port),
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

app.post("/api/chat-text", async (req, res) => {
  try {
    const text = (req.body?.text || "").trim();
    const useResumeContext = Boolean(req.body?.useResumeContext);
    const resumeSummary = (req.body?.resumeSummary || "").trim();
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    const answer = await askLlm(text, {
      useResumeContext,
      resumeSummary,
      modelChoice: req.body?.modelChoice || "auto",
    });
    res.json({ transcript: text, answer });
  } catch (error) {
    console.error("chat-text error:", error);
    res.status(500).json({ error: "Failed to process text" });
  }
});

app.post("/api/ocr", ocrUpload.single("image"), async (req, res) => {
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

      const dgResp = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true",
        {
          method: "POST",
          headers: {
            Authorization: `Token ${deepgramApiKey}`,
            "Content-Type": req.headers["content-type"] || "audio/webm",
          },
          body: audioBuffer,
        },
      );

      if (!dgResp.ok) {
        const detail = await dgResp.text();
        throw new Error(`Deepgram request failed (${dgResp.status}): ${detail}`);
      }
      const dgData = await dgResp.json();
      const transcript = normalizeTranscript(
        dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "",
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

// Render the React client
app.use("*", async (req, res, next) => {
  const url = req.originalUrl;

  try {
    const template = await vite.transformIndexHtml(
      url,
      fs.readFileSync("./client/index.html", "utf-8"),
    );
    const { render } = await vite.ssrLoadModule("./client/entry-server.jsx");
    const appHtml = await render(url);
    const html = template.replace(`<!--ssr-outlet-->`, appHtml?.html);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  } catch (e) {
    vite.ssrFixStacktrace(e);
    next(e);
  }
});

httpServer.listen(port, "0.0.0.0", () => {
  const network = getNetworkInfo(port);
  console.log(`Express server running on port ${port}`);
  if (network.lanIp) {
    console.log(`  PC:     http://localhost:${port}`);
    console.log(`  Mobile: http://${network.lanIp}:${port}`);
  }
});

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
  const applyEnglishTerms = lang === "zh-CN" || lang === "ja";
  const dgUrl =
    `wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&interim_results=true&punctuate=true&model=nova-3&language=${encodeURIComponent(lang)}&endpointing=300&vad_events=true`;
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
      const text = normalizeTranscript(alt?.transcript?.trim(), applyEnglishTerms);
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
