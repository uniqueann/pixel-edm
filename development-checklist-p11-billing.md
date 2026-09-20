# P11 套餐与支付（Creem + Dodo Payments）

更新日期：2026-09-20。状态：**P11-3 已完成**；P11-4 端到端验收待做；生产 soak 暂缓。

前提：P10 套餐额度与 worker 公平调度已上线；**content-up 主站已接通 Creem / Dodo**（`public.profiles`），见 [docs/p11-payment-contentup-bridge.md](docs/p11-payment-contentup-bridge.md)。EDM 单独按 **工作区** `edm.workspaces.plan` 计费。

## 目标

- 工作区管理员在 **edm.contentup.cc** 设置页自助升级 / 管理订阅（Pro、Team）。
- 支付通道与主站一致：**Creem**、**Dodo Payments**（不做 EDM 专用 Stripe）。
- Webhook 幂等写 `edm_private` + 更新 `workspaces.plan`；不改动 `aigc`、共享 Auth、不强制改 `profiles` 结构。

## 档位与商品（待定稿）

| plan | Creem  env 示例 | Dodo env 示例 |
|------|-----------------|---------------|
| pro | `CREEM_EDM_PRO_MONTHLY_PRODUCT_ID` | `DODO_EDM_PRO_MONTHLY_PRODUCT_ID` |
| team | `CREEM_EDM_TEAM_MONTHLY_PRODUCT_ID` | `DODO_EDM_TEAM_MONTHLY_PRODUCT_ID` |

Checkout metadata 必须含：`workspaceId`、`billedPlan`、`productScope=edm`（及 `userId` 便于审计）。

## 分步交付

### P11-0 账单数据与 plan 同步（本批）

- [x] 迁移：`workspace_billing_subscriptions`（`payment_provider` creem \| dodo）、`billing_payment_events`。
- [x] `edm.sync_workspace_plan_from_payment`（service_role）。
- [x] `edm.get_workspace_billing_status`。
- [x] 测试 `tests/billing-plan-sync.test.mjs`。
- [x] content-up 应用迁移。

### P11-1 Checkout（pixel-edm Next.js）

- [x] 依赖 `@creem_io/nextjs`、`dodopayments`。
- [x] `POST /api/creem/checkout`、`POST /api/dodo/checkout`：admin + 工作区 cookie，`productScope=edm` metadata。
- [x] Vercel 配置 EDM 专用 product id 与 Creem/Dodo 密钥（见 `scripts/sync-vercel-billing-env.sh` 与 webhook 清单）。

### P11-2 Webhook（**子域独立 URL，不改 content-up**）

- [x] `POST /api/creem/webhook`、`POST /api/dodo/webhook`（`edm.contentup.cc`）。
- [x] 验签 + 仅 EDM metadata → `sync_workspace_plan_from_payment`。
- [x] Creem/Dodo Dashboard 注册 EDM 子域 URL（见 `docs/p11-webhook-dashboard-checklist.md`）。

### P11-3 设置页 UI

- [x] `BillingUpgrade`：Creem / Dodo 双通道、月付/年付、POST 至 checkout API。
- [x] 管理员展示 `get_workspace_billing_status`；支付成功回跳 toast。

### P11-4 验收

- [ ] Creem test + Dodo test_mode：Pro 升级 → P10 额度；取消 → free。
- [ ] 主站 Content.up Pro 订阅 **不会** 误改 EDM 工作区 plan（无 `workspaceId` metadata 时不调 EDM RPC）。
- [ ] `supabase/verification.md` 记录迁移与验收。

## 非范围

- EDM Stripe、SendGrid 生产开放、10×500 soak、修改 content-up 定价页逻辑（除非选 P11-2 方案 B）。

## 验证

```sh
npm test -- tests/billing-plan-sync.test.mjs
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```
