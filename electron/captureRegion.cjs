const { screen, desktopCapturer } = require("electron");

const OCR_SCREENSHOT_MAX_DIMENSION = 1440;
const OCR_SCREENSHOT_JPEG_QUALITY = 85;

function imageToJpegDataUrl(image) {
  return `data:image/jpeg;base64,${image.toJPEG(OCR_SCREENSHOT_JPEG_QUALITY).toString("base64")}`;
}

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
    const imageSize = primary.thumbnail.getSize();
    const maxDimension = Math.max(imageSize.width, imageSize.height);
    if (maxDimension > OCR_SCREENSHOT_MAX_DIMENSION) {
      const ratio = OCR_SCREENSHOT_MAX_DIMENSION / maxDimension;
      const resized = primary.thumbnail.resize({
          width: Math.round(imageSize.width * ratio),
          height: Math.round(imageSize.height * ratio),
          quality: "best",
        });
      return imageToJpegDataUrl(resized);
    }
    return imageToJpegDataUrl(primary.thumbnail);
  } catch (error) {
    console.error("captureFullScreenScreenshot failed:", error);
    return null;
  }
}

module.exports = { captureFullScreenScreenshot };
