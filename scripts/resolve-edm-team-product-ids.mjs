#!/usr/bin/env node
/**
 * 按商品名解析 Pixel EDM Team 在 Creem 正式 / Dodo live|test 的 product id。
 * 不打印 API Key；仅 stdout 输出 env 名= id，供写入 Vercel 或 .env.local。
 *
 * 依赖：content-up 仓库已安装 `creem`、`dodopayments`，且存在：
 * - ../content-up/.env.local（CREEM_API_KEY）
 * - ../content-up/.env.dodo-live.local（Dodo 正式，可选）
 * - ../content-up/.env.local 内 DODO_PAYMENTS_API_KEY（Dodo 测试）
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contentUp = join(root, "..", "content-up");

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnv(join(contentUp, ".env.local"));

const CREEM_TEAM = {
  monthly: "Pixel EDM Team Monthly",
  yearly: "Pixel EDM Team Yearly",
};

async function creemLiveTeamIds() {
  const { Creem } = require(join(contentUp, "node_modules/creem"));
  const apiKey = process.env.CREEM_API_KEY?.trim();
  if (!apiKey) throw new Error("缺少 content-up .env.local 中的 CREEM_API_KEY");
  const creem = new Creem({ apiKey, server: "prod" });
  const page = await creem.products.search(1, 50);
  const items = page.items ?? [];
  const byName = new Map(items.map((p) => [p.name, p.id]));
  return {
    CREEM_EDM_TEAM_MONTHLY_PRODUCT_ID: byName.get(CREEM_TEAM.monthly),
    CREEM_EDM_TEAM_YEARLY_PRODUCT_ID: byName.get(CREEM_TEAM.yearly),
  };
}

async function dodoTeamIds(environment) {
  if (environment === "live_mode") {
    loadEnv(join(contentUp, ".env.dodo-live.local"));
  }
  const DodoPayments = (await import("dodopayments")).default;
  const key = process.env.DODO_PAYMENTS_API_KEY?.trim();
  if (!key) throw new Error("缺少 DODO_PAYMENTS_API_KEY");
  const client = new DodoPayments({
    bearerToken: key,
    environment,
    webhookKey: null,
  });
  const byName = new Map();
  for await (const p of client.products.list({ limit: 100 })) {
    if (/^Pixel EDM Team (Monthly|Yearly)$/.test(p.name)) {
      byName.set(p.name, p.product_id);
    }
  }
  return {
    DODO_EDM_TEAM_MONTHLY_PRODUCT_ID: byName.get(CREEM_TEAM.monthly),
    DODO_EDM_TEAM_YEARLY_PRODUCT_ID: byName.get(CREEM_TEAM.yearly),
  };
}

const mode = process.argv[2] ?? "production";
const creem = await creemLiveTeamIds();

if (mode === "preview") {
  const dodo = await dodoTeamIds("test_mode");
  for (const [k, v] of Object.entries({ ...creem, ...dodo })) {
    if (!v) console.error(`# 未找到 ${k}`);
    else console.log(`${k}=${v}`);
  }
} else if (mode === "production") {
  const dodo = await dodoTeamIds("live_mode");
  for (const [k, v] of Object.entries({ ...creem, ...dodo })) {
    if (!v) console.error(`# 未找到 ${k}`);
    else console.log(`${k}=${v}`);
  }
} else {
  console.error("用法: node scripts/resolve-edm-team-product-ids.mjs [production|preview]");
  process.exit(1);
}
