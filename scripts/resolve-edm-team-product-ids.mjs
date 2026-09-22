#!/usr/bin/env node
/**
 * 按商品名解析 Pixel EDM Pro/Team 在 Creem 正式及 Dodo live|test 的 product id。
 * Dodo 不复用 content-up 的 DODO_PRO_*，因为那些变量属于主站 ContentUp 商品。
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

const CREEM_PRODUCTS = {
  CREEM_EDM_PRO_MONTHLY_PRODUCT_ID: "Pixel EDM Pro Monthly",
  CREEM_EDM_PRO_YEARLY_PRODUCT_ID: "Pixel EDM Pro Yearly",
  CREEM_EDM_TEAM_MONTHLY_PRODUCT_ID: "Pixel EDM Team Monthly",
  CREEM_EDM_TEAM_YEARLY_PRODUCT_ID: "Pixel EDM Team Yearly",
};

async function creemLiveProductIds() {
  const { Creem } = require(join(contentUp, "node_modules/creem"));
  const apiKey = process.env.CREEM_API_KEY?.trim();
  if (!apiKey) throw new Error("缺少 content-up .env.local 中的 CREEM_API_KEY");
  const creem = new Creem({ apiKey, server: "prod" });
  const expectedNames = new Set(Object.values(CREEM_PRODUCTS));
  const byName = new Map();
  let pageNumber = 1;
  while (pageNumber) {
    const page = await creem.products.search(pageNumber, 100);
    for (const product of page.items ?? []) {
      if (!expectedNames.has(product.name) || product.status !== "active")
        continue;
      if (byName.has(product.name)) {
        throw new Error(`Creem 正式环境中存在重名商品：${product.name}`);
      }
      byName.set(product.name, product.id);
    }
    pageNumber = page.pagination?.nextPage ?? 0;
  }
  const missing = [...expectedNames].filter((name) => !byName.has(name));
  if (missing.length) {
    throw new Error(`Creem 正式环境缺少可用商品：${missing.join("、")}`);
  }
  return Object.fromEntries(
    Object.entries(CREEM_PRODUCTS).map(([envKey, name]) => [
      envKey,
      byName.get(name),
    ]),
  );
}

const DODO_PRODUCTS = {
  DODO_EDM_PRO_MONTHLY_PRODUCT_ID: "Pixel EDM Pro Monthly",
  DODO_EDM_PRO_YEARLY_PRODUCT_ID: "Pixel EDM Pro Yearly",
  DODO_EDM_TEAM_MONTHLY_PRODUCT_ID: "Pixel EDM Team Monthly",
  DODO_EDM_TEAM_YEARLY_PRODUCT_ID: "Pixel EDM Team Yearly",
};

async function dodoEdmProductIds(environment) {
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
  const expectedNames = new Set(Object.values(DODO_PRODUCTS));
  const byName = new Map();
  for await (const p of client.products.list({ limit: 100 })) {
    if (!expectedNames.has(p.name)) continue;
    if (byName.has(p.name)) {
      throw new Error(`Dodo ${environment} 中存在重名商品：${p.name}`);
    }
    byName.set(p.name, p.product_id);
  }
  const ids = Object.fromEntries(
    Object.entries(DODO_PRODUCTS).map(([envKey, name]) => [
      envKey,
      byName.get(name),
    ]),
  );
  const missing = Object.entries(ids)
    .filter(([, id]) => !id)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Dodo ${environment} 缺少商品：${missing.join("、")}`);
  }
  return ids;
}

const mode = process.argv[2] ?? "production";

if (mode === "preview") {
  const dodo = await dodoEdmProductIds("test_mode");
  for (const [k, v] of Object.entries(dodo)) {
    console.log(`${k}=${v}`);
  }
} else if (mode === "production") {
  const creem = await creemLiveProductIds();
  const dodo = await dodoEdmProductIds("live_mode");
  for (const [k, v] of Object.entries({ ...creem, ...dodo })) {
    console.log(`${k}=${v}`);
  }
} else {
  console.error(
    "用法: node scripts/resolve-edm-team-product-ids.mjs [production|preview]",
  );
  process.exit(1);
}
