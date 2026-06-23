const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { captureFullScreenScreenshot } = require("./captureRegion.cjs");
const { getTrayIcon } = require("./trayIcon.cjs");
const {
  DEFAULT_ACCELERATOR,
  loadScreenshotHotkey,
  saveScreenshotHotkey,
} = require("./screenshotHotkey.cjs");

let mainWindow = null;
let tray = null;
let serverHandle = null;
let isQuitting = false;
let screenshotHotkey = DEFAULT_ACCELERATOR;
let screenshotHotkeyLabel = "Ctrl+S";

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
    width: 1280,
    height: 860,
    minWidth: 400,
    minHeight: 320,
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

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.once("ready-to-show", () => {
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
    mainWindow.show();
    mainWindow.focus();
  });
}

async function triggerScreenshotToAi() {
  if (!mainWindow) return;
  const imageBase64 = await captureFullScreenScreenshot();
  if (!imageBase64) return;
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("desktop-screenshot", { imageBase64 });
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
