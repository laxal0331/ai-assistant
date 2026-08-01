export const STT_VOCAB_PROFILE_OPTIONS = [
  { value: "frontend", label: "前端开发" },
  { value: "backend", label: "后端开发" },
  { value: "agent-fullstack", label: "Agent / 全栈" },
];

const STT_VOCAB_PROFILE_STORAGE_KEY = "stt_vocab_profile";
const DEFAULT_PROFILE = "backend";

export function getSttVocabProfileLabel(value) {
  return STT_VOCAB_PROFILE_OPTIONS.find((option) => option.value === value)?.label || value;
}

export function loadSttVocabProfile() {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  const saved = window.localStorage.getItem(STT_VOCAB_PROFILE_STORAGE_KEY) || DEFAULT_PROFILE;
  return STT_VOCAB_PROFILE_OPTIONS.some((option) => option.value === saved)
    ? saved
    : DEFAULT_PROFILE;
}

export function saveSttVocabProfile(value) {
  if (typeof window === "undefined") return;
  if (!STT_VOCAB_PROFILE_OPTIONS.some((option) => option.value === value)) return;
  window.localStorage.setItem(STT_VOCAB_PROFILE_STORAGE_KEY, value);
}
