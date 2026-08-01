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
});
