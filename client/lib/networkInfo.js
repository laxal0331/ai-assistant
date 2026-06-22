let cachedNetworkInfo = null;

export async function fetchNetworkInfo({ force = false } = {}) {
  if (cachedNetworkInfo && !force) return cachedNetworkInfo;
  const resp = await fetch("/api/network-info");
  if (!resp.ok) throw new Error(`无法获取网络信息（${resp.status}）`);
  cachedNetworkInfo = await resp.json();
  return cachedNetworkInfo;
}

export function clearNetworkInfoCache() {
  cachedNetworkInfo = null;
}
