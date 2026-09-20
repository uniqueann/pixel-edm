# EDM 子域 Webhook 登记（需你在 Creem / Dodo 控制台操作）

Cloud Agent **无法登录** Creem/Dodo Dashboard，请按本清单自行点击；主站 `contentup.cc` 已有 Webhook **不要删除**。

## 前置

- pixel-edm **Production** 已部署含 `/api/creem/webhook`、`/api/dodo/webhook` 的代码（合并 PR #18 后重新 deploy）。
- Vercel 项目 `pixel-edm` 已配置 `SUPABASE_SERVICE_ROLE_KEY` 与 Creem/Dodo 密钥（见 `scripts/sync-vercel-billing-env.sh`）。

## Creem

1. 登录 [Creem Dashboard](https://creem.io)（与 content-up 同一商户即可）。
2. **Products**：新建 **EDM 专用**订阅商品（Pro 月/年；Team 可选），记下 product id → 写入 Vercel `CREEM_EDM_*`（勿长期复用 `CREEM_PRO_*`）。
3. **Developers → Webhooks → Add endpoint**（**新增一条**，不要改主站 URL）：
   - URL：`https://edm.contentup.cc/api/creem/webhook`
   - 事件：订阅授权 / 取消 / 过期 / 未付等（与主站 Webhook 相同事件集即可）。
4. 若 Creem 为 **每个 endpoint 单独 signing secret**，把 **EDM 这条** 的 secret 写入 Vercel `CREEM_WEBHOOK_SECRET`（会覆盖从主站复制的值；主站仍用原 secret 则需在 Creem 确认是否支持多 endpoint 各用各 secret）。

## Dodo Payments

1. 登录 Dodo Dashboard。
2. 创建 **EDM** 订阅商品，product id → `DODO_EDM_*` 环境变量。
3. **Webhooks → Add**：
   - URL：`https://edm.contentup.cc/api/dodo/webhook`
   - 订阅相关事件 + `payment.succeeded`（与 content-up `app/api/dodo/webhook` 一致）。
4. 若 Dodo 为每个 endpoint 提供独立 **Webhook Key**，更新 pixel-edm Vercel 的 `DODO_PAYMENTS_WEBHOOK_KEY`（主站 endpoint 保持原 key）。

## 自检

```sh
# 未带签名应 401/500，不应 404（404 表示生产未部署 billing 路由）
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://edm.contentup.cc/api/creem/webhook
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://edm.contentup.cc/api/dodo/webhook
```

Test mode 下一笔 EDM Checkout 成功后，在 Supabase SQL 查：

```sql
select plan from edm.workspaces where id = '<workspace_uuid>';
select * from edm_private.workspace_billing_subscriptions where workspace_id = '<workspace_uuid>';
```

（`edm_private` 仅 service_role / SQL Editor 可见。）
