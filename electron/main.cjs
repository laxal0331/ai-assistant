const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  Notification,
  screen,
  session,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { Blob } = require("buffer");
const { pathToFileURL } = require("url");
const { captureFullScreenScreenshot } = require("./captureRegion.cjs");
const { getTrayIcon } = require("./trayIcon.cjs");
const {
  DEFAULT_ACCELERATOR,
  loadScreenshotHotkey,
  loadScreenshotSilentSend,
  saveScreenshotHotkey,
  saveScreenshotSilentSend,
} = require("./screenshotHotkey.cjs");

let mainWindow = null;
let tray = null;
let serverHandle = null;
let isQuitting = false;
let screenshotHotkey = DEFAULT_ACCELERATOR;
let screenshotHotkeyLabel = "Ctrl+S";
let screenshotSilentSend = false;
const SCREENSHOT_CONTEXT_TIMEOUT_MS = 5000;

function logScreenshotTiming(requestId, label, startedAt) {
  const elapsed = startedAt ? ` elapsedMs=${Date.now() - startedAt}` : "";
  const line = `[${new Date().toISOString()}] [screenshot:${requestId}] ${label}${elapsed}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "screenshot-timing.log"), `${line}\n`);
  } catch (error) {
    console.error("failed to write screenshot timing log:", error);
  }
}

function getAppRoot() {
  return app.getAppPath();
}

function ensureUserEnvFile() {
  const userEnvPath = path.join(app.getPath("userData"), ".env");
  if (fs.existsSync(userEnvPath)) return userEnvPath;

  const candidates = [
    path.join(getAppRoot(), ".env"),
    path.join(getAppRoot(), ".env.example"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      fs.copyFileSync(candidate, userEnvPath);
      return userEnvPath;
    }
  }
  return userEnvPath;
}

function enableWindowCaptureProtection(window) {
  if (process.platform !== "win32" || !window || window.isDestroyed()) return;
  try {
    window.setContentProtection(true);
  } catch (error) {
    console.error("failed to enable window capture protection:", error);
  }
}

function setupSystemAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      const primaryDisplay = screen.getPrimaryDisplay();
      const source =
        sources.find((item) => item.display_id === String(primaryDisplay.id)) ||
        sources[0];

      if (!source) {
        callback({});
        return;
      }

      const result = { video: source };
      if (request.audioRequested) {
        result.audio = "loopback";
      }
      callback(result);
    } catch (error) {
      console.error("system audio capture handler failed:", error);
      callback({});
    }
  }, { useSystemPicker: false });
}

async function startBackend() {
  const appRoot = getAppRoot();
  const envPath = ensureUserEnvFile();
  process.env.DOTENV_CONFIG_PATH = envPath;
  process.env.NODE_ENV = app.isPackaged || process.env.ELECTRON_FORCE_PRODUCTION === "1"
    ? "production"
    : "development";

  const serverUrl = pathToFileURL(path.join(appRoot, "server.js")).href;
  const { startServer } = await import(serverUrl);
  serverHandle = await startServer({
    rootDir: appRoot,
    production: process.env.NODE_ENV === "production",
    envPath,
    userDataDir: app.getPath("userData"),
  });
  return serverHandle.port;
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 400,
    minHeight: 320,
    center: true,
    title: "AI Assistant",
    icon: path.join(__dirname, "assets", "app-icon.png"),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  enableWindowCaptureProtection(mainWindow);
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.once("ready-to-show", () => {
    enableWindowCaptureProtection(mainWindow);
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => {
        if (!mainWindow) return;
        enableWindowCaptureProtection(mainWindow);
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: `全屏截图问 AI (${screenshotHotkeyLabel})`,
      click: () => {
        triggerScreenshotToAi().catch((error) => {
          console.error("screenshot hotkey failed:", error);
        });
      },
    },
    { type: "separator" },
    {
      label: "打开配置目录",
      click: () => {
        shell.openPath(app.getPath("userData"));
      },
    },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const icon = getTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip("AI Assistant");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", () => {
    if (!mainWindow) return;
    enableWindowCaptureProtection(mainWindow);
    mainWindow.show();
    mainWindow.focus();
  });
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  return new Blob([buffer], { type: match[1] || "image/jpeg" });
}

function requestScreenshotContext() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.reject(new Error("主窗口未就绪"));
  }
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("获取截图会话超时"));
    }, SCREENSHOT_CONTEXT_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      ipcMain.removeListener("desktop-screenshot-context-response", handleResponse);
    }

    function handleResponse(_event, payload) {
      if (payload?.requestId !== requestId) return;
      cleanup();
      if (!payload.ok) {
        reject(new Error(payload.error || "获取截图会话失败"));
        return;
      }
      resolve(payload.context || {});
    }

    ipcMain.on("desktop-screenshot-context-response", handleResponse);
    mainWindow.webContents.send("desktop-screenshot-context-request", { requestId });
  });
}

async function uploadScreenshotToAi(imageBase64, context = {}) {
  const sessionId = String(context.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("截图会话未连接");
  }
  const blob = dataUrlToBlob(imageBase64);
  if (!blob) {
    throw new Error("截图图片无效");
  }

  const formData = new FormData();
  formData.append("sessionId", sessionId);
  formData.append("requestId", String(context.requestId || ""));
  formData.append("text", "请解答图中内容，先给结论再给要点。");
  formData.append("source", "pc");
  formData.append("languageMode", String(context.languageMode || "zh-CN"));
  formData.append("modelChoice", String(context.modelChoice || "auto"));
  formData.append("useResumeContext", String(Boolean(context.useResumeContext)));
  formData.append("resumeSummary", String(context.resumeSummary || ""));
  formData.append("image", blob, `screenshot-${Date.now()}.jpg`);

  const resp = await fetch(`http://127.0.0.1:${serverHandle.port}/api/vision-chat`, {
    method: "POST",
    body: formData,
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || `截图发送失败（${resp.status}）`);
  }
  return "vision";
}

