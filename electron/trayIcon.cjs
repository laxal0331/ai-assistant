const path = require("path");
const fs = require("fs");
const { nativeImage } = require("electron");

function getTrayIcon() {
  const iconPath = path.join(__dirname, "assets", "app-icon.png");
  if (!fs.existsSync(iconPath)) {
    throw new Error(`Tray icon not found: ${iconPath}`);
  }
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    throw new Error(`Tray icon failed to load: ${iconPath}`);
  }
  return image;
}

module.exports = { getTrayIcon };
