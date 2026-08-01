/**
 * Apply a session sync WebSocket message to React state (events newest-first).
 */
export function applySyncMessage(setEvents, setLiveTranscript, msg) {
  if (!msg || typeof msg !== "object") return;

  switch (msg.type) {
    case "snapshot":
      setEvents(Array.isArray(msg.events) ? msg.events : []);
      setLiveTranscript(msg.liveTranscript || "");
      break;
    case "session.clear":
      setEvents([]);
      setLiveTranscript("");
      break;
    case "event.append":
      if (msg.event) {
        setEvents((prev) => [msg.event, ...prev]);
      }
      break;
    case "response.delta":
      setEvents((prev) => {
        const responseId = msg.response_id || msg.event_id || "stream";
        const chunk = msg.delta?.text || "";
        if (!chunk) return prev;
        const streamType = "response.text.delta";
        const idx = prev.findIndex(
          (e) => e.type === streamType && e.response_id === responseId,
        );
        if (idx >= 0) {
          const next = [...prev];
          const existing = next[idx];
          next[idx] = {
            ...existing,
            delta: { text: `${existing.delta?.text || ""}${chunk}` },
          };
          return next;
        }
        return [
          {
            type: streamType,
            event_id: msg.event_id || crypto.randomUUID(),
            response_id: responseId,
            delta: { text: chunk },
          },
          ...prev,
        ];
      });
      break;
    case "response.done":
      if (msg.event) {
        setEvents((prev) => {
          const responseId = msg.response_id;
          const withoutStream = responseId
            ? prev.filter(
                (e) =>
                  !(
                    e.type === "response.text.delta" &&
                    e.response_id === responseId
                  ),
              )
            : prev;
          return [msg.event, ...withoutStream];
        });
      }
      break;
    case "transcript.live":
      setLiveTranscript(msg.text || "");
      break;
    case "system.error":
      if (msg.text) {
        setEvents((prev) => [
          {
            type: "response.done",
            event_id: crypto.randomUUID(),
            response: {
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: msg.text }],
                },
              ],
            },
          },
          ...prev,
        ]);
      }
      break;
    case "usage.update":
      break;
    default:
      break;
  }
}

export function getSessionWsUrl(sessionId, role = "pc") {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({ sessionId, role });
  return `${protocol}://${window.location.host}/ws/session?${params}`;
}

export function getMobilePageUrl(sessionId, mobileBaseUrl) {
  const base =
    mobileBaseUrl ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/m/${sessionId}`;
}

export function getWatchPageUrl(sessionId, mobileBaseUrl) {
  const base =
    mobileBaseUrl ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/w/${sessionId}`;
}
