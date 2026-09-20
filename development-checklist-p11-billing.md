# P11 套餐与支付（Creem + Dodo Payments）

更新日期：2026-09-20。状态：**P11-0 进行中**；生产 soak（10×500）暂缓，见 `supabase/verification.md`。

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
- [ ] content-up 应用迁移（P11-0 合并后）。

### P11-1 Checkout（pixel-edm Next.js）

- [ ] 依赖对齐 content-up：`@creem_io/nextjs`、`dodopayments`（或 fetch Creem REST 与 content-up 相同）。
- [ ] `POST /api/creem/checkout`、`POST /api/dodo/checkout`：admin + 当前工作区 cookie，metadata 带 `workspaceId`。
- [ ] 环境变量与 content-up 文档对齐（可复用同一 Creem/Dodo 账号，**不同 product id**）。

### P11-2 Webhook

- [ ] `POST /api/creem/webhook`、`POST /api/dodo/webhook` on **edm.contentup.cc**（Dashboard 单独配置 URL）。
- [ ] 验签逻辑复用/移植 content-up `app/api/*/webhook/route.ts`，落库调 `sync_workspace_plan_from_payment`。
- [ ] 可选后续：content-up 主站 webhook 识别 `productScope=edm` 代调 RPC（少 URL，跨仓库）。

### P11-3 设置页 UI

- [ ] 支付方式选择（参考 content-up `PaymentMethodChoice`）。
- [ ] 展示 `get_workspace_billing_status` + `DeliveryPlanSummary` 额度。

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
