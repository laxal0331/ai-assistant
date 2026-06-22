import { useEffect, useRef, useState } from "react";
import { Plus, Send, X } from "react-feather";
import Button from "./Button";
import {
  collectImageFilesFromClipboard,
  readFileAsAttachment,
  revokeAttachmentPreview,
} from "../lib/imageAttachments";

export default function ChatComposer({
  onSend,
  disabled = false,
  busy = false,
  compact = false,
  className = "",
  placeholder = "输入消息",
}) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(revokeAttachmentPreview);
    };
  }, []);

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
    if (next.length) {
      setAttachments((prev) => [...prev, ...next]);
    }
  }

  function removeAttachment(id) {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      revokeAttachmentPreview(target);
      return prev.filter((item) => item.id !== id);
    });
  }

  async function handleSend() {
    const text = message.trim();
    if (!text && attachments.length === 0) return;
    await onSend({
      text,
      files: attachments.map((item) => item.file),
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

  return (
    <div className={`w-full ${shellClass} ${className}`.trim()}>
      {attachments.length > 0 ? (
        <div className={`flex flex-wrap gap-1 ${compact ? "px-0.5 pb-1" : "px-1 pb-2"}`}>
          {attachments.map((item) => (
            <div
              key={item.id}
              className={`relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50 ${
                compact ? "h-10 w-10" : "h-16 w-16"
              }`}
            >
              <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
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
          ref={textareaRef}
          value={message}
          disabled={disabled || busy}
          onChange={(e) => setMessage(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!disabled && !busy) handleSend();
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
          disabled={disabled || busy}
          icon={busy ? null : <Send height={compact ? 14 : 16} />}
          className={`bg-blue-600 shrink-0 whitespace-nowrap disabled:opacity-50 ${
            compact ? "!p-2.5 text-xs" : ""
          }`}
        >
          {busy ? "识别中…" : "发送"}
        </Button>
      </div>
    </div>
  );
}
