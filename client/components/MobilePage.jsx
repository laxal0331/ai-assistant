import { useEffect, useRef, useState } from "react";
import ChatWindow from "./ChatWindow";
import Button from "./Button";
import { useSessionSync } from "../hooks/useSessionSync";
import { loadLlmModelChoice } from "../lib/llmModels";

const AUTO_SCROLL_THRESHOLD_PX = 80;
const RESUME_CONTEXT_ENABLED_KEY = "resume_context_enabled";
const RESUME_SUMMARY_KEY = "resume_summary";

function isNearScrollBottom(container) {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    AUTO_SCROLL_THRESHOLD_PX
  );
}

export default function MobilePage({ sessionId }) {
  const [message, setMessage] = useState("");
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const chatScrollRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const sync = useSessionSync({ role: "mobile", sessionId });
  const statusText = sync.connectionError
    ? sync.connectionError
    : sync.connected
      ? "已连接"
      : "连接中";

  function updateAutoScrollState() {
    const container = chatScrollRef.current;
    if (!container) return;
    const nearBottom = isNearScrollBottom(container);
    shouldAutoScrollRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  }

  function scrollToBottom({ behavior = "auto" } = {}) {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    shouldAutoScrollRef.current = true;
    setShowScrollToBottom(false);
  }

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return undefined;
    const handleScroll = () => updateAutoScrollState();
    container.addEventListener("scroll", handleScroll, { passive: true });
    updateAutoScrollState();
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return undefined;
    if (!shouldAutoScrollRef.current) {
      setShowScrollToBottom(true);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sync.events]);

  function handleSend() {
    const t = message.trim();
    if (!t) return;
    sync
      .sendChat(t, {
        source: "mobile",
        modelChoice: loadLlmModelChoice(),
        useResumeContext: window.localStorage.getItem(RESUME_CONTEXT_ENABLED_KEY) === "true",
        resumeSummary: window.localStorage.getItem(RESUME_SUMMARY_KEY) || "",
      })
      .catch((err) => {
        window.alert(err?.message || String(err));
      });
    setMessage("");
  }

  return (
    <div className="mobile-page fixed inset-0 flex flex-col overflow-hidden">
      <header className="mobile-page-header shrink-0 border-b px-4 py-3">
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
      {showScrollToBottom ? (
        <button
          type="button"
          onClick={() => scrollToBottom({ behavior: "smooth" })}
          className="mobile-scroll-bottom fixed right-4 bottom-20 z-30 rounded-full px-3 py-1.5 text-xs shadow-lg"
        >
          回到最新
        </button>
      ) : null}

      <footer className="mobile-page-footer fixed bottom-0 left-0 right-0 z-20 border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && message.trim()) handleSend();
          }}
          placeholder="输入问题发送给 AI…"
          className="mobile-page-input flex-1 min-w-0 border rounded-full px-4 py-2.5 text-base"
        />
        <Button onClick={handleSend} className="mobile-page-send shrink-0">
          发送
        </Button>
      </footer>
    </div>
  );
}
