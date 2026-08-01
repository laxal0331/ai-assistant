import { useEffect, useRef, useState } from "react";
import ChatWindow from "./ChatWindow";
import Button from "./Button";
import { useSessionSync } from "../hooks/useSessionSync";
import { loadLlmModelChoice } from "../lib/llmModels";

export default function MobilePage({ sessionId }) {
  const [message, setMessage] = useState("");
  const chatScrollRef = useRef(null);
  const sync = useSessionSync({ role: "mobile", sessionId });
  const statusText = sync.connectionError
    ? sync.connectionError
    : sync.connected
      ? "已连接"
      : "连接中";

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return undefined;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sync.events]);

  function handleSend() {
    const t = message.trim();
    if (!t) return;
    sync.sendChat(t, { source: "mobile", modelChoice: loadLlmModelChoice() }).catch((err) => {
      window.alert(err?.message || String(err));
    });
    setMessage("");
  }

  return (
    <div className="mobile-page fixed inset-0 flex flex-col overflow-hidden bg-white">
      <header className="mobile-page-header shrink-0 border-b border-gray-200 px-4 py-3">
        <h1 className="text-base font-semibold">手机同步</h1>
        <p className="mobile-page-status text-xs text-gray-500">
          {sync.connectionError
            ? sync.connectionError
            : sync.connected
              ? "已连接"
              : "连接中…"}
          {sync.liveTranscript ? ` · 转写: ${sync.liveTranscript}` : ""}
        </p>
      </header>

      <main
        ref={chatScrollRef}
        className="mobile-page-main flex-1 min-h-0 overflow-y-auto px-4 py-3 pb-24"
      >
        <div className="watch-readonly-status">
          <strong>手表只读同步</strong>
          <span>{statusText}</span>
        </div>
        <ChatWindow events={sync.events} />
      </main>

      <footer className="mobile-page-footer fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && message.trim()) handleSend();
          }}
          placeholder="输入问题发送给 AI…"
          className="mobile-page-input flex-1 min-w-0 border border-gray-200 rounded-full px-4 py-2.5 text-base"
        />
        <Button onClick={handleSend} className="mobile-page-send bg-blue-600 shrink-0">
          发送
        </Button>
      </footer>
    </div>
  );
}
