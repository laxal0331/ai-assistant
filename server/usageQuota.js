import crypto from "crypto";
import fs from "fs";
import path from "path";
import { verifyRechargeCode } from "./rechargeCode.js";

const USAGE_FILE = "usage.json";
const MAX_RECORDS = 100;

let dataDir = null;
let cachedStore = null;

function isEnabled() {
  const flag = (process.env.USAGE_QUOTA_ENABLED ?? "1").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(flag);
}

function defaultCreditsTotal() {
  const value = Number(process.env.USAGE_DEFAULT_CREDITS);
  return Number.isFinite(value) && value >= 0 ? value : 20;
}

function getUsagePath() {
  if (!dataDir) {
    throw new Error("Usage quota storage is not initialized");
  }
  return path.join(dataDir, USAGE_FILE);
}

function ensureDataDir() {
  if (!dataDir) throw new Error("Usage quota storage is not initialized");
  fs.mkdirSync(dataDir, { recursive: true });
}

function createDefaultStore() {
  const deviceId = crypto.randomUUID();
  const deviceLabel = deviceId.replace(/-/g, "").slice(0, 8).toLowerCase();
  return {
    deviceId,
    deviceLabel,
    creditsTotal: defaultCreditsTotal(),
    creditsUsed: 0,
    redeemedCodes: [],
    records: [],
    createdAt: new Date().toISOString(),
  };
}

function normalizeStore(raw) {
  const base = createDefaultStore();
  const store = {
    ...base,
    ...(raw && typeof raw === "object" ? raw : {}),
  };
  if (!store.deviceId) store.deviceId = base.deviceId;
  store.deviceLabel =
    normalizeDeviceLabel(store.deviceLabel) ||
    store.deviceId.replace(/-/g, "").slice(0, 8).toLowerCase();
  store.creditsTotal = Math.max(0, Number(store.creditsTotal) || 0);
  store.creditsUsed = Math.max(0, Number(store.creditsUsed) || 0);
  store.redeemedCodes = Array.isArray(store.redeemedCodes) ? store.redeemedCodes : [];
  store.records = Array.isArray(store.records) ? store.records.slice(0, MAX_RECORDS) : [];
  return store;
}

function loadStore() {
  ensureDataDir();
  const filePath = getUsagePath();
  if (!fs.existsSync(filePath)) {
    cachedStore = createDefaultStore();
    saveStore();
    return cachedStore;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  cachedStore = normalizeStore(parsed);
  return cachedStore;
}

function saveStore() {
  ensureDataDir();
  fs.writeFileSync(getUsagePath(), `${JSON.stringify(cachedStore, null, 2)}\n`, "utf-8");
}

function getStore() {
  if (!cachedStore) return loadStore();
  return cachedStore;
}

export function initUsageQuota(options = {}) {
  dataDir = options.dataDir;
  if (!dataDir) {
    throw new Error("initUsageQuota requires dataDir");
  }
  cachedStore = null;
  return getStore();
}

export function isQuotaEnabled() {
  return isEnabled();
}

export function normalizeDeviceLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "")
    .slice(0, 8);
}

export function computeChatCreditCost(options = {}) {
  const imageCount = Math.max(0, Number(options.imageCount) || 0);
  let cost = imageCount > 0 ? imageCount * 2 : 1;
  if (options.useResumeContext) {
    cost *= 2;
  }
  return cost;
}

export function getUsageSnapshot() {
  const store = getStore();
  const remaining = Math.max(0, store.creditsTotal - store.creditsUsed);
  return {
    enabled: isQuotaEnabled(),
    deviceId: store.deviceId,
    deviceLabel: store.deviceLabel,
    creditsTotal: store.creditsTotal,
    creditsUsed: store.creditsUsed,
    remaining,
    resumeContextCost: 2,
    defaultQuestionCost: 1,
    imageQuestionCost: 2,
  };
}

export function checkCanConsume(cost) {
  if (!isQuotaEnabled()) {
    return { ok: true, remaining: Infinity, cost };
  }
  const amount = Math.max(1, Number(cost) || 1);
  const snapshot = getUsageSnapshot();
  if (snapshot.remaining < amount) {
    return {
      ok: false,
      remaining: snapshot.remaining,
      cost: amount,
      message: `次数不足（需要 ${amount} 次，剩余 ${snapshot.remaining} 次）。请在设置中兑换充值码或联系管理员加次数。`,
    };
  }
  return { ok: true, remaining: snapshot.remaining, cost: amount };
}

export function consumeCredits(cost, meta = {}) {
  if (!isQuotaEnabled()) {
    return getUsageSnapshot();
  }
  const amount = Math.max(1, Number(cost) || 1);
  const store = getStore();
  store.creditsUsed += amount;
  store.records.unshift({
    at: new Date().toISOString(),
    cost: amount,
    source: meta.source || "unknown",
    useResumeContext: Boolean(meta.useResumeContext),
    imageCount: Math.max(0, Number(meta.imageCount) || 0),
  });
  store.records = store.records.slice(0, MAX_RECORDS);
  saveStore();
  return getUsageSnapshot();
}

export function redeemRechargeCode(code) {
  const secret = (process.env.RECHARGE_SECRET || "").trim();
  const store = getStore();
  const verified = verifyRechargeCode(code, {
    deviceLabel: store.deviceLabel,
    secret,
  });
  if (!verified.ok) {
    return verified;
  }

  if (store.redeemedCodes.includes(verified.code)) {
    return { ok: false, error: "此充值码已兑换过。" };
  }

  store.creditsTotal += verified.credits;
  store.redeemedCodes.unshift(verified.code);
  store.redeemedCodes = store.redeemedCodes.slice(0, 500);
  store.records.unshift({
    at: new Date().toISOString(),
    type: "redeem",
    creditsAdded: verified.credits,
    code: verified.code,
  });
  store.records = store.records.slice(0, MAX_RECORDS);
  saveStore();

  return {
    ok: true,
    creditsAdded: verified.credits,
    usage: getUsageSnapshot(),
  };
}
