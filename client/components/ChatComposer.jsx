import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Send, X } from "react-feather";
import Button from "./Button";
import {
  collectImageFilesFromClipboard,
  readFileAsAttachment,
  revokeAttachmentPreview,
} from "../lib/imageAttachments";
import { recognizeImageFile } from "../lib/ocrClient";

function InputPreviewPanel({ liveTranscript, attachments }) {
  const transcript = (liveTranscript || "").trim();
  const visibleAttachments = attachments.filter(
    (item) => item.ocrStatus !== "idle" || item.ocrText,
  );
  if (!transcript && visibleAttachments.length === 0) return null;

  return (
    <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800 max-h-36 overflow-y-auto space-y-2">
      <div className="text-[11px] font-medium text-gray-500">实时内容（转写 + 图片识别）</div>
      {transcript ? (
        <div className="whitespace-pre-wrap">
          <span className="text-teal-700 font-medium">转写 </span>
          {transcript}
        </div>
      ) : null}
      {visibleAttachments.map((item) => {
        const imageIndex = attachments.findIndex((entry) => entry.id === item.id) + 1;
        return (
        <div key={item.id} className="whitespace-pre-wrap">
          <span className="text-blue-700 font-medium">
            图{imageIndex}
            {attachments.length > 1 ? `/${attachments.length}` : ""}{" "}
          </span>
          {item.ocrStatus === "loading" ? (
            <span className="text-gray-500">识别中…</span>
          ) : null}
          {item.ocrStatus === "error" ? (
            <span className="text-red-700">识别失败：{item.ocrError || "未知错误"}</span>
          ) : null}
          {item.ocrStatus === "done" ? (
            item.ocrText?.trim() || <span className="text-gray-500">(未识别到文字)</span>
          ) : null}
        </div>
        );
      })}
    </div>
  );
}