async function triggerScreenshotToAi() {
  if (!mainWindow) return;
  const requestId = randomUUID();
  const startedAt = Date.now();
  logScreenshotTiming(requestId, "hotkey received");
  const captureStartedAt = Date.now();
  const imageBase64 = await captureFullScreenScreenshot(requestId);
  logScreenshotTiming(requestId, "capture complete", captureStartedAt);
  if (!imageBase64) return;
  if (!screenshotSilentSend) {
    mainWindow.show();
    mainWindow.focus();
  }
  try {
    const contextStartedAt = Date.now();
    const context = await requestScreenshotContext();
    context.requestId = requestId;
    logScreenshotTiming(requestId, "context ready", contextStartedAt);
    const uploadStartedAt = Date.now();
    const mode = await uploadScreenshotToAi(imageBase64, context);
    logScreenshotTiming(requestId, `upload accepted mode=${mode}`, uploadStartedAt);
    logScreenshotTiming(requestId, "main flow complete", startedAt);
  } catch (error) {
    showDesktopNotification("截图问 AI", error?.message || String(error));
    throw error;
  }
}

function showDesktopNotification(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title: title || "AI Assistant", body: body || "" }).show();
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(screenshotHotkey, () => {
    triggerScreenshotToAi().catch((error) => {
      console.error("global shortcut failed:", error);
    });
  });
  if (!ok) {
    console.warn(`Failed to register global shortcut: ${screenshotHotkey}`);
  }
  return ok;
}

function refreshScreenshotHotkey() {
  const loaded = loadScreenshotHotkey();
  screenshotHotkey = loaded.accelerator;
  screenshotHotkeyLabel = loaded.label;
  screenshotSilentSend = loadScreenshotSilentSend();
}

function updateTrayHotkeyLabel() {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
}

async function bootstrap() {
  refreshScreenshotHotkey();
  setupSystemAudioCapture();
  const port = await startBackend();
  createMainWindow(port);
  createTray();
  registerShortcuts();
}

ipcMain.on("desktop-get-hotkey-label", (event) => {
  event.returnValue = screenshotHotkeyLabel;
});

ipcMain.on("desktop-get-screenshot-hotkey", (event) => {
  event.returnValue = {
    accelerator: screenshotHotkey,
    label: screenshotHotkeyLabel,
  };
});

ipcMain.on("desktop-get-screenshot-silent-send", (event) => {
  event.returnValue = screenshotSilentSend;
});

ipcMain.handle("desktop-set-screenshot-silent-send", (_event, enabled) => {
  screenshotSilentSend = saveScreenshotSilentSend(enabled);
  return { ok: true, enabled: screenshotSilentSend };
});

ipcMain.handle("desktop-show-notification", (_event, payload) => {
  showDesktopNotification(payload?.title, payload?.body);
  return { ok: true };
});

ipcMain.handle("desktop-set-screenshot-hotkey", (_event, accelerator) => {
  try {
    const parsed = saveScreenshotHotkey(accelerator);
    const previousAccelerator = screenshotHotkey;
    globalShortcut.unregisterAll();
    const ok = globalShortcut.register(parsed.accelerator, () => {
      triggerScreenshotToAi().catch((error) => {
        console.error("global shortcut failed:", error);
      });
    });
    if (!ok) {
      saveScreenshotHotkey(previousAccelerator);
      refreshScreenshotHotkey();
      registerShortcuts();
      updateTrayHotkeyLabel();
      return {
        ok: false,
        error: `快捷键 ${parsed.label} 注册失败，可能被系统或其他程序占用。`,
      };
    }
    screenshotHotkey = parsed.accelerator;
    screenshotHotkeyLabel = parsed.label;
    updateTrayHotkeyLabel();
    return { ok: true, accelerator: parsed.accelerator, label: parsed.label };
  } catch (error) {
    refreshScreenshotHotkey();
    registerShortcuts();
    updateTrayHotkeyLabel();
    return { ok: false, error: error?.message || String(error) };
  }
});

app.whenReady().then(bootstrap);

app.on("activate", () => {
  if (mainWindow) {
    enableWindowCaptureProtection(mainWindow);
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("before-quit", async () => {
  isQuitting = true;
  if (serverHandle?.close) {
    try {
      await serverHandle.close();
    } catch (error) {
      console.error("failed to close server:", error);
    }
  }
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
