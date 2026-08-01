import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import Button from "./Button";
import {
  buildMobileBaseUrl,
  clearNetworkInfoCache,
  fetchNetworkInfo,
  isLocalhostUrl,
} from "../lib/networkInfo";
import { getMobilePageUrl, getWatchPageUrl } from "../lib/syncMessages";

export default function MobileSyncPanel({
  open,
  onClose,
  sessionId,
  connected,
  connectionError,
  onCreateOrOpen,
}) {
  const [mobileUrl, setMobileUrl] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const [qrMode, setQrMode] = useState("mobile");
  const [lanIp, setLanIp] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !sessionId) return undefined;
    let cancelled = false;
    setQrMode("mobile");

    async function loadMobileUrl() {
      setLoadError("");
      clearNetworkInfoCache();
      try {
        const info = await fetchNetworkInfo({ bypassCache: true });
        if (cancelled) return;
        const base = buildMobileBaseUrl(info);
        setLanIp(info.lanIp || null);
        if (!base || isLocalhostUrl(base)) {
          setMobileUrl("");
          setWatchUrl("");
          setLoadError("未检测到可用的局域网 IP，手机无法通过 localhost 连接。请确认电脑已连接 WiFi。");
          return;
        }
        setMobileUrl(getMobilePageUrl(sessionId, base));
        setWatchUrl(getWatchPageUrl(sessionId, base));
      } catch (error) {
        if (cancelled) return;
        setLanIp(null);
        setMobileUrl("");
        setWatchUrl("");
        setLoadError(error?.message || "无法获取网络信息");
      }
    }

    loadMobileUrl();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  if (!open) return null;

  const activeUrl = qrMode === "watch" ? watchUrl : mobileUrl;

  async function handleCreate() {
    await onCreateOrOpen();
  }

  async function copyLink() {
    const url = activeUrl || mobileUrl || watchUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("复制此链接到手表浏览器：", url);
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
              手机与电脑需在同一 WiFi；二维码会自动使用局域网 IP，不会使用 localhost。
            </p>
            <Button onClick={handleCreate} className="bg-blue-600">
              生成同步链接
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-800">
                {qrMode === "watch" ? "手表二维码" : "手机二维码"}
              </p>
              <Button
                onClick={() => setQrMode((mode) => (mode === "watch" ? "mobile" : "watch"))}
                className="bg-slate-700 px-3 py-2 text-sm"
              >
                {qrMode === "watch" ? "切到手机" : "切到手表"}
              </Button>
            </div>
            {activeUrl ? (
              <p className="text-sm text-gray-600 break-all">{activeUrl}</p>
            ) : (
              <p className="text-sm text-gray-400">正在获取局域网链接…</p>
            )}
            {loadError ? (
              <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">{loadError}</p>
            ) : lanIp ? (
              <p className="text-xs text-green-800 bg-green-50 rounded p-2">
                电脑可继续使用本机窗口；手机请扫下方二维码（局域网 {lanIp}）。
              </p>
            ) : null}
            <div className="flex justify-center py-2 bg-gray-50 rounded-lg min-h-[180px] items-center">
              {activeUrl ? (
                <QRCodeSVG value={activeUrl} size={180} />
              ) : (
                <span className="text-xs text-gray-400 px-4 text-center">
                  {loadError || "等待局域网地址…"}
                </span>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button onClick={copyLink} className="bg-gray-600" disabled={!activeUrl}>
                {copied ? "已复制" : "复制链接"}
              </Button>
              <Button onClick={handleCreate} className="bg-indigo-600">
                新建会话
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              连接状态：{connected ? "已连接" : connectionError || "连接中…"}
              {sessionId ? ` · 会话 ID：${sessionId.slice(0, 8)}…` : ""}
            </p>
            {connectionError ? (
              <p className="text-xs text-red-700 bg-red-50 rounded p-2">{connectionError}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
