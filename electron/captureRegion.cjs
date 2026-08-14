const { app, screen, desktopCapturer } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const OCR_SCREENSHOT_MAX_DIMENSION = 1200;
const OCR_SCREENSHOT_JPEG_QUALITY = 75;

function logCaptureTiming(requestId, label, startedAt) {
  if (!requestId) return;
  const elapsed = startedAt ? ` elapsedMs=${Date.now() - startedAt}` : "";
  const line = `[${new Date().toISOString()}] [screenshot:${requestId}] capture ${label}${elapsed}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "screenshot-timing.log"), `${line}\n`);
  } catch (error) {
    console.error("failed to write screenshot timing log:", error);
  }
}

function imageToJpegDataUrl(image, requestId = "") {
  const jpegStartedAt = Date.now();
  const jpegBuffer = image.toJPEG(OCR_SCREENSHOT_JPEG_QUALITY);
  logCaptureTiming(requestId, `toJPEG bytes=${jpegBuffer.length}`, jpegStartedAt);

  const base64StartedAt = Date.now();
  const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
  logCaptureTiming(requestId, `base64 chars=${dataUrl.length}`, base64StartedAt);
  return dataUrl;
}

function getNativeCapturePath() {
  const candidates = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", "electron", "bin", "native-capture.exe"),
    path.join(process.resourcesPath || "", "app.asar", "electron", "bin", "native-capture.exe"),
    path.join(__dirname, "bin", "native-capture.exe"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function runNativeCaptureExe(exePath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(
      exePath,
      [outputPath, String(OCR_SCREENSHOT_MAX_DIMENSION), String(OCR_SCREENSHOT_JPEG_QUALITY)],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message || "").trim()));
          return;
        }
        resolve(String(stdout || "").trim());
      },
    );
  });
}

async function captureNativeExeScreenshot(requestId = "") {
  if (process.platform !== "win32") return null;
  const exePath = getNativeCapturePath();
  if (!exePath) {
    logCaptureTiming(requestId, "native-exe missing");
    return null;
  }

  const outputPath = path.join(
    app.getPath("temp"),
    `ai-assistant-screenshot-${process.pid}-${Date.now()}.jpg`,
  );

  try {
    const nativeStartedAt = Date.now();
    const summary = await runNativeCaptureExe(exePath, outputPath);
    logCaptureTiming(requestId, `native-exe ${summary}`, nativeStartedAt);

    const readStartedAt = Date.now();
    const jpegBuffer = fs.readFileSync(outputPath);
    logCaptureTiming(requestId, `native-exe read bytes=${jpegBuffer.length}`, readStartedAt);

    const base64StartedAt = Date.now();
    const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
    logCaptureTiming(requestId, `native-exe base64 chars=${dataUrl.length}`, base64StartedAt);
    return dataUrl;
  } finally {
    try {
      fs.unlinkSync(outputPath);
    } catch {}
  }
}

async function captureElectronScreenshot(requestId = "") {
  try {
    const displayStartedAt = Date.now();
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.size;
    const maxDisplayDimension = Math.max(width, height);
    const thumbnailRatio =
      maxDisplayDimension > OCR_SCREENSHOT_MAX_DIMENSION
        ? OCR_SCREENSHOT_MAX_DIMENSION / maxDisplayDimension
        : 1;
    const thumbnailSize = {
      width: Math.round(width * thumbnailRatio),
      height: Math.round(height * thumbnailRatio),
    };
    logCaptureTiming(
      requestId,
      `display size=${width}x${height} thumbnail=${thumbnailSize.width}x${thumbnailSize.height}`,
      displayStartedAt,
    );

    const sourcesStartedAt = Date.now();
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize,
    });
    logCaptureTiming(requestId, `getSources count=${sources.length}`, sourcesStartedAt);

    const selectStartedAt = Date.now();
    const primary =
      sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
    if (!primary?.thumbnail) {
      throw new Error("Unable to capture screen");
    }
    const imageSize = primary.thumbnail.getSize();
    logCaptureTiming(
      requestId,
      `select size=${imageSize.width}x${imageSize.height}`,
      selectStartedAt,
    );

    const maxDimension = Math.max(imageSize.width, imageSize.height);
    if (maxDimension > OCR_SCREENSHOT_MAX_DIMENSION) {
      const ratio = OCR_SCREENSHOT_MAX_DIMENSION / maxDimension;
      const resizeStartedAt = Date.now();
      const resized = primary.thumbnail.resize({
        width: Math.round(imageSize.width * ratio),
        height: Math.round(imageSize.height * ratio),
        quality: "best",
      });
      const resizedSize = resized.getSize();
      logCaptureTiming(
        requestId,
        `resize size=${resizedSize.width}x${resizedSize.height}`,
        resizeStartedAt,
      );
      return imageToJpegDataUrl(resized, requestId);
    }

    return imageToJpegDataUrl(primary.thumbnail, requestId);
  } catch (error) {
    console.error("captureElectronScreenshot failed:", error);
    return null;
  }
}

async function captureFullScreenScreenshot(requestId = "") {
  try {
    const nativeResult = await captureNativeExeScreenshot(requestId);
    if (nativeResult) return nativeResult;
  } catch (error) {
    logCaptureTiming(requestId, `native-exe failed error=${error?.message || String(error)}`);
    console.error("captureNativeExeScreenshot failed:", error);
  }
  return captureElectronScreenshot(requestId);
}

module.exports = { captureFullScreenScreenshot };
