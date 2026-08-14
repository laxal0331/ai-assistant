const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  isDesktopApp: true,
  getHotkeyLabel() {
    return ipcRenderer.sendSync("desktop-get-hotkey-label");
  },
  getScreenshotHotkey() {
    return ipcRenderer.sendSync("desktop-get-screenshot-hotkey");
  },
  setScreenshotHotkey(accelerator) {
    return ipcRenderer.invoke("desktop-set-screenshot-hotkey", accelerator);
  },
  getScreenshotSilentSend() {
    return ipcRenderer.sendSync("desktop-get-screenshot-silent-send");
  },
  setScreenshotSilentSend(enabled) {
    return ipcRenderer.invoke("desktop-set-screenshot-silent-send", enabled);
  },
  showNotification(payload) {
    return ipcRenderer.invoke("desktop-show-notification", payload);
  },
  onScreenshot(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop-screenshot", handler);
    return () => ipcRenderer.removeListener("desktop-screenshot", handler);
  },
  onScreenshotContextRequest(callback) {
    const handler = async (_event, payload) => {
      try {
        const result = await callback(payload);
        ipcRenderer.send("desktop-screenshot-context-response", {
          requestId: payload?.requestId,
          ok: true,
          context: result || {},
        });
      } catch (error) {
        ipcRenderer.send("desktop-screenshot-context-response", {
          requestId: payload?.requestId,
          ok: false,
          error: error?.message || String(error),
        });
      }
    };
    ipcRenderer.on("desktop-screenshot-context-request", handler);
    return () => ipcRenderer.removeListener("desktop-screenshot-context-request", handler);
  },
});
