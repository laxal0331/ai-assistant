import { WebSocket } from "ws";

/** @typedef {import("ws").WebSocket} WsSocket */

const sessions = new Map();

export function createSession() {
  const id = crypto.randomUUID();
  sessions.set(id, {
    id,
    events: [],
    liveTranscript: "",
    busy: false,
    /** @type {Set<WsSocket>} */
    clients: new Set(),
  });
  return id;
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

export function appendEvent(session, event) {
  session.events.unshift(event);
  return event;
}

export function setLiveTranscript(session, text) {
  session.liveTranscript = text || "";
}

export function addClient(session, ws) {
  session.clients.add(ws);
}

export function removeClient(session, ws) {
  session.clients.delete(ws);
}

export function broadcast(session, message, excludeWs = null) {
  const payload = JSON.stringify(message);
  for (const client of session.clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function sendSnapshot(ws, session) {
  ws.send(
    JSON.stringify({
      type: "snapshot",
      sessionId: session.id,
      events: session.events,
      liveTranscript: session.liveTranscript,
    }),
  );
}

export function clearSession(session) {
  session.events = [];
  session.liveTranscript = "";
}
