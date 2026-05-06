import express from "express";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json({ limit: "2mb" }));

const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
const cerebrasApiKey = process.env.CEREBRAS_API_KEY;
const cerebrasModel = process.env.CEREBRAS_MODEL || "llama3.1-8b";
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

// Configure Vite middleware for React client
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});
app.use(vite.middlewares);

async function askCerebras(userText, options = {}) {
  const { useResumeContext = false, resumeSummary = "" } = options;
  if (!cerebrasApiKey) {
    throw new Error("Missing CEREBRAS_API_KEY");
  }
  const injectedResume = (resumeSummary || latestResumeSummary || "").trim();
  const shouldUseResume = useResumeContext && injectedResume && isResumeRelated(userText);
  const prompt = shouldUseResume
    ? `${systemPrompt}\n\n补充约束：仅当问题涉及候选人经历时，参考以下简历摘要回答；若是基础通识题，按通用标准答案回答，不要强行套简历。\n\n简历摘要：\n${injectedResume}`
    : systemPrompt;

  const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cerebrasApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cerebrasModel,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userText },
      ],
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Cerebras request failed (${resp.status}): ${detail}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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
    const answer = await askCerebras(text, { useResumeContext, resumeSummary });
    res.json({ transcript: text, answer });
  } catch (error) {
    console.error("chat-text error:", error);
    res.status(500).json({ error: "Failed to process text" });
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

      const answer = await askCerebras(transcript);
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

const httpServer = app.listen(port, () => {
  console.log(`Express server running on *:${port}`);
});

const dgWss = new WebSocketServer({ server: httpServer, path: "/ws/deepgram-stt" });

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
