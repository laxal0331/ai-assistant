const { screen, desktopCapturer } = require("electron");

async function captureFullScreenScreenshot() {
  try {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.size;
    const scale = display.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    });
    const primary =
      sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
    if (!primary?.thumbnail) {
      throw new Error("无法获取屏幕截图");
    }
    return primary.thumbnail.toDataURL();
  } catch (error) {
    console.error("captureFullScreenScreenshot failed:", error);
    return null;
  }
}

module.exports = { captureFullScreenScreenshot };
