# Team 档订阅接入清单

更新日期：2026-09-21。代码路径已支持 `plan=team` Checkout 与 Webhook 同步；**需在支付平台创建商品并写入环境变量** 后才能在生产收款。

## 定价（首版，与代码 `EDM_PLAN_PRICING` 一致）

| 档位 | 月付 | 年付 |
|------|------|------|
| Team | USD 29.90 | USD 299.90 |

商品名称建议：**Pixel EDM Team Monthly** / **Pixel EDM Team Yearly**（与 Pro 命名并列）。

## 1. Creem（正式 + 如需测试环境各一套）

1. Products → 新建 Team 月付、年付订阅，价格见上表。
2. 复制 product id → Vercel `pixel-edm`：
   - `CREEM_EDM_TEAM_MONTHLY_PRODUCT_ID`
   - `CREEM_EDM_TEAM_YEARLY_PRODUCT_ID`
3. Description 粘贴见 [`p12-billing-product-copy.md`](p12-billing-product-copy.md) Team 节。

Webhook 仍用现有 **Pixel EDM Production Webhook**（`https://edm.contentup.cc/api/creem/webhook`），无需新 endpoint。

## 2. Dodo Payments

**测试模式**（本地 / Preview，`DODO_PAYMENTS_ENVIRONMENT=test_mode`）：

1. 创建 Team 月付、年付商品（同上价或测试价）。
2. 写入 Preview/本地 env：`DODO_EDM_TEAM_MONTHLY_PRODUCT_ID`、`DODO_EDM_TEAM_YEARLY_PRODUCT_ID`。

**正式模式**（Production `live_mode`）：

1. 创建正式 Team 月付、年付商品。
2. 写入 Vercel Production 上述两个变量。
3. Webhook 仍用现有 EDM endpoint（`docs/p11-webhook-dashboard-checklist.md`）。

## 3. Vercel / 本地

```sh
# 从 content-up 或 pixel-edm .env.local 同步密钥与商品 ID（Team 优先读 pixel-edm 的 CREEM_EDM_TEAM_*）
./scripts/sync-vercel-billing-env.sh
# 同步后必须重新部署，否则运行时仍读不到新变量
npx vercel deploy --prod --yes
npm run setup:hooks   # 推送前 ci:push
```

`scripts/sync-vercel-billing-env.sh` 会映射 content-up 的 `CREEM_TEAM_*` → `CREEM_EDM_TEAM_*`；若 `pixel-edm/.env.local` 已填写 `CREEM_EDM_TEAM_*` / `DODO_EDM_TEAM_*`，脚本会覆盖写入 Vercel Production 与 Preview。

**常见错误**：把 Dodo **测试** Team id（如 `pdt_0No4ruXT…`）或 Creem **非正式** id 写入 Production，而运行时 `DODO_PAYMENTS_ENVIRONMENT=live_mode`、Creem 走正式 API → Checkout 报 `Product not found` / `does not exist`。Production 应使用 `development-checklist-p11-billing.md` 中的正式 Team id；可用 `node scripts/resolve-edm-team-product-ids.mjs production` 从 Dashboard 按名称解析最新 id。

## 4. 验收

1. **free → team**：设置页「购买团队版」→ Dodo test 或 Creem → Webhook → `edm.workspaces.plan = team`，设置页显示 25k/20 席与团队 Tab。
2. **pro → team**：先 Pro 再购 Team → plan 为 team；在 PSP 取消原 Pro 订阅（UI 有提示）。
3. **拒绝非法 Checkout**：已是 team 时 POST `plan=pro` 应 400；已是 pro 时 POST `plan=pro` 应 400。

```sh
npm test -- tests/billing-checkout-plan.test.mjs tests/billing-plan-sync.test.mjs
```

## 5. 非本批范围

- 支付侧「Pro 订阅换档为 Team」单订阅 morph（当前为新建 Team 订阅 + 人工取消 Pro）。
- 超过 20 席的 **席位加购 SKU**（P12 文档待接）。
