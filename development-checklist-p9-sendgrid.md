# P9 SendGrid 接入交付清单

更新日期：2026-09-19。状态：P9-0 契约已定稿，P9-1 数据库登记已在本地与 content-up 完成。  
前提：DirectMail 生产可用；`amazon_ses` 仍可保持 `enabled=false`；SendGrid 首版 **`enabled=false` 登记**，验收后再开放。

契约细节见 [docs/sendgrid-p9-0-contract.md](docs/sendgrid-p9-0-contract.md)。

## 已确定的决策

- [x] 第三家 ESP 选定 SendGrid；与 P8 相同「多通道 + 单主通道 + 在途冻结」，不做自动切换。
- [x] 凭据：单 API Key 存入现有 AES-GCM 信封（`accessKeySecret`）；UI 首版单字段「API Key」。
- [x] 发送：Mail Send v3；匹配键 **X-Message-Id / sg_message_id**，无 EnvId。
- [x] 回执：新 Edge Function `edm-sendgrid-events`；Signed Event Webhook + 通道 token_digest。
- [x] 退订：继续 RFC 8058 自建链路；`group_resubscribe` 不解除工作区抑制。
- [x] 上线前注册表 `enabled=false`；与 SES 相同策略。

## P9-0 契约与调研

- [x] `provider_config` 形状（`api_host`: global | eu）与注册表默认值。
- [x] Event Webhook → 归一化事件映射表（见契约 §5）。
- [x] 退信分级与错误分类约定。
- [ ] SendGrid 沙箱账号实测：202 + X-Message-Id、Webhook 签名、bounce/open 样本 JSON（P9-2 前完成）。

## P9-1 数据库登记（`enabled=false`）

- [x] 迁移：`INSERT sendgrid` 至 `edm.delivery_providers`（`20260919101800_p9_sendgrid_provider_registry.sql`）。
- [x] 扩展 `edm_private.delivery_provider_config` / `delivery_tracking_configured` / `delivery_failure_class`。
- [x] PGlite：`delivery-providers.test.mjs` 登记三家、SendGrid 未开放不可 save、config 校验。
- [x] 云端应用迁移；不修改 `aigc`、共享 Auth。content-up 记录为 `20260919145034_p9_sendgrid_provider_registry`（本地文件 `20260919101800_p9_sendgrid_provider_registry.sql`）；注册表三家为 DirectMail 启用、SES/SendGrid 未启用；SendGrid `sender_alias_max_length=64`；Security Advisor 无新增 `edm` 条目。

## P9-2 适配器与回执

- [ ] `supabase/functions/_shared/providers/sendgrid/*`（send / error / event / webhook / adapter）。
- [ ] `getDeliveryAdapter` 注册 `sendgrid`。
- [ ] 新建 `edm-sendgrid-events`；worker / delivery-test 分派无需新 cron 名。
- [ ] 单元测试：请求体、事件解析、签名、错误分类（不依赖真实 API Key）。

## P9-3 配置界面

- [ ] `DeliveryProviderName`、Zod 表单、registry 文案（API Key、数据中心、Webhook 说明）。
- [ ] `channel-detail` Webhook URL 指向 `edm-sendgrid-events`。
- [ ] 帮助页增加 SendGrid 章节（仍标注「尚未开放」直至启用）。

## P9-4 验收

- [ ] 扩展多 ESP 自动化测试（SendGrid ingest 路径、软退、resubscribe ignored）。
- [ ] 人工：Domain Authentication → 测试信 → 小活动 → Event Webhook → 公开退订。
- [ ] 迁移或 SQL：`enabled=true`；更新 `supabase/verification.md`。
- [ ] DirectMail 回归抽查。

## 风险与外部依赖

- Event Webhook 须公网 HTTPS；预览/生产 URL 与 `channel_id` 固定。
- 与 DirectMail 共用发件域时，SendGrid Domain Authentication DNS 须与阿里云记录不冲突（可子域分工）。
- SendGrid 验签公钥轮换时需支持在设置中更新（P9-3/P9-2 设计时预留）。

## 验证命令

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:e2e
```
