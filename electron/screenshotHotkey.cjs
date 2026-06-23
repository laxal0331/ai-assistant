const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULT_ACCELERATOR = "Control+S";

function getConfigPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function acceleratorToLabel(accelerator) {
  return String(accelerator || DEFAULT_ACCELERATOR)
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/Control/gi, "Ctrl")
    .replace(/Command/gi, "Cmd")
    .replace(/\+/g, "+");
}

function normalizeAccelerator(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const parts = text.split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;

  const normalized = parts.map((part) => {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "commandorcontrol") return "Control";
    if (lower === "cmd" || lower === "command") return "Command";
    if (lower === "alt" || lower === "option") return "Alt";
    if (lower === "shift") return "Shift";
    if (part.length === 1) return part.toUpperCase();
    if (/^f\d{1,2}$/i.test(part)) return part.toUpperCase();
    if (/^(plus|space|tab|backspace|delete|insert|home|end|pageup|pagedown|up|down|left|right)$/i.test(part)) {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }
    return part;
  });

  const keyPart = normalized[normalized.length - 1];
  if (["Control", "Command", "Alt", "Shift"].includes(keyPart)) {
    return null;
  }

  return normalized.join("+");
}

function loadScreenshotHotkey() {
  try {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      return { accelerator: DEFAULT_ACCELERATOR, label: acceleratorToLabel(DEFAULT_ACCELERATOR) };
    }
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const accelerator = normalizeAccelerator(parsed?.screenshotHotkey) || DEFAULT_ACCELERATOR;
    return { accelerator, label: acceleratorToLabel(accelerator) };
  } catch {
    return { accelerator: DEFAULT_ACCELERATOR, label: acceleratorToLabel(DEFAULT_ACCELERATOR) };
  }
}

function saveScreenshotHotkey(accelerator) {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) {
    throw new Error("无效的快捷键格式");
  }

  const configPath = getConfigPath();
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {
      config = {};
    }
  }
  config.screenshotHotkey = normalized;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return { accelerator: normalized, label: acceleratorToLabel(normalized) };
}

module.exports = {
  DEFAULT_ACCELERATOR,
  acceleratorToLabel,
  normalizeAccelerator,
  loadScreenshotHotkey,
  saveScreenshotHotkey,
};
