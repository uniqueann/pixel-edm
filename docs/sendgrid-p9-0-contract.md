# P9-0 SendGrid 接入契约

更新日期：2026-09-19。状态：定稿，供 P9-1～P9-4 实现对照。  
约束：仅扩展 `edm` / `edm_private`；工作区抑制仍为唯一事实来源；归一化事件词表不扩展。

## 1. 注册表（`edm.delivery_providers`）

| 字段 | 值 |
|------|-----|
| `provider` | `sendgrid` |
| `display_name` | `SendGrid` |
| `enabled` | `false`（人工验收前） |
| `sender_alias_max_length` | `64`（注册表列上限） |
| `requires_sender_domain` | `true` |
| `supports_open_tracking` / `supports_click_tracking` | `true` |
| `requires_html_for_tracking` | `true` |
| `supports_link_tracking_opt_out` | `true` |
| `requires_webhook_subscription_confirmation` | `false` |
| 默认限速 | `10`/秒，`100000`/日，`UTC` |

## 2. `provider_config` 形状

```json
{
  "api_host": "global"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `api_host` | 是（默认 `global`） | `global` → `api.sendgrid.com`；`eu` → `api.eu.sendgrid.com` |

P9-3 表单可将「数据中心」写入 `api_host`；若客户端仍提交扁平 `region`，SQL 校验层在 P9-1 仅认 `api_host`（前端后续映射）。

**行为追踪**：SendGrid 在 Mail Send JSON 的 `tracking_settings` 中开关，无 DirectMail 式标签名；`delivery_tracking_configured('sendgrid', config)` 恒为 `true`（开启追踪时不额外要求 config 字段）。

## 3. 凭据（密文信封明文 JSON）

| 字段 | 说明 |
|------|------|
| `accessKeyId` | 固定 `"sendgrid"` 或 Key 标识（仅 hint 用） |
| `accessKeySecret` | 完整 SendGrid **API Key**（`SG.xxx`） |

AAD 含 `provider: sendgrid`，与 DirectMail / SES 隔离。

## 4. 发送（Mail Send v3）

- `POST https://api.{sendgrid|eu.sendgrid}.com/v3/mail/send`
- `Authorization: Bearer <API Key>`
- 成功：**HTTP 202**，保存响应头 **`X-Message-Id`** → `provider_message_id`（任务匹配主键，与 SES 相同策略）
- `provider_request_id`：可用同一 Message-Id 或留空 Request-Id 字段（适配器定一种并保持一致）
- `provider_env_id`：SendGrid 无 EnvId，**留空**
- 自建 `List-Unsubscribe` / `List-Unsubscribe-Post` 头；**不**启用 SendGrid ASM 作为订阅事实来源
- 开启追踪时发送 HTML；对退订 URL 禁用点击追踪（P9-2 在 mail JSON 中实现，对齐 `ses:no-track` 意图）

## 5. Event Webhook → 归一化事件

入口：`edm-sendgrid-events?channel_id=<uuid>`，鉴权：现有 **channel token_digest** + SendGrid **Signed Event Webhook**（ECDSA，公钥来自 SendGrid 控制台；P9-2 可选写入通道配置或仅环境级，首版建议验签密钥随 Webhook 创建后由管理员粘贴到 `provider_config` 扩展字段，若 P9-1 未加则 P9-2 迁移补充）。

Webhook body 为 **JSON 数组**；每条事件单独 ingest（稳定 `provider_event_id`）。

### 5.1 事件映射

| SendGrid `event` | 归一化 `event_type` | 备注 |
|------------------|---------------------|------|
| `delivered` | `delivery_succeeded` | |
| `bounce` | `delivery_failed` | 见退信分级 |
| `dropped` | `delivery_failed` | 通常硬退 |
| `spamreport` | `fbl_complaint` | |
| `unsubscribe` | `provider_unsubscribed` | |
| `group_unsubscribe` | `provider_unsubscribed` | |
| `group_resubscribe` | `provider_resubscribed` | → 处理为 `ignored` |
| `open` | `opened` | |
| `click` | `clicked` | |
| `processed` | — | **丢弃**，不写入（避免与 delivered 重复） |
| `deferred` | — | 丢弃或可选 `delivery_failed` + `soft_bounce`（P9-2 定一种，默认丢弃） |

### 5.2 退信分级（适配器优先，SQL 兜底）

适配器根据 bounce 对象设置 `failure_class`：

| 条件 | `failure_class` |
|------|-----------------|
| `type=blocked` 或 reason 含 invalid | `hard_bounce` |
| `type=bounce` 且 classification 为 Invalid Address 等 | `hard_bounce` |
| `type=expired` 或软退语义 | `soft_bounce` |
| 其它 | `undetermined` |

SQL 兜底（`delivery_failure_class`）：`failure_type` 为 `blocked`/`invalid` → `hard_bounce`；`expired` → `soft_bounce`。

### 5.3 任务匹配

优先：`provider_message_id` = 事件 `sg_message_id`（或 SMTP id 解析后的稳定段）+ `recipient_email` + **`run.channel_id = event.channel_id`**。

## 6. 错误分类（HTTP / API）

| 情况 | `error_category` |
|------|------------------|
| 401 / 403 | `authentication` |
| 400 / 413 / 422 等配置错误 | `configuration` |
| 429 | `rate_limit` |
| 5xx / 网络 | `temporary` |
| 明确拒收域/地址 | `permanent` |
| 其它 | `unknown` |

## 7. 不在首版范围

- Subuser / 多 API Key 轮换 UI
- 专用 IP、发信池选择
- Marketing Campaigns API
- 自动故障切换或按活动选通道

## 8. 参考

- [Mail Send v3](https://docs.sendgrid.com/api-reference/mail-send/mail-send)
- [Event Webhook](https://docs.sendgrid.com/for-developers/tracking-events/event)
- [Signed Event Webhook](https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features)
