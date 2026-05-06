import { useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import ChatWindow from "./ChatWindow";
import SessionControls from "./SessionControls";

const TARGET_SR = 16000;

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
  const [events, setEvents] = useState([]);
  const [autoSendEnabled, setAutoSendEnabled] = useState(true);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [minSendChars, setMinSendChars] = useState(6);
  const [languageMode, setLanguageMode] = useState("zh-CN");
  const [useResumeContext, setUseResumeContext] = useState(false);
  const [resumeSummary, setResumeSummary] = useState("");

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

  function addUserEvent(text) {
    setEvents((prev) => [{
      type: "conversation.item.create",
      event_id: crypto.randomUUID(),
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    }, ...prev]);
  }

  function addAssistantEvent(text) {
    setEvents((prev) => [{
      type: "response.done",
      event_id: crypto.randomUUID(),
      response: {
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
      },
    }, ...prev]);
  }

  async function sendToCerebras(text) {
    const t = text.trim();
    if (!t) return;
    addUserEvent(t);
    const response = await fetch("/api/chat-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: t,
        useResumeContext,
        resumeSummary,
      }),
    });
    if (!response.ok) {
      addAssistantEvent(`请求失败（${response.status}）`);
      return;
    }
    const data = await response.json();
    addAssistantEvent(data.answer || "未生成回复。");
  }

  function getCurrentTranscript() {
    return `${finalTextRef.current} ${partialTextRef.current}`.trim();
  }

  function countEffectiveChars(text) {
    return text.replace(/\s+/g, "").length;
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
      setLiveTranscript("");
      await sendToCerebras(text);
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
          addAssistantEvent(`转写通道错误: ${msg.message || "unknown error"}`);
          return;
        }
        if (msg.type === "ready") {
          addAssistantEvent(`转写通道已连接（语言: ${lang}）。`);
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
        setLiveTranscript(getCurrentTranscript());
      } catch {
        // ignore parse errors
      }
    };

    return ws;
  }

  async function startSession(options = {}) {
    const { audioSource = "none" } = options;
    activeAudioSourceRef.current = audioSource;
    setEvents([]);

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
    setLiveTranscript("");
    setIsSessionActive(false);
  }

  async function sendTextMessage(message) {
    await sendToCerebras(message);
  }

  async function uploadResumeMd(file) {
    const text = await file.text();
    const response = await fetch("/api/resume-md", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!response.ok) {
      addAssistantEvent(`简历上传失败（${response.status}）`);
      return;
    }
    const data = await response.json();
    setResumeSummary(data.summary || "");
    setUseResumeContext(true);
    addAssistantEvent("简历已上传并生成摘要，已开启简历上下文。");
  }

  async function submitTranscript() {
    const text = getCurrentTranscript();
    if (!text) {
      addAssistantEvent("暂无可发送转写，请先播放系统音频。");
      return;
    }
    if (countEffectiveChars(text) < minSendChars) {
      addAssistantEvent(`转写字数不足 ${minSendChars}，已拦截发送。`);
      return;
    }
    finalTextRef.current = "";
    partialTextRef.current = "";
    setLiveTranscript("");
    await sendToCerebras(text);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("auto_send_enabled");
    if (saved !== null) {
      setAutoSendEnabled(saved === "true");
    }
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
    // Hot-switch language config during active screen-audio session.
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
  }, [events]);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} />
          <h1>realtime console</h1>
        </div>
      </nav>
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <section className="absolute top-0 left-0 right-0 bottom-0 flex">
          <section ref={chatScrollContainer} className="absolute top-0 left-0 right-0 bottom-32 px-4 overflow-y-auto">
            <ChatWindow events={events} />
          </section>
          <section className="absolute h-32 left-0 right-0 bottom-0 p-4">
            <SessionControls
              startSession={startSession}
              stopSession={stopSession}
              sendTextMessage={sendTextMessage}
              submitTranscript={submitTranscript}
              isSessionActive={isSessionActive}
              autoSendEnabled={autoSendEnabled}
              setAutoSendEnabled={setAutoSendEnabled}
              liveTranscript={liveTranscript}
              minSendChars={minSendChars}
              setMinSendChars={setMinSendChars}
              languageMode={languageMode}
              setLanguageMode={setLanguageMode}
              useResumeContext={useResumeContext}
              setUseResumeContext={setUseResumeContext}
              resumeSummary={resumeSummary}
              setResumeSummary={setResumeSummary}
              uploadResumeMd={uploadResumeMd}
            />
          </section>
        </section>
      </main>
    </>
  );
}