export default function ChatComposer({
  onSend,
  disabled = false,
  busy = false,
  compact = false,
  className = "",
  placeholder = "输入消息",
  liveTranscript = "",
  languageMode = "zh-CN",
}) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const attachmentsRef = useRef(attachments);
  const languageModeRef = useRef(languageMode);
  attachmentsRef.current = attachments;
  languageModeRef.current = languageMode;

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(revokeAttachmentPreview);
    };
  }, []);

  const runOcrForAttachment = useCallback(async (attachment) => {
    const attachmentId = attachment.id;
    setAttachments((prev) =>
      prev.map((item) =>
        item.id === attachmentId
          ? { ...item, ocrStatus: "loading", ocrError: "", ocrText: "" }
          : item,
      ),
    );
    try {
      const text = await recognizeImageFile(attachment.file, languageModeRef.current);
      setAttachments((prev) => {
        if (!prev.some((item) => item.id === attachmentId)) return prev;
        return prev.map((item) =>
          item.id === attachmentId
            ? { ...item, ocrStatus: "done", ocrText: text, ocrError: "" }
            : item,
        );
      });
    } catch (error) {
      setAttachments((prev) => {
        if (!prev.some((item) => item.id === attachmentId)) return prev;
        return prev.map((item) =>
          item.id === attachmentId
            ? {
                ...item,
                ocrStatus: "error",
                ocrError: error?.message || String(error),
                ocrText: "",
              }
            : item,
        );
      });
    }
  }, []);

  const runOcrForAllAttachments = useCallback(
    (items) => {
      if (!items.length) return;
      Promise.all(items.map((item) => runOcrForAttachment(item)));
    },
    [runOcrForAttachment],
  );

  useEffect(() => {
    const items = attachmentsRef.current;
    if (!items.length) return;
    runOcrForAllAttachments(items);
  }, [languageMode, runOcrForAllAttachments]);

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const next = [];
    for (const file of incoming) {
      try {
        next.push(readFileAsAttachment(file));
      } catch (error) {
        window.alert(error?.message || String(error));
      }
    }
    if (!next.length) return;
    setAttachments((prev) => [...prev, ...next]);
    runOcrForAllAttachments(next);
  }

  function removeAttachment(id) {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      revokeAttachmentPreview(target);
      return prev.filter((item) => item.id !== id);
    });
  }

  const ocrLoading = attachments.some((item) => item.ocrStatus === "loading");
  const ocrHasError = attachments.some((item) => item.ocrStatus === "error");
  const sendBlocked = disabled || busy || ocrLoading;

  async function handleSend() {
    const text = message.trim();
    if (!text && attachments.length === 0) return;
    if (ocrLoading) {
      window.alert("图片还在识别中，请稍候再发送。");
      return;
    }
    if (ocrHasError) {
      window.alert("部分图片识别失败，请移除后重试。");
      return;
    }
    await onSend({
      text,
      files: attachments.map((item) => item.file),
      ocrTexts: attachments.map((item) => item.ocrText || ""),
    });
    setMessage("");
    setAttachments((prev) => {
      prev.forEach(revokeAttachmentPreview);
      return [];
    });
  }

  function handlePaste(event) {
    const files = collectImageFilesFromClipboard(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  }

  const shellClass = compact
    ? "rounded-full border border-gray-200 bg-white shadow-sm px-1.5 py-1"
    : "rounded-2xl border border-gray-200 bg-white shadow-sm p-2";

  let sendLabel = "发送";
  if (busy) sendLabel = "发送中…";
  else if (ocrLoading) sendLabel = "识别中…";

  return (
    <div className={`w-full flex flex-col gap-2 ${className}`.trim()}>
      <InputPreviewPanel liveTranscript={liveTranscript} attachments={attachments} />

      <div className={shellClass}>
        {attachments.length > 0 ? (
          <div className={`flex flex-wrap gap-1 ${compact ? "px-0.5 pb-1" : "px-1 pb-2"}`}>
            {attachments.map((item) => (
              <div
                key={item.id}
                className={`relative rounded-lg overflow-hidden border bg-gray-50 ${
                  item.ocrStatus === "error"
                    ? "border-red-300"
                    : item.ocrStatus === "done"
                      ? "border-green-300"
                      : "border-gray-200"
                } ${compact ? "h-10 w-10" : "h-16 w-16"}`}
                title={
                  item.ocrStatus === "loading"
                    ? "识别中…"
                    : item.ocrStatus === "error"
                      ? item.ocrError
                      : item.ocrText?.slice(0, 80) || "已识别"
                }
              >
                <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                {item.ocrStatus === "loading" ? (
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center text-[10px] text-white">
                    OCR
                  </div>
                ) : null}
                <button
                  type="button"
                  className="absolute top-0.5 right-0.5 rounded-full bg-black/60 text-white p-0.5"
                  onClick={() => removeAttachment(item.id)}
                  aria-label="移除图片"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className={`flex items-center ${compact ? "gap-1" : "gap-2"}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => fileInputRef.current?.click()}
            className={`shrink-0 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center ${
              compact ? "h-9 w-9" : "h-10 w-10"
            }`}
            title="上传图片"
          >
            <Plus size={compact ? 16 : 18} />
          </button>

          <textarea
            value={message}
            disabled={disabled || busy}
            onChange={(e) => setMessage(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!sendBlocked) handleSend();
              }
            }}
            rows={1}
            placeholder={placeholder}
            className={`flex-1 min-w-0 border-0 bg-transparent outline-none ${
              compact
                ? "px-2 py-1.5 text-sm resize-none max-h-20 leading-5"
                : "px-2 py-2 text-sm resize-y max-h-32"
            }`}
          />

          <Button
            onClick={handleSend}
            disabled={sendBlocked}
            icon={busy || ocrLoading ? null : <Send height={compact ? 14 : 16} />}
            className={`bg-blue-600 shrink-0 whitespace-nowrap disabled:opacity-50 ${
              compact ? "!p-2.5 text-xs" : ""
            }`}
          >
            {sendLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
