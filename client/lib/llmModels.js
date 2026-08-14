export const LLM_MODEL_OPTIONS = [
  { value: "deepseek:deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "deepseek:deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];

const LLM_MODEL_STORAGE_KEY = "llm_model_choice";
const DEFAULT_LLM_MODEL_CHOICE = "deepseek:deepseek-v4-flash";

export function getLlmModelLabel(value) {
  return LLM_MODEL_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function loadLlmModelChoice() {
  if (typeof window === "undefined") return DEFAULT_LLM_MODEL_CHOICE;
  const saved = window.localStorage.getItem(LLM_MODEL_STORAGE_KEY) || DEFAULT_LLM_MODEL_CHOICE;
  return LLM_MODEL_OPTIONS.some((o) => o.value === saved) ? saved : DEFAULT_LLM_MODEL_CHOICE;
}

export function saveLlmModelChoice(value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LLM_MODEL_STORAGE_KEY, value);
}
