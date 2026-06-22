import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import Button from "./Button";
import { fetchNetworkInfo } from "../lib/networkInfo";
import { getMobilePageUrl } from "../lib/syncMessages";

export default function MobileSyncPanel({
  open,
  onClose,
  sessionId,
  connected,
  connectionError,
  onCreateOrOpen,
}) {
  const [mobileUrl, setMobileUrl] = useState("");
  const [lanIp, setLanIp] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;

    async function loadMobileUrl() {
      try {
        const info = await fetchNetworkInfo();
        if (cancelled) return;
        setLanIp(info.lanIp || null);
        const base = info.mobileBaseUrl || window.location.origin;
        setMobileUrl(getMobilePageUrl(sessionId, base));
      } catch {
        if (cancelled) return;
        setLanIp(null);
        setMobileUrl(getMobilePageUrl(sessionId));
      }
    }

    loadMobileUrl();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  if (!open) return null;

  async function handleCreate() {
    await onCreateOrOpen();
  }

  async function copyLink() {
    if (!mobileUrl) return;
    try {
      await navigator.clipboard.writeText(mobileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("复制此链接到手机浏览器：", mobileUrl);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">手机同步</h2>
          <button type="button" className="text-gray-500 hover:text-gray-800" onClick={onClose}>
            ✕
          </button>
        </div>

        {!sessionId ? (
          <div className="flex flex-col gap-3 items-center py-4">
            <p className="text-sm text-gray-600 text-center">
              点击下方按钮生成同步链接，手机扫码或打开链接即可实时查看对话。
            </p>
            <p className="text-xs text-gray-500 text-center">
              电脑可继续使用 localhost；二维码会自动使用局域网 IP，手机与电脑需在同一 WiFi。
            </p>
            <Button onClick={handleCreate} className="bg-blue-600">
              生成同步链接
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 break-all">{mobileUrl}</p>
            {!lanIp ? (
              <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">
                未检测到局域网 IP，手机链接可能无法访问。请确认电脑已连 WiFi，或手动将链接中的地址改为电脑的
                192.168.x.x。
              </p>
            ) : (
              <p className="text-xs text-green-800 bg-green-50 rounded p-2">
                电脑请保持 localhost 使用（语音/共享桌面正常）；手机请扫下方二维码（局域网
                {lanIp}）。
              </p>
            )}
            <div className="flex justify-center py-2 bg-gray-50 rounded-lg">
              {mobileUrl ? <QRCodeSVG value={mobileUrl} size={180} /> : null}
            </div>
            <div className="flex gap-2 justify-end">
              <Button onClick={copyLink} className="bg-gray-600">
                {copied ? "已复制" : "复制链接"}
              </Button>
              <Button onClick={handleCreate} className="bg-indigo-600">
                新建会话
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              电脑连接：{connected ? "已连接" : connectionError || "连接中…"}
              {sessionId ? ` · 会话 ID：${sessionId.slice(0, 8)}…` : ""}
            </p>
            {connectionError ? (
              <p className="text-xs text-red-700 bg-red-50 rounded p-2">{connectionError}</p>
            ) : null}
            <p className="text-xs text-gray-400">
              手机扫码后会单独连接；若手机也显示连接中，请确认在同一 WiFi 且电脑服务已启动。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
