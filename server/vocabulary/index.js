import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.join(__dirname, "profiles");

export const PROFILE_IDS = ["frontend", "backend", "agent-fullstack"];

const DEFAULT_PROFILE_ID = (process.env.STT_VOCAB_PROFILE || "backend").trim();
// Deepgram Nova-3：keyterm 按 token 上限（约 500），不是「95 个词」。
// 在本机 API 上实测：merged 95 词 → 400；岗位 primary 取 65 → 三 profile 均通过。
const KEYTERM_LIMIT = Math.max(
  1,
  Math.min(85, Number(process.env.STT_KEYTERM_LIMIT) || 65),
);

let commonPack = null;
const profilePacks = new Map();
const replacementCache = new Map();
const keytermCache = new Map();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileReplacement(entry) {
  const from = String(entry?.from || "").trim();
  const to = String(entry?.to ?? "").trim();
  if (!from || !to) return null;

  const flags = entry?.ignoreCase ? "gi" : "g";
  const escaped = escapeRegExp(from).replace(/\s+/g, "\\s+");
  const pattern = entry?.wordBoundary ? `\\b${escaped}\\b` : escaped;
  try {
    return { regex: new RegExp(pattern, flags), to };
  } catch {
    return null;
  }
}

function dedupeKeyterms(terms) {
  const seen = new Set();
  const out = [];
  for (const raw of terms) {
    const term = String(raw || "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function parseExtraKeyterms() {
  return (process.env.STT_EXTRA_KEYTERMS || "")
    .split(/[,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadCommonPack() {
  if (commonPack) return commonPack;
  const filePath = path.join(PROFILES_DIR, "_common.json");
  const data = readJson(filePath);
  commonPack = {
    secondaryKeyterms: Array.isArray(data.secondaryKeyterms) ? data.secondaryKeyterms : [],
    replacements: Array.isArray(data.replacements) ? data.replacements : [],
  };
  return commonPack;
}

function loadProfilePack(profileId) {
  const id = normalizeProfileId(profileId);
  if (profilePacks.has(id)) return profilePacks.get(id);

  const filePath = path.join(PROFILES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    const fallbackId = PROFILE_IDS.find((candidate) =>
      fs.existsSync(path.join(PROFILES_DIR, `${candidate}.json`)),
    );
    if (fallbackId && fallbackId !== id) {
      return loadProfilePack(fallbackId);
    }
    throw new Error(`Missing STT vocabulary profile file: ${id}.json`);
  }

  const data = readJson(filePath);
  const pack = {
    id: data.id || id,
    label: data.label || id,
    description: data.description || "",
    primaryKeyterms: Array.isArray(data.primaryKeyterms) ? data.primaryKeyterms : [],
    replacements: Array.isArray(data.replacements) ? data.replacements : [],
  };
  profilePacks.set(id, pack);
  return pack;
}

export function initSttVocabulary() {
  loadCommonPack();
  for (const id of PROFILE_IDS) {
    loadProfilePack(id);
    getKeytermsForDeepgram(id);
    getReplacementRules(id);
  }
}

export function normalizeProfileId(profileId) {
  const id = String(profileId || "").trim();
  return PROFILE_IDS.includes(id) ? id : DEFAULT_PROFILE_ID;
}

export function getDefaultProfileId() {
  return normalizeProfileId(DEFAULT_PROFILE_ID);
}

export function listSttVocabProfiles() {
  return PROFILE_IDS.map((id) => {
    const pack = loadProfilePack(id);
    return {
      id: pack.id,
      label: pack.label,
      description: pack.description,
    };
  });
}

export function getSttVocabProfileLabel(profileId) {
  return loadProfilePack(normalizeProfileId(profileId)).label;
}

export function getKeytermsForDeepgram(profileId) {
  const id = normalizeProfileId(profileId);
  if (keytermCache.has(id)) return keytermCache.get(id);

  const profile = loadProfilePack(id);
  // 仅发岗位 primary（+ EXTRA）；secondary 只做事后 replacements，避免 token 超限 400
  const merged = dedupeKeyterms([...parseExtraKeyterms(), ...profile.primaryKeyterms]);
  const keyterms = merged.slice(0, KEYTERM_LIMIT);
  keytermCache.set(id, keyterms);
  return keyterms;
}

export function getReplacementRules(profileId) {
  const id = normalizeProfileId(profileId);
  if (replacementCache.has(id)) return replacementCache.get(id);

  const profile = loadProfilePack(id);
  const common = loadCommonPack();
  const rules = [];
  for (const entry of [...profile.replacements, ...common.replacements]) {
    const compiled = compileReplacement(entry);
    if (compiled) rules.push(compiled);
  }
  replacementCache.set(id, rules);
  return rules;
}

export function normalizeTranscript(text, options = {}) {
  const { profileId = getDefaultProfileId(), applyReplacements = true } = options;
  let out = String(text || "").trim();
  if (!out || !applyReplacements) return out;

  const rules = getReplacementRules(profileId);
  for (const { regex, to } of rules) {
    out = out.replace(regex, to);
  }
  return out;
}

export function appendDeepgramKeyterms(urlString, profileId) {
  const url = new URL(urlString);
  for (const term of getKeytermsForDeepgram(profileId)) {
    url.searchParams.append("keyterm", term);
  }
  return url.toString();
}

export function buildDeepgramListenUrl(baseParams, profileId) {
  const params = new URLSearchParams(baseParams);
  const url = new URL(`https://api.deepgram.com/v1/listen?${params.toString()}`);
  return appendDeepgramKeyterms(url.toString(), profileId);
}

export function buildDeepgramStreamUrl(baseParams, profileId) {
  const params = new URLSearchParams(baseParams);
  const url = new URL(`wss://api.deepgram.com/v1/listen?${params.toString()}`);
  return appendDeepgramKeyterms(url.toString(), profileId);
}
