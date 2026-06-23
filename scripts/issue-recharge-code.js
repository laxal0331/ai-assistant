#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import {
  RECHARGE_PACKAGES,
  createRechargeCode,
  normalizeDeviceLabel,
} from "../server/rechargeCode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

function printHelp() {
  console.log(`用法:
  node scripts/issue-recharge-code.js --credits 50 --device a3f8c2e1
  node scripts/issue-recharge-code.js --package regular --device a3f8c2e1
  node scripts/issue-recharge-code.js --credits 50 --no-bind

参数:
  --credits <n>       增加次数
  --package <name>    套餐: trial | regular | common | heavy
  --device <label>    绑定本机标识前 8 位（默认绑定）
  --no-bind           不绑定设备（通用码）

套餐参考:
  trial    10 次   ${RECHARGE_PACKAGES.trial.priceHint}
  regular  50 次   ${RECHARGE_PACKAGES.regular.priceHint}
  common   100 次  ${RECHARGE_PACKAGES.common.priceHint}
  heavy    200 次  ${RECHARGE_PACKAGES.heavy.priceHint}
`);
}

function parseArgs(argv) {
  const args = {
    credits: null,
    packageName: null,
    device: null,
    bindDevice: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--no-bind") {
      args.bindDevice = false;
      continue;
    }
    if (arg === "--credits") {
      args.credits = Number(argv[++i]);
      continue;
    }
    if (arg === "--package") {
      args.packageName = String(argv[++i] || "").trim().toLowerCase();
      continue;
    }
    if (arg === "--device") {
      args.device = String(argv[++i] || "").trim();
      continue;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const secret = (process.env.RECHARGE_SECRET || "").trim();
if (!secret) {
  console.error("请在 .env 中设置 RECHARGE_SECRET=随机长字符串");
  process.exit(1);
}

let credits = args.credits;
if (args.packageName) {
  const pkg = RECHARGE_PACKAGES[args.packageName];
  if (!pkg) {
    console.error(`未知套餐: ${args.packageName}`);
    process.exit(1);
  }
  credits = pkg.credits;
}

if (!Number.isFinite(credits) || credits <= 0) {
  console.error("请通过 --credits 或 --package 指定有效次数");
  printHelp();
  process.exit(1);
}

const deviceLabel = args.bindDevice ? normalizeDeviceLabel(args.device) : null;

if (args.bindDevice && !deviceLabel) {
  console.error("绑定设备时请提供 --device <本机标识前8位>");
  process.exit(1);
}

const code = createRechargeCode({
  credits,
  deviceLabel,
  secret,
});

const pkg = Object.values(RECHARGE_PACKAGES).find((item) => item.credits === credits);

console.log("充值码:", code);
console.log("次数:", credits);
console.log("绑定:", deviceLabel || "不绑定（任意设备）");
if (pkg) {
  console.log("参考售价:", pkg.priceHint);
}
