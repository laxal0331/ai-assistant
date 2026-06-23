let cachedNetworkInfo = null;

export function clearNetworkInfoCache() {
  cachedNetworkInfo = null;
}

export async function fetchNetworkInfo({ bypassCache = false } = {}) {
  if (!bypassCache && cachedNetworkInfo) return cachedNetworkInfo;
  const resp = await fetch("/api/network-info");
  if (!resp.ok) throw new Error(`无法获取网络信息（${resp.status}）`);
  cachedNetworkInfo = await resp.json();
  return cachedNetworkInfo;
}

export function buildMobileBaseUrl(info) {
  if (!info) return null;
  if (info.mobileBaseUrl) return info.mobileBaseUrl;
  if (info.lanIp) {
    const port = Number(info.port) || 3000;
    return `http://${info.lanIp}:${port}`;
  }
  return null;
}

export function isLocalhostUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return true;
  }
}
