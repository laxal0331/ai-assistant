import { useCallback, useEffect, useRef, useState } from "react";
import { applySyncMessage, getSessionWsUrl } from "../lib/syncMessages";

function waitForWsOpen(ws, timeoutMs = 8000) {
  if (!ws) return Promise.reject(new Error("无法创建会话连接"));
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("会话连接超时，请刷新页面后重试"));
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timer);
      ws.removeEventListener("open", handleOpen);
      ws.removeEventListener("error", handleError);
      ws.removeEventListener("close", handleClose);
    }

    function handleOpen() {
      cleanup();
      resolve();
    }

    function handleError() {
      cleanup();
      reject(new Error("会话连接失败，请检查服务是否正常运行"));
    }

    function handleClose() {
      cleanup();
      reject(new Error("会话连接已断开，请刷新页面后重试"));
    }

    ws.addEventListener("open", handleOpen);
    ws.addEventListener("error", handleError);
    ws.addEventListener("close", handleClose);
  });
}

function isSessionNotFoundMessage(message) {
  return /session not found/i.test(message || "");
}

export function useSessionSync({
  role = "pc",
  sessionId: externalSessionId = null,
  onSessionInvalid = null,
} = {}) {
  const [sessionId, setSessionId] = useState(externalSessionId);
  const [events, setEvents] = useState([]);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const wsRef = useRef(null);
  const sessionIdRef = useRef(externalSessionId);
  const reconnectTimerRef = useRef(null);
  const sessionInvalidRef = useRef(false);
  const onSessionInvalidRef = useRef(onSessionInvalid);

  useEffect(() => {
    onSessionInvalidRef.current = onSessionInvalid;
  }, [onSessionInvalid]);

  const handleMessage = useCallback((msg) => {
    applySyncMessage(setEvents, setLiveTranscript, msg);
  }, []);

  const invalidateSession = useCallback((message = "") => {
    sessionInvalidRef.current = true;
    sessionIdRef.current = null;
    setSessionId(null);
    setConnected(false);
    setEvents([]);
    setLiveTranscript("");
    if (message) setConnectionError(message);
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    onSessionInvalidRef.current?.();
  }, []);

  const connectWs = useCallback(
    (id) => {
      if (!id || typeof window === "undefined") return null;
      sessionInvalidRef.current = false;
      setConnectionError("");
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      const ws = new WebSocket(getSessionWsUrl(id, role));
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setConnectionError("");
      };
      ws.onclose = () => {
        setConnected(false);
        if (sessionInvalidRef.current || !sessionIdRef.current) return;
        reconnectTimerRef.current = setTimeout(() => {
          connectWs(sessionIdRef.current);
        }, 1500);
      };
      ws.onerror = () => {
        setConnected(false);
        setConnectionError("连接失败，正在重试…");
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "error" && isSessionNotFoundMessage(msg.message)) {
            invalidateSession(
              role === "mobile"
                ? "会话已失效，请在电脑上点击「新建会话」后重新扫码"
                : "会话已失效，请重新生成同步链接",
            );
            return;
          }
          handleMessage(msg);
        } catch {
          // ignore
        }
      };
      return ws;
    },
    [role, handleMessage, invalidateSession],
  );

  const validateSession = useCallback(async (id) => {
    const resp = await fetch(`/api/session/${encodeURIComponent(id)}`);
    return resp.ok;
  }, []);

  const createSession = useCallback(async () => {
    const resp = await fetch("/api/session", { method: "POST" });
    if (!resp.ok) throw new Error(`创建会话失败（${resp.status}）`);
    const data = await resp.json();
    sessionInvalidRef.current = false;
    sessionIdRef.current = data.sessionId;
    setSessionId(data.sessionId);
    const ws = connectWs(data.sessionId);
    try {
      await waitForWsOpen(ws);
      return data.sessionId;
    } catch (error) {
      invalidateSession("无法连接服务器，请确认服务已启动");
      throw error;
    }
  }, [connectWs, invalidateSession]);

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) {
      try {
        let ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
          ws = connectWs(sessionIdRef.current);
        }
        await waitForWsOpen(ws);
        return sessionIdRef.current;
      } catch {
        invalidateSession();
      }
    }
    return createSession();
  }, [connectWs, createSession, invalidateSession]);

  const restoreSession = useCallback(
    async (id) => {
      const trimmed = (id || "").trim();
      if (!trimmed) return false;
      const valid = await validateSession(trimmed);
      if (!valid) {
        invalidateSession("会话已失效，请重新生成同步链接");
        return false;
      }
      sessionInvalidRef.current = false;
      sessionIdRef.current = trimmed;
      setSessionId(trimmed);
      const ws = connectWs(trimmed);
      try {
        await waitForWsOpen(ws);
        return true;
      } catch {
        invalidateSession("无法连接服务器，请确认服务已启动");
        return false;
      }
    },
    [validateSession, connectWs, invalidateSession],
  );

  const sendWs = useCallback((payload) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("会话未连接");
    }
    ws.send(JSON.stringify(payload));
  }, []);

  const sendChat = useCallback(
    async (text, options = {}) => {
      const t = (text || "").trim();
      if (!t) return;
      await ensureSession();
      sendWs({
        type: "chat.send",
        text: t,
        useResumeContext: Boolean(options.useResumeContext),
        resumeSummary: options.resumeSummary || "",
        source: options.source || role,
        modelChoice: options.modelChoice || "auto",
      });
    },
    [ensureSession, sendWs, role],
  );

  const sendSystem = useCallback(
    async (text) => {
      const t = (text || "").trim();
      if (!t) return;
      await ensureSession();
      sendWs({ type: "system.notify", text: t });
    },
    [ensureSession, sendWs],
  );

  const sendTranscript = useCallback(
    async (text) => {
      await ensureSession();
      sendWs({ type: "transcript.update", text: text || "" });
    },
    [ensureSession, sendWs],
  );

  const clearSession = useCallback(async () => {
    const id = await ensureSession();
    sendWs({ type: "session.clear" });
    return id;
  }, [ensureSession, sendWs]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!externalSessionId) return undefined;
    let cancelled = false;

    async function initMobileSession() {
      setConnectionError("");
      const valid = await validateSession(externalSessionId);
      if (cancelled) return;
      if (!valid) {
        setConnectionError("会话已失效，请在电脑上点击「新建会话」后重新扫码");
        return;
      }
      sessionInvalidRef.current = false;
      sessionIdRef.current = externalSessionId;
      setSessionId(externalSessionId);
      const ws = connectWs(externalSessionId);
      try {
        await waitForWsOpen(ws);
      } catch {
        if (!cancelled) {
          setConnectionError("无法连接服务器，请确认手机和电脑在同一 WiFi");
        }
      }
    }

    initMobileSession();
    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, [externalSessionId, connectWs, validateSession]);

  return {
    sessionId,
    setSessionId,
    events,
    liveTranscript,
    connected,
    connectionError,
    createSession,
    ensureSession,
    restoreSession,
    connectWs,
    invalidateSession,
    sendChat,
    sendSystem,
    sendTranscript,
    clearSession,
  };
}
