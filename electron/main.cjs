const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { captureFullScreenScreenshot } = require("./captureRegion.cjs");

const HOTKEY = "Control+Alt+S";
const HOTKEY_LABEL = "Ctrl+Alt+S";

let mainWindow = null;
let tray = null;
let serverHandle = null;
let isQuitting = false;

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
  });
  return serverHandle.port;
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
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

function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAFklEQVR42mNkYGD4z8DAwMgABXAGjKlJAwB2AAG3A8v9AAAAAElFTkSuQmCC",
  );
  tray = new Tray(icon);
  tray.setToolTip("AI Assistant");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示主窗口",
        click: () => {
          if (!mainWindow) return;
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: `全屏截图问 AI (${HOTKEY_LABEL})`,
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
    ]),
  );
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
  const ok = globalShortcut.register(HOTKEY, () => {
    triggerScreenshotToAi().catch((error) => {
      console.error("global shortcut failed:", error);
    });
  });
  if (!ok) {
    console.warn(`Failed to register global shortcut: ${HOTKEY}`);
  }
}

async function bootstrap() {
  const port = await startBackend();
  createMainWindow(port);
  createTray();
  registerShortcuts();
}

ipcMain.on("desktop-get-hotkey-label", (event) => {
  event.returnValue = HOTKEY_LABEL;
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
