import { useState } from "react";
import { CloudLightning, CloudOff, Monitor } from "react-feather";
import Button from "./Button";
import ChatComposer from "./ChatComposer";

function SessionStopped({ startSession }) {
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
          onClick={() => handleStartSession({ audioSource: "system" })}
          className={`${isActivating ? "bg-gray-600" : "bg-green-600"} whitespace-nowrap`}
          icon={<Monitor height={16} />}
        >
          {isActivating ? "starting..." : "共享系统音频"}
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
    </div>
  );
}

function SessionActive({
  stopSession,
  sendMessageWithImages,
  submitTranscript,
  composerBusy,
  liveTranscript,
  languageMode,
}) {
  return (
    <div className="w-full flex flex-col gap-2 px-4 py-3 min-w-0">
      <div className="w-full min-w-0">
        <ChatComposer
          compact
          onSend={sendMessageWithImages}
          busy={composerBusy}
          liveTranscript={liveTranscript}
          languageMode={languageMode}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button onClick={submitTranscript} className="bg-purple-600 !p-2.5 text-xs whitespace-nowrap">
          发送当前转写
        </Button>
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
  composerBusy,
  liveTranscript,
  languageMode,
}) {
  return (
    <div className="w-full h-full min-w-0 border-t-2 border-gray-200 rounded-md">
      {isSessionActive ? (
        <SessionActive
          stopSession={stopSession}
          sendMessageWithImages={sendMessageWithImages}
          submitTranscript={submitTranscript}
          composerBusy={composerBusy}
          liveTranscript={liveTranscript}
          languageMode={languageMode}
        />
      ) : (
        <SessionStopped startSession={startSession} />
      )}
    </div>
  );
}
