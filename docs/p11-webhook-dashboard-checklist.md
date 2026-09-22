# EDM 子域 Webhook 登记（已完成）

完成日期：2026-09-22。主站 `contentup.cc` 的既有商品、Webhook 与密钥保持不变；EDM 已完成 Dodo 正式环境切换配置。

## 完成结果

- Creem 正式环境的 EDM 商品价格已更新：Pro 月付/年付 USD 14.90/149.90，Team 月付/年付 USD 44.90/449.90。
- Dodo Payments 测试环境已创建同名月付、年付商品，价格分别为 USD 9.90/月和 USD 99.90/年；用户已验证测试模式 Checkout。
- Dodo Payments 正式环境的 EDM 商品价格已更新：Pro 月付/年付 USD 14.90/149.90，Team 月付/年付 USD 44.90/449.90；正式商品 ID 已写入 `pixel-edm` Vercel Production。
- Creem 已新增 `Pixel EDM Production Webhook`，指向 `https://edm.contentup.cc/api/creem/webhook`，启用与主站一致的 13 个支付、订阅、退款及争议事件。
- Dodo 已新增 `Pixel EDM Test Webhook`，指向 `https://edm.contentup.cc/api/dodo/webhook`，启用 10 个订阅及支付事件。
- Dodo 正式环境已新增 EDM Webhook，指向 `https://edm.contentup.cc/api/dodo/webhook`，endpoint id 为 `ep_3Jc1cocJXagr4mJX8AKyAXozkVn`，正式独立 Webhook Key 已写入 `pixel-edm` Vercel Production。
- 4 个 EDM 商品 ID 已写入 `pixel-edm` Vercel Production 的 `CREEM_EDM_*` / `DODO_EDM_*`。
- 两个 EDM endpoint 的独立密钥已分别写入 `CREEM_WEBHOOK_SECRET` / `DODO_PAYMENTS_WEBHOOK_KEY`，未写入仓库或文档。
- `DODO_PAYMENTS_ENVIRONMENT` 已切换为 `live_mode`；正式 API Key 已配置为 Vercel Production Secret，明文不写入仓库或文档。
- Production 已重新部署并绑定 `https://edm.contentup.cc`；最新部署 id 为 `dpl_5TcSvoMF1KbUZREHhiVKLuMeqEcc`，状态 `READY`。
- 无签名探测历史结果仍为 Creem `400 Invalid signature`、Dodo `401 签名头缺失`，路由与验签均生效；正式 Dodo Checkout 的真实付款与回调验收待重新执行。

## 前置

- pixel-edm **Production** 已部署含 `/api/creem/webhook`、`/api/dodo/webhook` 的代码（合并 PR #18 后重新 deploy）。
- Vercel 项目 `pixel-edm` 已配置 `SUPABASE_SERVICE_ROLE_KEY` 与 Creem/Dodo 密钥（见 `scripts/sync-vercel-billing-env.sh`）。

## Creem

1. [x] 登录 [Creem Dashboard](https://creem.io)（与 content-up 同一商户）。
2. [x] **Products**：新建 **EDM 专用** Pro 月付、年付订阅商品，并将 product id 写入 Vercel `CREEM_EDM_*`。
3. [x] **Developers → Webhooks → Add endpoint**（已新增一条，未修改主站 URL）：
   - URL：`https://edm.contentup.cc/api/creem/webhook`
   - 事件：订阅授权 / 取消 / 过期 / 未付等（与主站 Webhook 相同事件集即可）。
4. [x] EDM endpoint 使用独立 signing secret，并已更新 pixel-edm Vercel 的 `CREEM_WEBHOOK_SECRET`；主站仍使用原 secret。

## Dodo Payments

1. [x] 测试模式创建 **EDM** Pro 月付、年付订阅商品，并将测试 product id 写入测试配置；用户已验证测试模式 Checkout。
2. [x] 正式模式创建 **EDM** Pro 月付、年付订阅商品：月付 product id `pdt_0No2gHyLcSdQPKblHme1K`，年付 product id `pdt_0No2gLBidluyO2XawKIW9`。
3. [x] 测试模式 **Webhooks → Add**（未修改主站 endpoint）：
   - URL：`https://edm.contentup.cc/api/dodo/webhook`
   - 订阅相关事件 + `payment.succeeded`（与 content-up `app/api/dodo/webhook` 一致）。
4. [x] 正式模式 **Webhooks → Add**（未修改主站 endpoint）：
   - URL：`https://edm.contentup.cc/api/dodo/webhook`
   - Endpoint id：`ep_3Jc1cocJXagr4mJX8AKyAXozkVn`
   - 启用订阅状态、支付成功/失败及过期等 10 个事件。
5. [x] EDM endpoint 使用独立 **Webhook Key**，并已更新 pixel-edm Vercel 的 `DODO_PAYMENTS_WEBHOOK_KEY`；主站 endpoint 保持原 key。
6. [x] 正式 API Key 已创建并写入 pixel-edm Vercel 的 `DODO_PAYMENTS_API_KEY`；`DODO_PAYMENTS_ENVIRONMENT=live_mode`。

## 自检

```sh
# 未带签名应返回验签失败，不应 404（2026-09-20 实测 Creem 400、Dodo 401）
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://edm.contentup.cc/api/creem/webhook
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://edm.contentup.cc/api/dodo/webhook
```

历史 Test mode 下一笔 EDM Checkout 成功后，在 Supabase SQL 查：

```sql
select plan from edm.workspaces where id = '<workspace_uuid>';
select * from edm_private.workspace_billing_subscriptions where workspace_id = '<workspace_uuid>';
```

（`edm_private` 仅 service_role / SQL Editor 可见。）

正式模式验收待办：用户重新发起一次 Dodo Pro 月付或年付付款，确认正式 Webhook 到达后 `edm.workspaces.plan` 进入 `pro`，再验证取消/过期回到 `free`；验收前不宣称 P11-4 已完成。
