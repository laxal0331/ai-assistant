import { Readable } from "node:stream";
import OcrApi20210707 from "@alicloud/ocr-api20210707";
import * as $OpenApi from "@alicloud/openapi-client";
import * as $Util from "@alicloud/tea-util";

const OCR_ENDPOINT = process.env.ALIYUN_OCR_ENDPOINT || "ocr-api.cn-hangzhou.aliyuncs.com";

const LANGUAGE_MAP = {
  "zh-CN": ["chn", "eng"],
  en: ["eng", "chn"],
  ja: ["ja", "eng", "chn"],
};

function getCredentials() {
  const accessKeyId =
    process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID || "";
  const accessKeySecret =
    process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET || "";
  return { accessKeyId, accessKeySecret };
}

function createClient() {
  const { accessKeyId, accessKeySecret } = getCredentials();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error("未配置 ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET");
  }
  const config = new $OpenApi.Config({
    accessKeyId,
    accessKeySecret,
  });
  config.endpoint = OCR_ENDPOINT;
  return new OcrApi20210707.default(config);
}

function extractTextFromPayload(payload) {
  if (!payload) return "";
  if (typeof payload === "string") {
    try {
      return extractTextFromPayload(JSON.parse(payload));
    } catch {
      return payload.trim();
    }
  }
  if (typeof payload.content === "string" && payload.content.trim()) {
    return payload.content.trim();
  }
  if (Array.isArray(payload.subImages)) {
    const fromSubImages = payload.subImages
      .map((item) => item?.blockInfo?.blockDetails?.map((b) => b?.text).filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (fromSubImages) return fromSubImages;
  }
  if (Array.isArray(payload.prism_wordsInfo)) {
    return payload.prism_wordsInfo
      .map((item) => item?.word || item?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (Array.isArray(payload.lines)) {
    return payload.lines
      .map((line) => line?.text || line?.content || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function mapLanguageModeToOcrLanguages(languageMode) {
  return (LANGUAGE_MAP[languageMode] || LANGUAGE_MAP["zh-CN"]).join(",");
}

function formatOcrError(error) {
  const message = error?.message || String(error);
  const code = error?.code || "";
  if (message.includes("ocrServiceNotOpen") || code === "ocrServiceNotOpen") {
    return new Error("阿里云 OCR 服务未开通，请在控制台开通「OCR 统一识别」");
  }
  if (message.includes("InvalidAccessKeyId") || message.includes("SignatureDoesNotMatch")) {
    return new Error("阿里云 AccessKey 无效，请检查 .env 中的密钥配置");
  }
  if (code === "illegalImageSize") {
    return new Error("图片尺寸不符合要求（需大于 5px 且不超过 8192px）");
  }
  if (code === "unsupportedImageFormat") {
    return new Error("图片格式不支持，请使用 PNG、JPG、WEBP 等常见格式");
  }
  return error;
}

export async function recognizeImageBuffer(imageBuffer, languageMode = "zh-CN") {
  if (!imageBuffer?.length) {
    throw new Error("图片为空");
  }
  if (imageBuffer.length > 10 * 1024 * 1024) {
    throw new Error("图片不能超过 10MB");
  }

  const client = createClient();
  const bodyStream = Buffer.isBuffer(imageBuffer) ? Readable.from(imageBuffer) : imageBuffer;
  const request = new OcrApi20210707.RecognizeAllTextRequest({
    body: bodyStream,
    type: "MultiLang",
    multiLanConfig: new OcrApi20210707.RecognizeAllTextRequestMultiLanConfig({
      languages: mapLanguageModeToOcrLanguages(languageMode),
    }),
  });
  const runtime = new $Util.RuntimeOptions({});
  let response;
  try {
    response = await client.recognizeAllTextWithOptions(request, runtime);
  } catch (error) {
    throw formatOcrError(error);
  }
  const data = response?.body?.data;
  const text = extractTextFromPayload(data);
  if (!text) {
    throw new Error("未识别到文字，请换一张更清晰的图片");
  }
  return text;
}
