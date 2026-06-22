import { useState } from "react";
import { LLM_MODEL_OPTIONS, getLlmModelLabel } from "../lib/llmModels";

const languageLabelMap = {
  "zh-CN": "中文",
  en: "英文",
  ja: "日语",
};

export default function SessionToolbar({
  llmModelChoice,
  setLlmModelChoice,
  isSessionActive,
  minSendChars,
  setMinSendChars,
  languageMode,
  setLanguageMode,
  liveTranscript,
}) {
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs shrink-0 max-w-full">
      <div className="whitespace-nowrap flex items-center gap-1 relative">
        <span>模型:</span>
        <button
          type="button"
          className="px-2 py-1 rounded bg-gray-200 max-w-[160px] truncate text-left"
          title={getLlmModelLabel(llmModelChoice)}
          onClick={() => setModelMenuOpen((v) => !v)}
        >
          {getLlmModelLabel(llmModelChoice)} ▼
        </button>
        {modelMenuOpen ? (
          <div className="absolute top-full right-0 mt-1 z-30 bg-white border border-gray-300 rounded shadow-md flex flex-col max-h-64 overflow-y-auto min-w-[200px]">
            {LLM_MODEL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`px-3 py-1.5 text-left ${llmModelChoice === option.value ? "bg-blue-600 text-white" : "hover:bg-gray-100"}`}
                onClick={() => {
                  setLlmModelChoice(option.value);
                  setModelMenuOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {isSessionActive ? (
        <>
          <label className="whitespace-nowrap flex items-center gap-1">
            最小字数
            <input
              type="number"
              min={1}
              max={100}
              value={minSendChars}
              onChange={(e) => setMinSendChars(Math.max(1, Number(e.target.value) || 1))}
              className="w-14 border border-gray-300 rounded px-1 py-0.5 bg-white"
            />
          </label>
          <div className="whitespace-nowrap flex items-center gap-1 relative">
            <span>语言:</span>
            <button
              type="button"
              className="px-2 py-1 rounded bg-gray-200 min-w-[72px] text-left"
              onClick={() => setLangMenuOpen((v) => !v)}
            >
              {languageLabelMap[languageMode]} ▼
            </button>
            {langMenuOpen ? (
              <div className="absolute top-full right-0 mt-1 z-30 bg-white border border-gray-300 rounded shadow-md flex flex-col">
                {["zh-CN", "en", "ja"].map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={`px-3 py-1 text-left ${languageMode === code ? "bg-blue-600 text-white" : "hover:bg-gray-100"}`}
                    onClick={() => {
                      setLanguageMode(code);
                      setLangMenuOpen(false);
                    }}
                  >
                    {languageLabelMap[code]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div
            className="text-gray-600 max-w-[180px] truncate"
            title={liveTranscript || "(等待语音)"}
          >
            转写: {liveTranscript || "(等待语音)"}
          </div>
        </>
      ) : null}
    </div>
  );
}
