import { useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import ChatWindow from "./ChatWindow";
import SessionControls from "./SessionControls";
import MobileSyncPanel from "./MobileSyncPanel";
import SessionToolbar from "./SessionToolbar";
import { useSessionSync } from "../hooks/useSessionSync";
import { loadLlmModelChoice, saveLlmModelChoice } from "../lib/llmModels";
import { recognizeImageFile } from "../lib/ocrClient";

const TARGET_SR = 16000;
const SYNC_SESSION_KEY = "sync_session_id";

function downsampleTo16k(input, inputRate) {
  if (inputRate === TARGET_SR) return input;
  const ratio = inputRate / TARGET_SR;
  const newLen = Math.floor(input.length / ratio);
  const out = new Float32Array(newLen);
  let offset = 0;
  for (let i = 0; i < newLen; i += 1) {
    const next = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = offset; j < next && j < input.length; j += 1) {
      sum += input[j];
      count += 1;
    }
    out[i] = count ? sum / count : 0;
    offset = next;
  }
  return out;
}

function floatToInt16Bytes(float32) {
  const arr = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    arr[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return arr.buffer;
}

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [autoSendEnabled, setAutoSendEnabled] = useState(true);
  const [minSendChars, setMinSendChars] = useState(6);
  const [languageMode, setLanguageMode] = useState("zh-CN");
  const [useResumeContext, setUseResumeContext] = useState(false);
  const [resumeSummary, setResumeSummary] = useState("");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [llmModelChoice, setLlmModelChoice] = useState(() => loadLlmModelChoice());
  const [composerBusy, setComposerBusy] = useState(false);

  const sync = useSessionSync({
    role: "pc",
    onSessionInvalid: () => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(SYNC_SESSION_KEY);
      }
    },
  });
  const llmModelChoiceRef = useRef(loadLlmModelChoice());

  const captureStream = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const processorRef = useRef(null);
  const dgSocketRef = useRef(null);
  const finalTextRef = useRef("");
  const partialTextRef = useRef("");
  const silenceTimerRef = useRef(null);
  const autoSendEnabledRef = useRef(false);
  const minSendCharsRef = useRef(6);
  const chatScrollContainer = useRef(null);
  const activeAudioSourceRef = useRef("none");
  const transcriptSyncTimerRef = useRef(null);
  const sendMessageWithImagesRef = useRef(null);

  async function sendToLlm(text) {
    const t = text.trim();
    if (!t) return;
    await sync.sendChat(t, {
      useResumeContext,
      resumeSummary,
      source: "pc",
      modelChoice: llmModelChoiceRef.current,
    });
  }

  function getCurrentTranscript() {
    return `${finalTextRef.current} ${partialTextRef.current}`.trim();
  }

  function countEffectiveChars(text) {
    return text.replace(/\s+/g, "").length;
  }

  function pushLiveTranscript(text) {
    if (transcriptSyncTimerRef.current) {
      clearTimeout(transcriptSyncTimerRef.current);
    }
    transcriptSyncTimerRef.current = setTimeout(() => {
      sync.sendTranscript(text).catch(() => {});
    }, 150);
  }

  function scheduleAutoSend() {
    if (!autoSendEnabledRef.current) return;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(async () => {
      const text = getCurrentTranscript();
      if (!text) return;
      if (countEffectiveChars(text) < minSendCharsRef.current) return;
      finalTextRef.current = "";
      partialTextRef.current = "";
      pushLiveTranscript("");
      await sendToLlm(text);
    }, 800);
  }

  function connectDeepgramSocket(lang) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${protocol}://${window.location.host}/ws/deepgram-stt?lang=${encodeURIComponent(lang)}`,
    );
    ws.binaryType = "arraybuffer";
    dgSocketRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === "error") {
          sync.sendSystem(`转写通道错误: ${msg.message || "unknown error"}`).catch(() => {});
          return;
        }
        if (msg.type === "ready") {
          sync.sendSystem(`转写通道已连接（语言: ${lang}）。`).catch(() => {});
          return;
        }
        if (msg.type !== "transcript") return;
        if (msg.isFinal) {
          finalTextRef.current = `${finalTextRef.current} ${msg.text}`.trim();
          partialTextRef.current = "";
          scheduleAutoSend();
        } else {
          partialTextRef.current = msg.text || "";
        }
        pushLiveTranscript(getCurrentTranscript());
      } catch {
        // ignore parse errors
      }
    };

    return ws;
  }

  async function startSession(options = {}) {
    const { audioSource = "none" } = options;
    if (
      ["screen", "mic"].includes(audioSource) &&
      (!window.isSecureContext || !navigator.mediaDevices)
    ) {
      throw new Error(
        "浏览器阻止了音频权限。请在这台电脑上使用 http://localhost:3000 打开；局域网 IP 的 HTTP 页面只能使用文字模式。",
      );
    }
    activeAudioSourceRef.current = audioSource;
    const sessionId = await sync.clearSession();
    if (sessionId) {
      window.localStorage.setItem(SYNC_SESSION_KEY, sessionId);
    }

    if (audioSource === "none") {
      setIsSessionActive(true);
      return;
    }

    let stream;
    if (audioSource === "screen") {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!stream.getAudioTracks().length) {
        throw new Error("未捕获到系统音频，请在授权弹窗中勾选系统音频");
      }
    } else if (audioSource === "mic") {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!stream.getAudioTracks().length) {
        throw new Error("未捕获到麦克风音频，请检查麦克风权限");
      }
    } else {
      throw new Error(`未知音频输入源: ${audioSource}`);
    }
    captureStream.current = stream;

    connectDeepgramSocket(languageMode);

    const audioOnly = new MediaStream([stream.getAudioTracks()[0]]);
    const ac = new window.AudioContext();
    const src = ac.createMediaStreamSource(audioOnly);
    const proc = ac.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (event) => {
      if (!dgSocketRef.current || dgSocketRef.current.readyState !== WebSocket.OPEN) return;
      const float = event.inputBuffer.getChannelData(0);
      const down = downsampleTo16k(float, ac.sampleRate);
      const buf = floatToInt16Bytes(down);
      dgSocketRef.current.send(buf);
    };
    src.connect(proc);
    proc.connect(ac.destination);

    audioContextRef.current = ac;
    sourceNodeRef.current = src;
    processorRef.current = proc;

    setIsSessionActive(true);
  }

  function stopSession() {
    activeAudioSourceRef.current = "none";
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (captureStream.current) {
      captureStream.current.getTracks().forEach((t) => t.stop());
      captureStream.current = null;
    }
    if (dgSocketRef.current) {
      try { dgSocketRef.current.close(); } catch {}
      dgSocketRef.current = null;
    }

    finalTextRef.current = "";
    partialTextRef.current = "";
    pushLiveTranscript("");
    setIsSessionActive(false);
  }

  async function sendMessageWithImages({ text = "", files = [] } = {}) {
    const trimmed = text.trim();
    const imageFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!trimmed && imageFiles.length === 0) return;

    setComposerBusy(true);
    try {
      if (!isSessionActive) {
        await startSession({ audioSource: "none" });
      }

      const ocrTexts = [];
      for (let i = 0; i < imageFiles.length; i += 1) {
        const ocrText = await recognizeImageFile(imageFiles[i], languageMode);
        ocrTexts.push(ocrText);
      }

      const parts = [];
      if (trimmed) parts.push(trimmed);
      if (ocrTexts.length) {
        const body = ocrTexts
          .map((ocrText, index) =>
            ocrTexts.length > 1 ? `图${index + 1}:\n${ocrText}` : ocrText,
          )
          .join("\n\n");
        parts.push(`【图片识别内容】\n${body}`);
      }

      await sendToLlm(parts.join("\n\n"));
    } catch (error) {
      const message = error?.message || String(error);
      window.alert(message);
      sync.sendSystem(`图片识别失败：${message}`).catch(() => {});
    } finally {
      setComposerBusy(false);
    }
  }
  sendMessageWithImagesRef.current = sendMessageWithImages;

  async function uploadResumeMd(file) {
    const text = await file.text();
    const response = await fetch("/api/resume-md", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!response.ok) {
      sync.sendSystem(`简历上传失败（${response.status}）`).catch(() => {});
      return;
    }
    const data = await response.json();
    setResumeSummary(data.summary || "");
    setUseResumeContext(true);
    sync.sendSystem("简历已上传并生成摘要，已开启简历上下文。").catch(() => {});
  }

  async function submitTranscript() {
    const text = getCurrentTranscript();
    if (!text) {
      sync.sendSystem("暂无可发送转写，请先播放系统音频。").catch(() => {});
      return;
    }
    if (countEffectiveChars(text) < minSendChars) {
      sync.sendSystem(`转写字数不足 ${minSendChars}，已拦截发送。`).catch(() => {});
      return;
    }
    finalTextRef.current = "";
    partialTextRef.current = "";
    pushLiveTranscript("");
    await sendToLlm(text);
  }

  async function openMobileSync() {
    setMobilePanelOpen(true);
    try {
      if (sync.sessionId) {
        await sync.ensureSession();
      } else {
        const saved = window.localStorage.getItem(SYNC_SESSION_KEY);
        if (saved) {
          await sync.restoreSession(saved);
        }
      }
    } catch (error) {
      console.error("mobile sync connect failed:", error);
    }
  }

  async function createOrRefreshMobileSession() {
    try {
      const id = await sync.createSession();
      window.localStorage.setItem(SYNC_SESSION_KEY, id);
    } catch (error) {
      window.alert(error?.message || String(error));
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("auto_send_enabled");
    if (saved !== null) {
      setAutoSendEnabled(saved === "true");
    }
    const savedSession = window.localStorage.getItem(SYNC_SESSION_KEY);
    if (savedSession) {
      sync.restoreSession(savedSession).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.desktopApp?.onScreenshot) return undefined;
    return window.desktopApp.onScreenshot(async ({ imageBase64 }) => {
      try {
        const blob = await fetch(imageBase64).then((response) => response.blob());
        const file = new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" });
        await sendMessageWithImagesRef.current?.({
          text: "请解答图中内容，先给结论再给要点。",
          files: [file],
        });
      } catch (error) {
        window.alert(error?.message || String(error));
      }
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    autoSendEnabledRef.current = autoSendEnabled;
    window.localStorage.setItem("auto_send_enabled", String(autoSendEnabled));
  }, [autoSendEnabled]);

  useEffect(() => {
    minSendCharsRef.current = minSendChars;
  }, [minSendChars]);

  useEffect(() => {
    llmModelChoiceRef.current = llmModelChoice;
    saveLlmModelChoice(llmModelChoice);
  }, [llmModelChoice]);

  useEffect(() => {
    if (!isSessionActive) return;
    if (!["screen", "mic"].includes(activeAudioSourceRef.current)) return;
    if (!captureStream.current) return;
    if (dgSocketRef.current) {
      try { dgSocketRef.current.close(); } catch {}
    }
    connectDeepgramSocket(languageMode);
  }, [languageMode, isSessionActive]);

  useEffect(() => {
    if (chatScrollContainer.current) {
      chatScrollContainer.current.scrollTop = chatScrollContainer.current.scrollHeight;
    }
  }, [sync.events]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <nav className="shrink-0 z-10 bg-[var(--color-base)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 w-full px-4 py-3 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} alt="" className="shrink-0" />
          <h1 className="shrink-0">realtime console</h1>
          <div className="flex flex-wrap items-center gap-2 ml-auto shrink-0">
            <SessionToolbar
              llmModelChoice={llmModelChoice}
              setLlmModelChoice={setLlmModelChoice}
              isSessionActive={isSessionActive}
              minSendChars={minSendChars}
              setMinSendChars={setMinSendChars}
              languageMode={languageMode}
              setLanguageMode={setLanguageMode}
              liveTranscript={sync.liveTranscript}
            />
            <button
              type="button"
              onClick={openMobileSync}
              className="text-sm px-3 py-1.5 rounded-full bg-teal-600 text-white hover:bg-teal-700 shrink-0"
            >
              手机同步
            </button>
          </div>
        </div>
      </nav>
      <MobileSyncPanel
        open={mobilePanelOpen}
        onClose={() => setMobilePanelOpen(false)}
        sessionId={sync.sessionId}
        connected={sync.connected}
        connectionError={sync.connectionError}
        onCreateOrOpen={createOrRefreshMobileSession}
      />
      <main className="flex-1 min-h-0 flex flex-col">
        <section ref={chatScrollContainer} className="flex-1 min-h-0 px-4 py-2 overflow-y-auto">
          <ChatWindow events={sync.events} />
        </section>
        <section className="shrink-0 min-h-28 max-h-[45vh] px-4 pb-4 overflow-y-auto">
          <SessionControls
            startSession={startSession}
            stopSession={stopSession}
            sendMessageWithImages={sendMessageWithImages}
            submitTranscript={submitTranscript}
            isSessionActive={isSessionActive}
            autoSendEnabled={autoSendEnabled}
            setAutoSendEnabled={setAutoSendEnabled}
            useResumeContext={useResumeContext}
            setUseResumeContext={setUseResumeContext}
            resumeSummary={resumeSummary}
            setResumeSummary={setResumeSummary}
            uploadResumeMd={uploadResumeMd}
            composerBusy={composerBusy}
          />
        </section>
      </main>
    </div>
  );
}
