# P11 套餐与支付（Creem + Dodo Payments）

更新日期：2026-09-21。状态：**P11-0 至 P11-3 已完成**；Dodo 测试模式支付已由用户验证通过，Dodo 正式资源、Vercel Production 配置和重新部署已完成；P11-4 的正式支付闭环及 Creem 端到端验收仍待做，生产 soak 暂缓。

前提：P10 套餐额度与 worker 公平调度已上线；**content-up 主站已接通 Creem / Dodo**（`public.profiles`），见 [docs/p11-payment-contentup-bridge.md](docs/p11-payment-contentup-bridge.md)。EDM 单独按 **工作区** `edm.workspaces.plan` 计费。

## 目标

- 工作区管理员在 **edm.contentup.cc** 设置页自助升级 / 管理订阅（Pro、Team）。
- 支付通道与主站一致：**Creem**、**Dodo Payments**（不做 EDM 专用 Stripe）。
- Webhook 幂等写 `edm_private` + 更新 `workspaces.plan`；不改动 `aigc`、共享 Auth、不强制改 `profiles` 结构。

## 档位与商品（首版已定稿）

| plan | 周期 | 价格 | Creem env 示例 | Dodo env 示例 |
|------|------|------|----------------|---------------|
| pro | 月付 | USD 9.90/月 | `CREEM_EDM_PRO_MONTHLY_PRODUCT_ID` | `DODO_EDM_PRO_MONTHLY_PRODUCT_ID` |
| pro | 年付 | USD 99.90/年 | `CREEM_EDM_PRO_YEARLY_PRODUCT_ID` | `DODO_EDM_PRO_YEARLY_PRODUCT_ID` |
| team | 后续开放 | — | `CREEM_EDM_TEAM_*`（预留） | `DODO_EDM_TEAM_*`（预留） |

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
- [x] Dodo 正式环境已切换为 `live_mode`；正式月付/年付商品 ID 已写入 Vercel Production。

### P11-2 Webhook（**子域独立 URL，不改 content-up**）

- [x] `POST /api/creem/webhook`、`POST /api/dodo/webhook`（`edm.contentup.cc`）。
- [x] 验签 + 仅 EDM metadata → `sync_workspace_plan_from_payment`。
- [x] Creem/Dodo Dashboard 注册 EDM 子域 URL（见 `docs/p11-webhook-dashboard-checklist.md`）。
- [x] Dodo 正式 Webhook 已创建并指向 `https://edm.contentup.cc/api/dodo/webhook`；正式独立 Webhook Key 已写入 Vercel Production。

### P11-3 设置页 UI

- [x] `BillingUpgrade`：Creem / Dodo 双通道、月付/年付、POST 至 checkout API。
- [x] 管理员展示 `get_workspace_billing_status`；支付成功回跳 toast。

### P11-4 验收

- [x] Dodo test_mode：用户已验证 Pro Checkout 流程可用。
- [ ] Dodo live_mode：正式 Pro 支付、Webhook 回调和 `edm.workspaces.plan` 更新闭环。
- [ ] Creem：Pro 升级 → P10 额度；取消 → free。
- [ ] 主站 Content.up Pro 订阅 **不会** 误改 EDM 工作区 plan（无 `workspaceId` metadata 时不调 EDM RPC）。
- [ ] `supabase/verification.md` 记录迁移与验收。

## Dodo 正式环境切换记录

- 正式月付商品：`Pixel EDM Pro Monthly`，USD 9.90/月，product id `pdt_0No2gHyLcSdQPKblHme1K`。
- 正式年付商品：`Pixel EDM Pro Yearly`，USD 99.90/年，product id `pdt_0No2gLBidluyO2XawKIW9`。
- 正式 Webhook：`https://edm.contentup.cc/api/dodo/webhook`，endpoint id `ep_3Jc1cocJXagr4mJX8AKyAXozkVn`，启用订阅和支付相关事件。
- `DODO_PAYMENTS_ENVIRONMENT=live_mode`、正式 API Key 和 EDM 专用 Webhook Key 已配置为 `pixel-edm` Vercel Production Secret；密钥明文不写入仓库或文档。
- 2026-09-21 曾出现 Dodo Checkout 的 ByteString 错误。定位为 Production 运行时读取的 Dodo 密钥配置异常；已重新写入正式 API Key/Webhook Key，并完成 Production 重新部署。代码、主站支付配置、Supabase `aigc` 和共享 Auth 未修改。
- 最新部署状态为 `READY`，部署 id：`dpl_5TcSvoMF1KbUZREHhiVKLuMeqEcc`；正式域名仍为 `https://edm.contentup.cc`。

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
