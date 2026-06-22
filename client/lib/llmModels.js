export const LLM_MODEL_OPTIONS = [
  { value: "auto", label: "自动（Cerebras→DeepSeek）" },
  { value: "deepseek:deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "deepseek:deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];

export const LLM_MODEL_STORAGE_KEY = "llm_model_choice";

export function getLlmModelLabel(value) {
  return LLM_MODEL_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function loadLlmModelChoice() {
  if (typeof window === "undefined") return "auto";
  const saved = window.localStorage.getItem(LLM_MODEL_STORAGE_KEY) || "auto";
  return LLM_MODEL_OPTIONS.some((o) => o.value === saved) ? saved : "auto";
}

export function saveLlmModelChoice(value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LLM_MODEL_STORAGE_KEY, value);
}
