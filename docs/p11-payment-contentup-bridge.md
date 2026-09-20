# P11 支付：content-up 现状与 EDM 对接

更新日期：2026-09-20。

## content-up 已接通（主站 `https://contentup.cc`）

与 **同一 Supabase 项目** `content-up`（`gnrhyahjegvcicektebh`）共用 Auth；支付落在 **`public.profiles`（用户级）**，不是 EDM 工作区。

| 能力 | Creem | Dodo Payments |
|------|-------|----------------|
| Checkout | `POST /api/creem/checkout` | `POST /api/dodo/checkout` |
| Webhook | `POST /api/creem/webhook` | `POST /api/dodo/webhook` |
| 客户门户 | `POST /api/creem/portal` | （见 Dodo 文档 / account 流程） |
| 代码 | `content-up/lib/creem.ts`、`app/api/creem/*` | `content-up/lib/dodo.ts`、`app/api/dodo/*` |
| 依赖 | `@creem_io/nextjs` | `dodopayments` |

**数据库（已存在）：**

- `profiles`：`creem_*`、`dodo_*`、`stripe_*`、`subscription_provider`（`stripe` \| `creem` \| `dodo`）、`plan`、`subscription_status` 等。
- `public.dodo_events`：Dodo Webhook 幂等（`webhook_id` PK）。
- Creem 侧主要靠应用层处理（与 content-up README 一致）。

**Checkout metadata（现状）：** `userId`、`interval` — 升级的是 **Content.up Pro 额度**（如 `monthly_quota`），与 `edm.workspaces.plan` **无自动联动**。

**Edge Functions：** content-up 上仅有 EDM 发信相关函数，**没有** Creem/Dodo Webhook Edge；支付回调在 **content-up Vercel** 路由。

## EDM 需要的东西（`https://edm.contentup.cc`）

- 计费主体：**工作区** `edm.workspaces.plan` → `edm.delivery_plan_limits`（free / pro / team）。
- P11-0 在 `edm_private` 存 **工作区订阅事实**，RPC `edm.sync_workspace_plan_from_payment` 供 Webhook（service_role）幂等写 plan。
- **不复用** `profiles.plan` 作为 EDM 额度来源（团队工作区、Team 档与主站 Pro 产品不同）。

## 推荐对接方式（与主站并存）

1. **独立 EDM 商品**：在 Creem / Dodo 各建 EDM Pro（及可选 Team）product id，环境变量挂在 **pixel-edm Vercel**（命名可与 content-up 对齐，如 `CREEM_EDM_PRO_MONTHLY_PRODUCT_ID`）。
2. **Checkout metadata 扩展**：除 `userId` 外增加 `workspaceId`、`billedPlan`（`pro` \| `team`）、`productScope=edm`。
3. **Webhook 落库**（二选一，推荐 A）：
   - **A.** `edm.contentup.cc` 下 `/api/creem/webhook`、`/api/dodo/webhook`，验签后调 `edm.sync_workspace_plan_from_payment`（与 content-up 路由分离，Dashboard 各配一条 URL）。
   - **B.** 在 content-up 现有 webhook  handler 中识别 `productScope=edm`，用 service role 调同一 RPC（少配 URL，但改动 `content-up` 仓库，需兼容主站逻辑）。
4. **UI**：设置页双通道选择（可复用 content-up `PaymentMethodChoice` 交互），表单 POST 到 EDM 的 checkout 路由。

## 参考文件（content-up 仓库）

- `supabase/creem_subscription_patch.sql`、`supabase/dodo_subscription_patch.sql`、`supabase/dodo_events.sql`
- `docs/VERCEL-DEPLOY.md` § Creem / Dodo 环境变量与 webhook URL
- `scripts/verify-creem-billing-flow.mjs`、`scripts/verify-dodo-billing-flow.mjs`

## 明确不做

- 在 pixel-edm 再接入 Stripe 作为 EDM 主通道（主站 profiles 仍可有 stripe，与 EDM 无关）。
- 修改 `aigc`、共享 Auth 触发器或 `profiles` 表结构（除非用户明确要求统一账单表）。
