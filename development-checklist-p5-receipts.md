# P5 回执与退订交付清单

更新日期：2026-09-13。P5-1 的事件表、状态模型、Webhook 鉴权与幂等已完成工程实现和本地验证；尚未向 content-up 应用迁移或部署 `edm-directmail-events`，因此不能标记为云端真实验收通过。P5-2 公开退订和 P5-3 回执统计界面仍待实施。

## 当前完成状态

- [x] P5-1 建立 DirectMail 回执事件表、任务状态投影和 180 天保留策略。
- [x] P5-1 支持投递成功、投递失败、FBL 投诉、供应商订阅/退订、打开和点击共 7 类事件。
- [x] P5-1 实现 EventBridge RSA-SHA256 签名、60 秒时间窗、官方证书地址白名单和工作区通道令牌双重鉴权。
- [x] P5-1 实现事件 ID 幂等、内容摘要冲突拒绝、乱序状态优先级和 30 天自动重匹配。
- [x] P5-1 实现投诉、供应商退订、无效地址和垃圾邮件反馈的即时抑制；供应商重新订阅不会自动解除抑制。
- [x] P5-1 设置页支持生成、轮换、单次展示和停用令牌，并提供 EventBridge 事件规则。
- [x] P5-1 只保存归一化安全字段和原始正文 SHA-256，不保存原始正文、IP、User-Agent 或完整点击 URL。
- [ ] P5-1 应用云端迁移、部署 Edge Function、配置 EventBridge/MNS 死信队列并完成真实回执验收。
- [ ] P5-2 公开退订入口与签名退订链接。
- [ ] P5-3 活动级送达、退信、投诉、退订和行为统计界面。

## 数据与状态模型

- `campaign_delivery_attempts.provider_event_id` 更名为 `provider_env_id`，明确保存 `SingleSendMail` 返回的 EnvId。
- `campaign_delivery_events` 以 `(channel_id, provider_event_id)` 唯一，保存归一化事件、关联结果、处理状态、匹配重试和正文摘要。
- 收件任务增加送达状态、反馈状态、Message-ID、首次打开/点击和最近事件时间；时间较旧的事件不能覆盖较新的状态，同一时间按风险优先级收敛。
- 匹配顺序为 EnvId、Message-ID、发件地址/收件地址/发送时间唯一候选；歧义事件保持待匹配，30 天后进入无法匹配状态。
- 待匹配计划为 1 分钟、5 分钟、30 分钟，之后每 6 小时；每天清理接收时间超过 180 天的事件。

## Webhook 安全与运维

- Endpoint 固定为 Supabase `edm-directmail-events`，以 `channel_id` 查询参数确定通道；函数关闭 Supabase JWT 校验，完全使用 EventBridge 签名和通道令牌鉴权。
- 证书只允许 `https://[RegionId]-eventbridge.oss-accelerate.aliyuncs.com/x509_public_certificate_*.pem`，禁止重定向并限制下载时间和大小。
- 令牌由 Next.js 服务端生成 32 字节随机值，数据库只保存 SHA-256 摘要和尾四位；轮换保留旧令牌 15 分钟，停用立即拒绝新请求。
- 断开发信凭据不会自动停用回执，以便继续接收已发送邮件的延迟事件；管理员可显式停用。
- EventBridge 应配置完整事件、指数退避和 MNS 死信队列。P5-1 不启用 HTML、点击追踪或供应商退订链接。

## 本地验证

- RSA-SHA256 测试覆盖固定头顺序、签名正文、时间窗和证书域名 SSRF 防护。
- 解析测试覆盖全部 7 类事件并确认不提取客户端 IP 和点击 URL。
- 数据库测试覆盖重复事件、同 ID 不同正文、乱序投影、硬退信、退订、投诉、重新订阅忽略、打开/点击、令牌轮换宽限和停用。
- 全量 `npm test`、`npm run lint`、`npm run typecheck`、`npm run format:check` 与 `npm run build` 必须在提交前通过。

## 云端验收待办

1. 复核远端迁移历史与 AIGC 指纹，只应用两个 P5-1 前向迁移。
2. 部署 `edm-directmail-events`，确认 `verify_jwt=false` 且函数为 Active。
3. 在设置页生成令牌；EventBridge 使用 `acs.dm`、7 类完整事件、HTTPS 目标、Token、指数退避和 MNS DLQ。
4. 用受控邮件分别验证投递成功、硬退信和退订/投诉中的可行事件；核对幂等、客户抑制、任务投影和无敏感日志。
5. 复核 Advisor、RLS/RPC 授权、AIGC 指纹、定时任务和 180 天清理任务，再标记 P5-1 云端验收通过。
