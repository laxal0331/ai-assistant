import { useEffect, useRef, useState } from "react";
import logo from "/assets/app-icon.png";
import ChatWindow from "./ChatWindow";
import SessionControls from "./SessionControls";
import MobileSyncPanel from "./MobileSyncPanel";
import SettingsPanel from "./SettingsPanel";
import { useSessionSync } from "../hooks/useSessionSync";
import { loadLlmModelChoice, saveLlmModelChoice } from "../lib/llmModels";
import {
  getSttVocabProfileLabel,
  loadSttVocabProfile,
  saveSttVocabProfile,
  STT_VOCAB_PROFILE_OPTIONS,
} from "../lib/sttVocabProfile";
import { recognizeImageFile } from "../lib/ocrClient";
import { computeChatCreditCost } from "../lib/usageCost";
import { buildLlmUserMessage } from "../lib/buildLlmUserMessage";
import { keyboardEventToAccelerator } from "../lib/screenshotHotkey";

const TARGET_SR = 16000;
const SYNC_SESSION_KEY = "sync_session_id";
const MIC_PAUSE_ACCELERATOR = "Control+X";
const AUTO_SCROLL_THRESHOLD_PX = 80;
const RESUME_CONTEXT_ENABLED_KEY = "resume_context_enabled";
const RESUME_SUMMARY_KEY = "resume_summary";

function isNearScrollBottom(container) {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    AUTO_SCROLL_THRESHOLD_PX
  );
}

