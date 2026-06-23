import crypto from "crypto";

const CODE_PREFIX = "AIASSIST";

export const RECHARGE_PACKAGES = {
  trial: { credits: 10, label: "体验", priceHint: "¥5 / 10 次" },
  regular: { credits: 50, label: "常规", priceHint: "¥20 / 50 次" },
  common: { credits: 100, label: "常用", priceHint: "¥35 / 100 次" },
  heavy: { credits: 200, label: "重度", priceHint: "¥60 / 200 次" },
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
