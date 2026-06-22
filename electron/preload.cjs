const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  isDesktopApp: true,
  getHotkeyLabel() {
    return ipcRenderer.sendSync("desktop-get-hotkey-label");
  },
  onScreenshot(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop-screenshot", handler);
    return () => ipcRenderer.removeListener("desktop-screenshot", handler);
  },
});