function isEditableTarget(target) {
  if (!target || typeof target !== "object") return false;
  const el = /** @type {HTMLElement} */ (target);
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return Boolean(el.isContentEditable);
}

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
  const [sttVocabProfile, setSttVocabProfile] = useState(() => loadSttVocabProfile());
  const [useResumeContext, setUseResumeContext] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(RESUME_CONTEXT_ENABLED_KEY) === "true";
  });
  const [resumeSummary, setResumeSummary] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(RESUME_SUMMARY_KEY) || "";
  });
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [llmModelChoice, setLlmModelChoice] = useState(() => loadLlmModelChoice());
  const [composerBusy, setComposerBusy] = useState(false);
  const [activeAudioSource, setActiveAudioSource] = useState("none");
  const [micTranscriptionPaused, setMicTranscriptionPaused] = useState(false);
  const [screenshotSilentSend, setScreenshotSilentSend] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

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
  const shouldAutoScrollChatRef = useRef(true);
  const activeAudioSourceRef = useRef("none");
  const transcriptSyncTimerRef = useRef(null);
  const sendScreenshotToVisionRef = useRef(null);
  const micTranscriptionPausedRef = useRef(false);
  const screenshotSilentSendRef = useRef(false);

  function reportComposerError(message, silentUi = false) {
    const text = message || "未知错误";
    if (silentUi) {
      sync.sendSystem(`截图问 AI 失败：${text}`).catch(() => {});
      window.desktopApp?.showNotification?.({
        title: "截图问 AI",
        body: text,
      });
      return;
    }
    window.alert(text);
  }

  async function sendToLlm(text, options = {}) {
    const t = text.trim();
    if (!t) return;
    await sync.sendChat(t, {
      useResumeContext,
      resumeSummary,
      source: "pc",
      modelChoice: llmModelChoiceRef.current,
      imageCount: Math.max(0, Number(options.imageCount) || 0),
    });
  }

  async function ensureEnoughCredits(imageCount = 0) {
    const cost = computeChatCreditCost({ imageCount, useResumeContext });
    let usage = sync.usage;
    if (!usage) {
      usage = await sync.refreshUsage();
    }
    if (usage?.enabled && usage.remaining < cost) {
      throw new Error(
        `次数不足（需要 ${cost} 次，剩余 ${usage.remaining} 次）。请在设置中兑换充值码或联系管理员加次数。`,
      );
    }
    return cost;
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
    if (micTranscriptionPausedRef.current) return;
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

  function connectDeepgramSocket(lang, vocabProfile) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${protocol}://${window.location.host}/ws/deepgram-stt?lang=${encodeURIComponent(lang)}&vocab=${encodeURIComponent(vocabProfile)}`,
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
          sync
            .sendSystem(
              `转写通道已连接（语言: ${lang}，词汇: ${getSttVocabProfileLabel(vocabProfile)}）。`,
            )
            .catch(() => {});
          return;
        }
        if (msg.type !== "transcript") return;
        if (micTranscriptionPausedRef.current) return;
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

  function resetMicTranscriptionPause() {
    micTranscriptionPausedRef.current = false;
    setMicTranscriptionPaused(false);
  }

  function clearTranscriptBuffers() {
    finalTextRef.current = "";
    partialTextRef.current = "";
    pushLiveTranscript("");
  }

  function pauseMicTranscription() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    clearTranscriptBuffers();
    if (dgSocketRef.current) {
      try {
        if (dgSocketRef.current.readyState === WebSocket.OPEN) {
          dgSocketRef.current.send("close");
        }
      } catch {}
      try {
        dgSocketRef.current.close();
      } catch {}
      dgSocketRef.current = null;
    }
  }

  function resumeMicTranscription() {
    if (activeAudioSourceRef.current !== "mic" || !captureStream.current) return;
    connectDeepgramSocket(languageMode, sttVocabProfile);
  }

  function toggleMicTranscriptionPause() {
    if (activeAudioSourceRef.current !== "mic" || !captureStream.current) return;
    const next = !micTranscriptionPausedRef.current;
    micTranscriptionPausedRef.current = next;
    setMicTranscriptionPaused(next);
    if (next) {
      pauseMicTranscription();
      sync
        .sendSystem("麦克风转写已暂停（Ctrl+X 恢复，避免答题时误触发自动发送）")
        .catch(() => {});
      return;
    }
    resumeMicTranscription();
    sync.sendSystem("麦克风转写已恢复").catch(() => {});
  }

  async function startSession(options = {}) {
    const { audioSource = "none" } = options;
    if (
      ["system", "mic"].includes(audioSource) &&
      (!window.isSecureContext || !navigator.mediaDevices)
    ) {
      throw new Error(
        "浏览器阻止了音频权限。请在这台电脑上使用 http://localhost:3000 打开；局域网 IP 的 HTTP 页面只能使用文字模式。",
      );
    }
    activeAudioSourceRef.current = audioSource;
    setActiveAudioSource(audioSource);
    resetMicTranscriptionPause();
    const sessionId = await sync.clearSession();
    if (sessionId) {
      window.localStorage.setItem(SYNC_SESSION_KEY, sessionId);
    }

    if (audioSource === "none") {
      setIsSessionActive(true);
      return;
    }

    let stream;
    if (audioSource === "system") {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      stream.getVideoTracks().forEach((track) => {
        track.stop();
      });
      if (!stream.getAudioTracks().length) {
        throw new Error(
          window.desktopApp?.isDesktopApp
            ? "未捕获到系统音频，请确认 Windows 允许本应用录制系统声音。"
            : "未捕获到系统音频，请在浏览器共享弹窗中勾选「共享系统音频」。",
        );
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

    connectDeepgramSocket(languageMode, sttVocabProfile);

    const audioOnly = new MediaStream([stream.getAudioTracks()[0]]);
    const ac = new window.AudioContext();
    const src = ac.createMediaStreamSource(audioOnly);
    const proc = ac.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (event) => {
      if (micTranscriptionPausedRef.current) return;
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
    setActiveAudioSource("none");
    resetMicTranscriptionPause();
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

  async function sendMessageWithImages({ text = "", files = [], ocrTexts = null, silentUi = false } = {}) {
    const trimmed = text.trim();
    const imageFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    if (!trimmed && imageFiles.length === 0) return;

    setComposerBusy(true);
    try {
      if (!isSessionActive) {
        await startSession({ audioSource: "none" });
      }

      await ensureEnoughCredits(imageFiles.length);

      let resolvedOcrTexts = Array.isArray(ocrTexts) ? ocrTexts : null;
      if (imageFiles.length && !resolvedOcrTexts) {
        resolvedOcrTexts = await Promise.all(
          imageFiles.map((file) => recognizeImageFile(file, languageMode)),
        );
      }

      const llmText = buildLlmUserMessage(trimmed, resolvedOcrTexts || []);
      if (!llmText) return;

      await sendToLlm(llmText, { imageCount: imageFiles.length });
    } catch (error) {
      const message = error?.message || String(error);
      reportComposerError(message, silentUi);
      if (!silentUi) {
        sync.sendSystem(`图片识别失败：${message}`).catch(() => {});
      }
    } finally {
      setComposerBusy(false);
    }
  }
  async function sendScreenshotToVision({ imageBase64, silentUi = false } = {}) {
    if (!imageBase64) return;

    try {
      if (!isSessionActive) {
        await startSession({ audioSource: "none" });
      }

      await ensureEnoughCredits(1);
      const sessionId = await sync.ensureSession();
      const blob = await fetch(imageBase64).then((response) => response.blob());
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("text", "请解答图中内容，先给结论再给要点。");
      formData.append("source", "pc");
      formData.append("useResumeContext", String(useResumeContext));
      formData.append("resumeSummary", resumeSummary);
      formData.append("image", blob, `screenshot-${Date.now()}.jpg`);

      const response = await fetch("/api/vision-chat", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `截图发送失败（${response.status}）`);
      }
    } catch (error) {
      reportComposerError(error?.message || String(error), silentUi);
    }
  }
  sendScreenshotToVisionRef.current = sendScreenshotToVision;

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

  function updateChatAutoScrollState() {
    const container = chatScrollContainer.current;
    if (!container) return;
    const nearBottom = isNearScrollBottom(container);
    shouldAutoScrollChatRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  }

  function scrollChatToBottom({ behavior = "auto" } = {}) {
    const container = chatScrollContainer.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    shouldAutoScrollChatRef.current = true;
    setShowScrollToBottom(false);
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
    if (typeof window === "undefined") return undefined;
    function onMicPauseHotkey(event) {
      if (activeAudioSourceRef.current !== "mic" || !captureStream.current) return;
      if (isEditableTarget(event.target)) return;
      if (keyboardEventToAccelerator(event) !== MIC_PAUSE_ACCELERATOR) return;
      event.preventDefault();
      event.stopPropagation();
      toggleMicTranscriptionPause();
    }
    window.addEventListener("keydown", onMicPauseHotkey, true);
    return () => window.removeEventListener("keydown", onMicPauseHotkey, true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.desktopApp?.isDesktopApp) return undefined;
    function onScreenshotHotkeyDown(event) {
      const info = window.desktopApp.getScreenshotHotkey?.();
      if (!info?.accelerator) return;
      const pressed = keyboardEventToAccelerator(event);
      if (pressed && pressed === info.accelerator) {
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onScreenshotHotkeyDown, true);
    return () => window.removeEventListener("keydown", onScreenshotHotkeyDown, true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.desktopApp?.onScreenshot) return undefined;
    return window.desktopApp.onScreenshot(async ({ imageBase64 }) => {
      try {
        await sendScreenshotToVisionRef.current?.({
          imageBase64,
          silentUi: screenshotSilentSendRef.current,
        });
      } catch (error) {
        reportComposerError(error?.message || String(error), screenshotSilentSendRef.current);
      }
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.desktopApp?.getScreenshotSilentSend) return;
    const enabled = Boolean(window.desktopApp.getScreenshotSilentSend());
    setScreenshotSilentSend(enabled);
    screenshotSilentSendRef.current = enabled;
  }, []);

  useEffect(() => {
    screenshotSilentSendRef.current = screenshotSilentSend;
    if (typeof window === "undefined" || !window.desktopApp?.setScreenshotSilentSend) return;
    window.desktopApp.setScreenshotSilentSend(screenshotSilentSend).catch(() => {});
  }, [screenshotSilentSend]);

  useEffect(() => {
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
    saveSttVocabProfile(sttVocabProfile);
  }, [sttVocabProfile]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RESUME_CONTEXT_ENABLED_KEY, String(useResumeContext));
  }, [useResumeContext]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RESUME_SUMMARY_KEY, resumeSummary);
  }, [resumeSummary]);

  useEffect(() => {
    if (!isSessionActive) return;
    if (!["system", "mic"].includes(activeAudioSourceRef.current)) return;
    if (!captureStream.current) return;
    if (activeAudioSourceRef.current === "mic" && micTranscriptionPausedRef.current) return;
    if (dgSocketRef.current) {
      try { dgSocketRef.current.close(); } catch {}
    }
    connectDeepgramSocket(languageMode, sttVocabProfile);
  }, [languageMode, sttVocabProfile, isSessionActive]);

  useEffect(() => {
    const container = chatScrollContainer.current;
    if (!container) return undefined;
    const handleScroll = () => updateChatAutoScrollState();
    container.addEventListener("scroll", handleScroll, { passive: true });
    updateChatAutoScrollState();
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const container = chatScrollContainer.current;
    if (!container) return undefined;
    if (!shouldAutoScrollChatRef.current) {
      setShowScrollToBottom(true);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollChatToBottom();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sync.events]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <nav className="shrink-0 z-10 bg-[var(--color-base)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 w-full px-4 py-3 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} alt="" className="shrink-0" />
          <h1 className="shrink-0">realtime console</h1>
          <div className="flex flex-wrap items-center gap-2 ml-auto shrink-0">
            <button
              type="button"
              onClick={() => setSettingsPanelOpen(true)}
              className="text-sm px-3 py-1.5 rounded-full bg-gray-600 text-white hover:bg-gray-700 shrink-0"
            >
              设置
            </button>
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
      <SettingsPanel
        open={settingsPanelOpen}
        onClose={() => setSettingsPanelOpen(false)}
        llmModelChoice={llmModelChoice}
        setLlmModelChoice={setLlmModelChoice}
        minSendChars={minSendChars}
        setMinSendChars={setMinSendChars}
        languageMode={languageMode}
        setLanguageMode={setLanguageMode}
        sttVocabProfile={sttVocabProfile}
        setSttVocabProfile={setSttVocabProfile}
        autoSendEnabled={autoSendEnabled}
        setAutoSendEnabled={setAutoSendEnabled}
        screenshotSilentSend={screenshotSilentSend}
        setScreenshotSilentSend={setScreenshotSilentSend}
        useResumeContext={useResumeContext}
        setUseResumeContext={setUseResumeContext}
        resumeSummary={resumeSummary}
        setResumeSummary={setResumeSummary}
        uploadResumeMd={uploadResumeMd}
        usage={sync.usage}
        refreshUsage={sync.refreshUsage}
      />
      <MobileSyncPanel
        open={mobilePanelOpen}
        onClose={() => setMobilePanelOpen(false)}
        sessionId={sync.sessionId}
        connected={sync.connected}
        connectionError={sync.connectionError}
        onCreateOrOpen={createOrRefreshMobileSession}
      />
      <main className="relative flex-1 min-h-0 flex flex-col">
        <section ref={chatScrollContainer} className="flex-1 min-h-0 px-4 py-2 overflow-y-auto">
          <ChatWindow events={sync.events} />
        </section>
        {showScrollToBottom ? (
          <button
            type="button"
            onClick={() => scrollChatToBottom({ behavior: "smooth" })}
            className="absolute right-5 bottom-24 z-10 rounded-full bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg hover:bg-gray-700"
          >
            回到最新
          </button>
        ) : null}
        <section className="shrink-0 px-4 pb-4">
          <SessionControls
            startSession={startSession}
            stopSession={stopSession}
            sendMessageWithImages={sendMessageWithImages}
            submitTranscript={submitTranscript}
            isSessionActive={isSessionActive}
            composerBusy={composerBusy}
            liveTranscript={sync.liveTranscript}
            languageMode={languageMode}
            activeAudioSource={activeAudioSource}
            micTranscriptionPaused={micTranscriptionPaused}
          />
        </section>
      </main>
    </div>
  );
}
