import { useState } from "react";
import { CloudLightning, CloudOff, Monitor } from "react-feather";
import Button from "./Button";
import ChatComposer from "./ChatComposer";

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
    <div className="w-full flex flex-col items-center justify-center gap-4 px-4 py-3">
      <div className="flex w-full flex-wrap items-center justify-center gap-3">
        <Button
          onClick={() => handleStartSession({ audioSource: "screen" })}
          className={`${isActivating ? "bg-gray-600" : "bg-green-600"} whitespace-nowrap`}
          icon={<Monitor height={16} />}
        >
          {isActivating ? "starting..." : "共享桌面（系统音频）"}
        </Button>
        <Button
          onClick={() => handleStartSession({ audioSource: "mic" })}
          className={`${isActivating ? "bg-gray-600" : "bg-indigo-600"} whitespace-nowrap`}
        >
          {isActivating ? "starting..." : "麦克风输入"}
        </Button>
        <Button
          onClick={() => handleStartSession({ audioSource: "none" })}
          className={`${isActivating ? "bg-gray-600" : "bg-red-600"} whitespace-nowrap`}
          icon={<CloudLightning height={16} />}
        >
          {isActivating ? "starting..." : "开始（仅文本）"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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
            className="text-xs max-w-[170px]"
          />
        </label>
      </div>
    </div>
  );
}

function SessionActive({
  stopSession,
  sendMessageWithImages,
  submitTranscript,
  autoSendEnabled,
  setAutoSendEnabled,
  resumeSummary,
  setResumeSummary,
  composerBusy,
}) {
  return (
    <div className="w-full flex items-center gap-3 px-4 py-3 min-w-0 overflow-x-auto">
      <div className="flex-1 min-w-[280px]">
        <ChatComposer compact onSend={sendMessageWithImages} busy={composerBusy} />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <label className="text-xs whitespace-nowrap flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoSendEnabled}
            onChange={(e) => setAutoSendEnabled(e.target.checked)}
          />
          静音800ms自动发送
        </label>
        <Button onClick={submitTranscript} className="bg-purple-600 !p-2.5 text-xs whitespace-nowrap">
          发送当前转写
        </Button>
        <input
          type="text"
          value={resumeSummary}
          onChange={(e) => setResumeSummary(e.target.value)}
          placeholder="参考资料摘要（可编辑）"
          className="border border-gray-300 rounded-lg px-2.5 py-2 text-xs w-44"
        />
        <Button
          onClick={stopSession}
          icon={<CloudOff height={16} />}
          className="!p-2.5 text-xs whitespace-nowrap"
        >
          断开
        </Button>
      </div>
    </div>
  );
}

export default function SessionControls({
  startSession,
  stopSession,
  sendMessageWithImages,
  submitTranscript,
  isSessionActive,
  autoSendEnabled,
  setAutoSendEnabled,
  useResumeContext,
  setUseResumeContext,
  resumeSummary,
  setResumeSummary,
  uploadResumeMd,
  composerBusy,
}) {
  return (
    <div className="w-full h-full min-w-0 border-t-2 border-gray-200 rounded-md">
      {isSessionActive ? (
        <SessionActive
          stopSession={stopSession}
          sendMessageWithImages={sendMessageWithImages}
          submitTranscript={submitTranscript}
          autoSendEnabled={autoSendEnabled}
          setAutoSendEnabled={setAutoSendEnabled}
          resumeSummary={resumeSummary}
          setResumeSummary={setResumeSummary}
          composerBusy={composerBusy}
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
