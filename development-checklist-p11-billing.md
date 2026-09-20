# P11 套餐与支付（Stripe）

更新日期：2026-09-20。状态：**P11-0 进行中**；生产 soak（10×500）暂缓，见 `supabase/verification.md`。

前提：P10 套餐额度与 worker 公平调度已上线；`edm.workspaces.plan` 仍决定 `delivery_plan_limits`；客户端仅能更新 `name` / `mailing_address`（列级 GRANT，无法直改 plan）。

## 目标

- 工作区管理员在设置页 **自助升级 / 管理订阅**（Pro、Team），支付成功后自动写入 `plan`。
- Stripe Checkout + Customer Portal；Webhook 幂等；降级/取消在订阅结束后回到 `free`。
- 不改动 `aigc`、共享 Auth；账单对象仅 `edm` / `edm_private`。

## 档位与 Stripe 映射（待定稿）

| plan | 产品 | 建议计费 | 备注 |
|------|------|----------|------|
| free | — | — | 默认，无 Stripe 订阅 |
| pro | `STRIPE_PRICE_PRO` | 月付/年付二选一（首版可只做月付） | 对应 P10 seed 额度 |
| team | `STRIPE_PRICE_TEAM` | 同上 | 对应 P10 seed 额度 |

价格数字与 Stripe Dashboard 产品创建后写入环境变量，不进仓库。

## 分步交付

### P11-0 账单数据与 plan 同步（本批）

- [x] 迁移：`edm_private.workspace_billing_subscriptions`、`edm_private.billing_stripe_events`。
- [x] `edm_private.sync_workspace_plan_from_stripe`（仅 `service_role`）：幂等事件、upsert 订阅、按状态更新 `workspaces.plan`。
- [x] `edm.get_workspace_billing_status`：管理员可读订阅摘要（无密钥、无完整 Stripe id 以外敏感字段）。
- [x] 测试 `tests/billing-plan-sync.test.mjs`。
- [ ] content-up 应用迁移（P11-0 合并后）。

### P11-1 Stripe Checkout / Portal（Next.js）

- [ ] 依赖 `stripe`；环境变量：`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_PRICE_PRO`、`STRIPE_PRICE_TEAM`、`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`。
- [ ] Server Action：`createCheckoutSession`（绑定当前工作区、`metadata.workspace_id`、admin 校验）。
- [ ] Customer Portal 会话（改卡、取消）。
- [ ] `.env.example` 与 Vercel / Supabase 文档说明（不写真实密钥）。

### P11-2 Webhook

- [ ] `POST /api/stripe/webhook`：验签、`checkout.session.completed`、`customer.subscription.updated/deleted`。
- [ ] 调 `sync_workspace_plan_from_stripe`（service role client）。
- [ ] 审计：`billing.subscription.*` metadata 脱敏。

### P11-3 设置页 UI

- [ ] 替换「联系管理员改 plan」为升级按钮与当前订阅状态。
- [ ] 帮助页简短说明计费与退订。
- [ ] 可选：升级前确认联系地址已填。

### P11-4 验收

- [ ] Stripe Test mode：Pro 升级 → 额度变 2000/10000/10；取消 → 周期末或立即回 free（与 Webhook 策略一致）。
- [ ] 直改 `workspaces.plan` 的运维 SQL 仍保留作人工补偿，与 Stripe 状态不一致时以订阅表为准排查。
- [ ] `supabase/verification.md` 记录 content-up 应用与 Test mode 验收日期。

## 非范围（本阶段）

- SendGrid 生产开放（P9-4）、生产 10×500 soak、发票/税务/多币种、按量计费。

## 验证

```sh
npm test -- tests/billing-plan-sync.test.mjs
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```
