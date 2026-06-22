export async function recognizeImageFile(file, languageMode = "zh-CN") {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("languageMode", languageMode);

  const resp = await fetch("/api/ocr", {
    method: "POST",
    body: formData,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `OCR 失败（${resp.status}）`);
  }
  return data.text || "";
}
