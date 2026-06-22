let cachedNetworkInfo = null;

export async function fetchNetworkInfo() {
  if (cachedNetworkInfo) return cachedNetworkInfo;
  const resp = await fetch("/api/network-info");
  if (!resp.ok) throw new Error(`无法获取网络信息（${resp.status}）`);
  cachedNetworkInfo = await resp.json();
  return cachedNetworkInfo;
}
