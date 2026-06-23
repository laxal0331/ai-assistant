const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/bmp"]);

export function isImageFile(file) {
  if (!file) return false;
  if (ACCEPTED_TYPES.has(file.type)) return true;
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || "");
}

export function readFileAsAttachment(file) {
  if (!isImageFile(file)) {
    throw new Error("仅支持 PNG、JPG、WEBP、GIF、BMP 图片");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("单张图片不能超过 10MB");
  }
  const previewUrl = URL.createObjectURL(file);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl,
    ocrStatus: "idle",
    ocrText: "",
    ocrError: "",
  };
}

export function collectImageFilesFromClipboard(clipboardData) {
  if (!clipboardData) return [];
  const files = [];
  if (clipboardData.files?.length) {
    for (const file of clipboardData.files) {
      if (isImageFile(file)) files.push(file);
    }
  }
  if (files.length) return files;
  for (const item of clipboardData.items || []) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (isImageFile(file)) files.push(file);
    }
  }
  return files;
}

export function revokeAttachmentPreview(attachment) {
  if (attachment?.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}
