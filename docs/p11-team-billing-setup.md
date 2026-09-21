# Team 档订阅接入清单

更新日期：2026-09-21。代码路径已支持 `plan=team` Checkout 与 Webhook 同步；**需在支付平台创建商品并写入环境变量** 后才能在生产收款。

## 定价（首版，与代码 `EDM_PLAN_PRICING` 一致）

| 档位 | 月付 | 年付 |
|------|------|------|
| Team | USD 49.90 | USD 499.90 |

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
# 可选：若 content-up .env.local 已有 CREEM_TEAM_* / DODO_TEAM_*，可手动映射到 EDM 变量
npm run setup:hooks   # 推送前 ci:push
```

`scripts/sync-vercel-billing-env.sh` 在源文件存在 `CREEM_TEAM_*` / `DODO_TEAM_*` 时会尝试复制到 `CREEM_EDM_TEAM_*` / `DODO_EDM_TEAM_*`（见脚本注释）。

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
