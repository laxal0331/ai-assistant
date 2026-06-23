const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

function normalizeKeyName(key) {
  if (!key) return null;
  if (key.length === 1) return key.toUpperCase();
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  const named = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Esc",
  };
  return named[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

export function keyboardEventToAccelerator(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const key = normalizeKeyName(event.key);
  if (!key || MODIFIER_KEYS.has(key)) return null;
  parts.push(key);
  return parts.join("+");
}

export function formatAcceleratorLabel(accelerator) {
  return String(accelerator || "")
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/Control/gi, "Ctrl")
    .replace(/Command/gi, "Cmd")
    .replace(/\+/g, "+");
}
