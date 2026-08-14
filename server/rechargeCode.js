import crypto from "crypto";

const CODE_PREFIX = "AIASSIST";

export const RECHARGE_PACKAGES = {
  trial: { credits: 30, label: "体验包", priceHint: "¥9.9 / 30 次" },
  standard: { credits: 150, label: "标准包", priceHint: "¥29.9 / 150 次，主推" },
  heavy: { credits: 400, label: "高频包", priceHint: "¥59.9 / 400 次，推荐" },
};

export function normalizeDeviceLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "")
    .slice(0, 8);
}

function signPayload(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
}

export function createRechargeCode({ credits, deviceLabel = null, secret }) {
  if (!secret) throw new Error("RECHARGE_SECRET is required");
  const amount = Number(credits);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("credits must be a positive number");
  }
  const boundDevice = deviceLabel ? normalizeDeviceLabel(deviceLabel) : "ANY";
  const payload = `${amount}:${boundDevice}`;
  const signature = signPayload(payload, secret);
  return `${CODE_PREFIX}-${amount}-${boundDevice}-${signature}`;
}

export function verifyRechargeCode(code, { deviceLabel, secret } = {}) {
  if (!secret) {
    return { ok: false, error: "服务端未配置 RECHARGE_SECRET，无法兑换充值码。" };
  }

  const raw = String(code || "").trim();
  const parts = raw.split("-").map((part) => part.trim());
  if (parts.length !== 4 || parts[0].toUpperCase() !== CODE_PREFIX) {
    return { ok: false, error: "充值码格式不正确。" };
  }

  const amount = Number(parts[1]);
  const boundDevice = parts[2].toLowerCase();
  const signature = parts[3].toUpperCase();

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "充值码次数无效。" };
  }

  const payload = `${amount}:${boundDevice}`;
  const expected = signPayload(payload, secret);
  if (signature !== expected) {
    return { ok: false, error: "充值码无效或已被篡改。" };
  }

  if (boundDevice !== "ANY") {
    const localLabel = normalizeDeviceLabel(deviceLabel);
    if (!localLabel || localLabel !== boundDevice) {
      return { ok: false, error: "此充值码只能在本机标识匹配的设备上兑换。" };
    }
  }

  return {
    ok: true,
    credits: amount,
    code: `${CODE_PREFIX}-${amount}-${boundDevice}-${signature}`,
    boundDevice,
  };
}
