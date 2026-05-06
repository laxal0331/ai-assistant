import { useState } from "react";
import { CloudLightning, CloudOff, MessageSquare, Monitor } from "react-feather";
import Button from "./Button";

function SessionStopped({ startSession, uploadResumeMd, useResumeContext, setUseResumeContext }) {
  const [isActivating, setIsActivating] = useState(false);

  async function handleStartSession(options) {
    if (isActivating) return;
    setIsActivating(true);
    try {
      await startSession(options);
    } catch (error) {
      const message = error?.message || String(error);
      console.error("Failed to start session:", error);
      window.alert(`启动失败：${message}`);
    } finally {
      setIsActivating(false);
    }
  }

  return (
    <div className="w-full h-full flex flex-col justify-center gap-3">
      <div className="w-full flex items-center justify-center gap-4">
        <Button
          onClick={() => handleStartSession({ audioSource: "none" })}
          className={isActivating ? "bg-gray-600" : "bg-red-600"}
          icon={<CloudLightning height={16} />}
        >
          {isActivating ? "starting..." : "开始（仅文本）"}
        </Button>
        <Button
          onClick={() => handleStartSession({ audioSource: "screen" })}
          className={isActivating ? "bg-gray-600" : "bg-green-600"}
          icon={<Monitor height={16} />}
        >
          {isActivating ? "starting..." : "共享桌面（系统音频）"}
        </Button>
        <Button
          onClick={() => handleStartSession({ audioSource: "mic" })}
          className={isActivating ? "bg-gray-600" : "bg-indigo-600"}
        >
          {isActivating ? "starting..." : "麦克风输入"}
        </Button>
      </div>
      <div className="w-full flex items-center justify-end gap-3 pr-2">
        <label className="text-xs whitespace-nowrap flex items-center gap-1">
          <input
            type="checkbox"
            checked={useResumeContext}
            onChange={(e) => setUseResumeContext(e.target.checked)}
          />
          启用参考资料上下文
        </label>
        <label className="text-xs whitespace-nowrap flex items-center gap-1">
          上传参考资料（.md/.txt）
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadResumeMd(file);
              e.target.value = "";
            }}
            className="text-xs w-[170px]"
          />
        </label>
      </div>
    </div>
  );
}

function SessionActive({
  stopSession,
  sendTextMessage,
  submitTranscript,
  autoSendEnabled,
  setAutoSendEnabled,
  liveTranscript,
  minSendChars,
  setMinSendChars,
  languageMode,
  setLanguageMode,
  useResumeContext,
  setUseResumeContext,
  resumeSummary,
  setResumeSummary,
  uploadResumeMd,
}) {
  const [message, setMessage] = useState("");
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const languageLabelMap = {
    "zh-CN": "中文",
    en: "英文",
    ja: "日语",
  };

  function handleSendText() {
    sendTextMessage(message);
    setMessage("");
  }

  return (
    <div className="flex items-center justify-center w-full h-full gap-3">
      <input
        onKeyDown={(e) => {
          if (e.key === "Enter" && message.trim()) handleSendText();
        }}
        type="text"
        placeholder="send a text message..."
        className="border border-gray-200 rounded-full p-3 flex-1"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <Button
        onClick={() => {
          if (message.trim()) handleSendText();
        }}
        icon={<MessageSquare height={16} />}
        className="bg-blue-500"
      >
        发送文本
      </Button>
      <Button onClick={submitTranscript} className="bg-purple-600">
        发送当前转写
      </Button>
      <Button onClick={stopSession} icon={<CloudOff height={16} />}>
        断开
      </Button>
      <label className="text-xs whitespace-nowrap flex items-center gap-1">
        <input
          type="checkbox"
          checked={autoSendEnabled}
          onChange={(e) => setAutoSendEnabled(e.target.checked)}
        />
        静音800ms自动发送
      </label>
      <label className="text-xs whitespace-nowrap flex items-center gap-1">
        最小字数
        <input
          type="number"
          min={1}
          max={100}
          value={minSendChars}
          onChange={(e) => setMinSendChars(Math.max(1, Number(e.target.value) || 1))}
          className="w-14 border border-gray-300 rounded px-1 py-0.5"
        />
      </label>
      <div className="text-xs whitespace-nowrap flex items-center gap-1 relative">
        <span>语言:</span>
        <button
          type="button"
          className="px-2 py-1 rounded bg-gray-200 min-w-[88px] text-left"
          onClick={() => setLangMenuOpen((v) => !v)}
        >
          {languageLabelMap[languageMode]} ▾
        </button>
        {langMenuOpen ? (
          <div className="absolute bottom-8 left-8 z-20 bg-white border border-gray-300 rounded shadow-md flex flex-col">
            <button
              type="button"
              className={`px-3 py-1 text-left ${languageMode === "zh-CN" ? "bg-blue-600 text-white" : "hover:bg-gray-100"}`}
              onClick={() => {
                setLanguageMode("zh-CN");
                setLangMenuOpen(false);
              }}
            >
              中文
            </button>
            <button
              type="button"
              className={`px-3 py-1 text-left ${languageMode === "en" ? "bg-blue-600 text-white" : "hover:bg-gray-100"}`}
              onClick={() => {
                setLanguageMode("en");
                setLangMenuOpen(false);
              }}
            >
              英文
            </button>
            <button
              type="button"
              className={`px-3 py-1 text-left ${languageMode === "ja" ? "bg-blue-600 text-white" : "hover:bg-gray-100"}`}
              onClick={() => {
                setLanguageMode("ja");
                setLangMenuOpen(false);
              }}
            >
              日语
            </button>
          </div>
        ) : null}
      </div>
      <div className="text-xs text-gray-600 max-w-[240px] truncate" title={liveTranscript}>
        转写: {liveTranscript || "(等待语音)"}
      </div>
      <input
        type="text"
        value={resumeSummary}
        onChange={(e) => setResumeSummary(e.target.value)}
        placeholder="参考资料摘要（可编辑）"
        className="border border-gray-300 rounded px-2 py-1 text-xs w-[220px]"
      />
    </div>
  );
}

export default function SessionControls({
  startSession,
  stopSession,
  sendTextMessage,
  submitTranscript,
  isSessionActive,
  autoSendEnabled,
  setAutoSendEnabled,
  liveTranscript,
  minSendChars,
  setMinSendChars,
  languageMode,
  setLanguageMode,
  useResumeContext,
  setUseResumeContext,
  resumeSummary,
  setResumeSummary,
  uploadResumeMd,
}) {
  return (
    <div className="flex gap-4 border-t-2 border-gray-200 h-full rounded-md">
      {isSessionActive ? (
        <SessionActive
          stopSession={stopSession}
          sendTextMessage={sendTextMessage}
          submitTranscript={submitTranscript}
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
      ) : (
        <SessionStopped
          startSession={startSession}
          uploadResumeMd={uploadResumeMd}
          useResumeContext={useResumeContext}
          setUseResumeContext={setUseResumeContext}
        />
      )}
    </div>
  );
}
