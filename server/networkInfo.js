import os from "os";

function isPrivateIpv4(ip) {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(ip);
}

function getLanIpv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces || []) {
      const family = iface.family;
      if (family !== "IPv4" && family !== 4) continue;
      if (iface.internal) continue;
      const ip = iface.address;
      if (ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
      candidates.push(ip);
    }
  }

  return candidates.find(isPrivateIpv4) || candidates[0] || null;
}

export function getNetworkInfo(port) {
  const lanIp = getLanIpv4();
  const resolvedPort = Number(port) || 3000;
  return {
    port: resolvedPort,
    lanIp,
    mobileBaseUrl: lanIp ? `http://${lanIp}:${resolvedPort}` : null,
  };
}
