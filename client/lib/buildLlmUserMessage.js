function normalizeForCompare(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the same user message for LLM whether sent via images or plain text. */
export function buildLlmUserMessage(trimmedText = "", ocrTexts = []) {
  const trimmed = String(trimmedText || "").trim();
  const cleanedOcr = (ocrTexts || []).map((text) => String(text || "").trim()).filter(Boolean);

  const ocrBody =
    cleanedOcr.length > 1
      ? cleanedOcr.map((text, index) => `图${index + 1}:\n${text}`).join("\n\n")
      : cleanedOcr[0] || "";

  if (!trimmed && ocrBody) return ocrBody;
  if (trimmed && !ocrBody) return trimmed;
  if (!trimmed && !ocrBody) return "";

  const normTrim = normalizeForCompare(trimmed);
  const normOcr = normalizeForCompare(ocrBody);
  if (!normTrim || normTrim === normOcr) return ocrBody;
  if (!normOcr || normOcr.includes(normTrim) || normTrim.includes(normOcr)) {
    return trimmed.length >= ocrBody.length ? trimmed : ocrBody;
  }

  return `${trimmed}\n\n${ocrBody}`;
}
