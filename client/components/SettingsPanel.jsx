import { useEffect, useRef, useState } from "react";
import Button from "./Button";
import { LLM_MODEL_OPTIONS, getLlmModelLabel } from "../lib/llmModels";
import {
  getSttVocabProfileLabel,
  STT_VOCAB_PROFILE_OPTIONS,
} from "../lib/sttVocabProfile";
import { formatAcceleratorLabel, keyboardEventToAccelerator } from "../lib/screenshotHotkey";

const languageLabelMap = {
  "zh-CN": "中文",
  en: "英文",
  ja: "日语",
};

export default function SettingsPanel({
  open,
  onClose,
  llmModelChoice,
  setLlmModelChoice,
  minSendChars,
  setMinSendChars,
  languageMode,
  setLanguageMode,
  sttVocabProfile,
  setSttVocabProfile,
  autoSendEnabled,
  setAutoSendEnabled,
  screenshotSilentSend,
  setScreenshotSilentSend,
  screenshotAnalysisMode,
  setScreenshotAnalysisMode,
  useResumeContext,
  setUseResumeContext,
  resumeSummary,
  setResumeSummary,
  uploadResumeMd,
  usage,
  refreshUsage,
}) {
  const isDesktopApp = typeof window !== "undefined" && !!window.desktopApp?.isDesktopApp;
  const hotkeyCaptureRef = useRef(null);
  const [screenshotHotkeyLabel, setScreenshotHotkeyLabel] = useState("Ctrl+S");
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState("");
  const [hotkeySaving, setHotkeySaving] = useState(false);
  const [rechargeCode, setRechargeCode] = useState("");
  const [rechargeError, setRechargeError] = useState("");
  const [rechargeSuccess, setRechargeSuccess] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [copyHint, setCopyHint] = useState("");

  useEffect(() => {
    if (!open || !isDesktopApp) return;
    const info = window.desktopApp.getScreenshotHotkey();
    setScreenshotHotkeyLabel(info?.label || "Ctrl+S");
    setHotkeyError("");
    setRecordingHotkey(false);
  }, [open, isDesktopApp]);

  useEffect(() => {
    if (!open || !recordingHotkey) return undefined;
    const node = hotkeyCaptureRef.current;
    node?.focus();

    function handleKeyDown(event) {
      event.preventDefault();
      event.stopPropagation();
      const accelerator = keyboardEventToAccelerator(event);
      if (!accelerator) return;

      setRecordingHotkey(false);
      setHotkeySaving(true);
      setHotkeyError("");
      window.desktopApp
        .setScreenshotHotkey(accelerator)
        .then((result) => {
          if (!result?.ok) {
            setHotkeyError(result?.error || "快捷键设置失败");
            const info = window.desktopApp.getScreenshotHotkey();
            setScreenshotHotkeyLabel(info?.label || "Ctrl+S");
            return;
          }
          setScreenshotHotkeyLabel(result.label || formatAcceleratorLabel(accelerator));
        })
        .catch((error) => {
          setHotkeyError(error?.message || String(error));
        })
        .finally(() => {
          setHotkeySaving(false);
        });
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, recordingHotkey]);

  useEffect(() => {
    if (!open) return;
    refreshUsage?.();
    setRechargeCode("");
    setRechargeError("");
    setRechargeSuccess("");
    setCopyHint("");
  }, [open, refreshUsage]);

  async function handleCopyDeviceLabel() {
    const label = usage?.deviceLabel || "";
    if (!label) return;
    try {
      await navigator.clipboard.writeText(label);
      setCopyHint("已复制");
    } catch {
      setCopyHint("复制失败");
    }
  }

  async function handleRedeemCode() {
    const code = rechargeCode.trim();
    if (!code) {
      setRechargeError("请输入充值码");
      return;
    }
    setRedeeming(true);
    setRechargeError("");
    setRechargeSuccess("");
    try {
      const resp = await fetch("/api/usage/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setRechargeError(data.error || "兑换失败");
        return;
      }
      setRechargeSuccess(`已增加 ${data.creditsAdded} 次`);
      setRechargeCode("");
      await refreshUsage?.();
    } catch (error) {
      setRechargeError(error?.message || "兑换失败");
    } finally {
      setRedeeming(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">设置</h2>
          <button type="button" className="text-gray-500 hover:text-gray-800" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 text-sm border border-gray-100 rounded-lg p-3 bg-gray-50">
          <div className="font-medium text-gray-800">用量与充值</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-600">本机标识</span>
            <code className="px-2 py-1 rounded bg-white border border-gray-200 font-mono text-xs">
              {usage?.deviceLabel || "加载中…"}
            </code>
            <button
              type="button"
              onClick={handleCopyDeviceLabel}
              className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
            >
              复制
            </button>
            {copyHint ? <span className="text-xs text-gray-500">{copyHint}</span> : null}
          </div>
          <div className="text-gray-700">
            剩余次数：
            <span className="font-semibold">
              {usage ? `${usage.remaining} / ${usage.creditsTotal}` : "…"}
            </span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            纯文字或 1 张图：消耗 1 次；同一消息每多 1 张图多扣 1 次（例如 2 张图扣 2 次）。勾选「启用参考资料上下文」时上述次数 ×2。新机器默认赠送 20 次体验。
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-gray-700">充值码</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={rechargeCode}
                onChange={(e) => setRechargeCode(e.target.value)}
                placeholder="粘贴充值码"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 bg-white font-mono text-xs"
              />
              <Button
                onClick={handleRedeemCode}
                className="bg-teal-600 shrink-0"
                disabled={redeeming}
              >
                {redeeming ? "兑换中…" : "兑换"}
              </Button>
            </div>
            {rechargeError ? (
              <p className="text-xs text-red-700 bg-red-50 rounded p-2">{rechargeError}</p>
            ) : null}
            {rechargeSuccess ? (
              <p className="text-xs text-green-700 bg-green-50 rounded p-2">{rechargeSuccess}</p>
            ) : null}
          </div>
          <div className="text-xs text-gray-500 leading-relaxed border-t border-gray-200 pt-2">
            套餐参考：体验 ¥5/10 次 · 常规 ¥20/50 次 · 常用 ¥35/100 次 · 重度 ¥60/200 次。
            充值码默认绑定本机标识，请将标识发给管理员后再兑换。
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-700">模型</span>
          <select
            value={llmModelChoice}
            onChange={(e) => setLlmModelChoice(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 bg-white"
          >
            {LLM_MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">当前：{getLlmModelLabel(llmModelChoice)}</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-700">最小字数（语音自动发送阈值）</span>
          <input
            type="number"
            min={1}
            max={100}
            value={minSendChars}
            onChange={(e) => setMinSendChars(Math.max(1, Number(e.target.value) || 1))}
            className="w-24 border border-gray-300 rounded-lg px-3 py-2 bg-white"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-700">转写语言</span>
          <select
            value={languageMode}
            onChange={(e) => setLanguageMode(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 bg-white"
          >
            {Object.entries(languageLabelMap).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-700">转写词汇（岗位）</span>
          <select
            value={sttVocabProfile}
            onChange={(e) => setSttVocabProfile(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 bg-white"
          >
            {STT_VOCAB_PROFILE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500 leading-relaxed">
            当前：{getSttVocabProfileLabel(sttVocabProfile)}。优先识别该岗位高频术语，通用开发词为辅助；若正在语音会话，切换后会自动重连转写通道。
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoSendEnabled}
            onChange={(e) => setAutoSendEnabled(e.target.checked)}
          />
          静音 800ms 自动发送
        </label>

        {isDesktopApp ? (
          <div className="flex flex-col gap-2 text-sm border-t border-gray-100 pt-3">
            <span className="text-gray-700">截图问 AI 快捷键</span>
            <p className="text-xs text-gray-500">
              全局快捷键：截屏并自动发送给 AI。默认 Ctrl+S，可自定义。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-2 rounded-lg bg-gray-100 font-mono text-sm min-w-[120px] text-center">
                {recordingHotkey ? "请按下快捷键…" : screenshotHotkeyLabel}
              </span>
              <Button
                onClick={() => {
                  setHotkeyError("");
                  setRecordingHotkey(true);
                }}
                className="bg-indigo-600"
                disabled={hotkeySaving || recordingHotkey}
              >
                {recordingHotkey ? "录制中…" : "更改快捷键"}
              </Button>
              <Button
                onClick={async () => {
                  setHotkeySaving(true);
                  setHotkeyError("");
                  const result = await window.desktopApp.setScreenshotHotkey("Control+S");
                  setHotkeySaving(false);
                  if (!result?.ok) {
                    setHotkeyError(result?.error || "恢复默认失败");
                    return;
                  }
                  setScreenshotHotkeyLabel(result.label || "Ctrl+S");
                }}
                className="bg-gray-500"
                disabled={hotkeySaving || recordingHotkey}
              >
                恢复默认
              </Button>
            </div>
            <div
              ref={hotkeyCaptureRef}
              tabIndex={-1}
              className="sr-only"
              aria-hidden="true"
            />
            {hotkeyError ? (
              <p className="text-xs text-red-700 bg-red-50 rounded p-2">{hotkeyError}</p>
            ) : null}
            <label className="flex items-start gap-2 mt-1">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={screenshotSilentSend}
                onChange={(e) => setScreenshotSilentSend(e.target.checked)}
              />
              <span className="text-xs text-gray-600 leading-relaxed">
                截图发送时不显示主窗口（后台 OCR 并问 AI，手机同步照常收到回答；失败时用系统通知提示）
              </span>
            </label>
            <label className="flex flex-col gap-1 mt-2">
              <span className="text-gray-700">截图处理方式</span>
              <select
                value={screenshotAnalysisMode || "ocr"}
                onChange={(e) => setScreenshotAnalysisMode(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 bg-white"
              >
                <option value="ocr">OCR 识字，速度快，只适合文字内容</option>
                <option value="vision">Qwen 识图大模型，能理解画面，但更慢</option>
              </select>
            </label>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 text-sm border-t border-gray-100 pt-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useResumeContext}
              onChange={(e) => setUseResumeContext(e.target.checked)}
            />
            启用参考资料上下文
          </label>
          <p className="text-xs text-gray-500 -mt-1">勾选后本次消耗次数 ×2（例如 2 张图从 2 次变为 4 次）。</p>
          <label className="flex flex-col gap-1">
            <span className="text-gray-700">上传参考资料（.md / .txt）</span>
            <input
              type="file"
              accept=".md,text/markdown,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadResumeMd(file);
                e.target.value = "";
              }}
              className="text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-700">参考资料摘要（可编辑）</span>
            <textarea
              value={resumeSummary}
              onChange={(e) => setResumeSummary(e.target.value)}
              placeholder="上传文件后会自动生成，也可手动编辑"
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y min-h-[80px]"
            />
          </label>
        </div>

        <div className="flex justify-end pt-1">
          <Button onClick={onClose} className="bg-gray-600">
            完成
          </Button>
        </div>
      </div>
    </div>
  );
}
