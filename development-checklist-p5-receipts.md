# P5 回执与退订交付清单

更新日期：2026-09-13。P5-1 的事件表、状态模型、Webhook 鉴权与幂等已完成工程实现、本地验证和云端真实投递成功验收；content-up 数据库迁移、`edm-directmail-events`、正式发送 Worker、EventBridge、MNS 死信队列和生产前端均已部署。P5-2 公开退订和 P5-3 回执统计界面仍待实施。

## 当前完成状态

- [x] P5-1 建立 DirectMail 回执事件表、任务状态投影和 180 天保留策略。
- [x] P5-1 支持投递成功、投递失败、FBL 投诉、供应商订阅/退订、打开和点击共 7 类事件。
- [x] P5-1 实现 EventBridge RSA-SHA256 签名、60 秒时间窗、官方证书地址白名单和工作区通道令牌双重鉴权。
- [x] P5-1 实现事件 ID 幂等、内容摘要冲突拒绝、乱序状态优先级和 30 天自动重匹配。
- [x] P5-1 实现投诉、供应商退订、无效地址和垃圾邮件反馈的即时抑制；供应商重新订阅不会自动解除抑制。
- [x] P5-1 设置页支持生成、轮换、单次展示和停用令牌，并提供 EventBridge 事件规则。
- [x] P5-1 只保存归一化安全字段和原始正文 SHA-256，不保存原始正文、IP、User-Agent 或完整点击 URL。
- [x] P5-1 已向 content-up 应用云端迁移并部署 `edm-directmail-events` 与正式发送 Worker Edge Function。
- [x] P5-1 已配置 EventBridge/MNS 死信队列并完成真实投递成功回执验收。
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
- 待签字符串兼容阿里云文档与官方 Java 参考实现的差异，包括正文末尾换行、可选 Token 是否参与签名，以及 Supabase 网关前后的规范 Endpoint；每个候选仍必须通过同一官方证书 RSA-SHA256 校验。
- 令牌由 Next.js 服务端生成 32 字节随机值，数据库只保存 SHA-256 摘要和尾四位；轮换保留旧令牌 15 分钟，停用立即拒绝新请求。
- 断开发信凭据不会自动停用回执，以便继续接收已发送邮件的延迟事件；管理员可显式停用。
- EventBridge 使用 `acs.dm`、7 类完整事件、HTTPS 公网目标、指数退避和 MNS 死信队列；邮件推送产品侧“事件分发”已开启。P5-1 不启用 HTML、点击追踪或供应商退订链接。
- DirectMail 事件缺失 CloudEvents `id` 时，以原始正文 SHA-256 生成稳定幂等键；真实载荷中的数字状态码会规范化为字符串后进入状态模型。

## 本地验证

- RSA-SHA256 测试覆盖固定头顺序、签名正文、时间窗和证书域名 SSRF 防护。
- 解析测试覆盖全部 7 类事件、真实投递成功载荷、缺失事件标识和数字状态码，并确认不提取客户端 IP 和点击 URL。
- 数据库测试覆盖重复事件、同 ID 不同正文、乱序投影、硬退信、退订、投诉、重新订阅忽略、打开/点击、令牌轮换宽限和停用。
- 本次云端修复后 `npm test` 共 79 项通过，`npm run lint` 和 `npm run typecheck` 通过；提交前继续执行格式与构建检查。

## 云端验收记录

1. [x] 已复核远端迁移历史与 AIGC 基线；已应用事件、定时任务和外键索引三个 P5-1 前向迁移，未修改共享迁移历史。
2. [x] 已部署 `edm-directmail-events` v4 和 `edm-directmail-worker` v3，均为 Active；Webhook 保持 `verify_jwt=false` 并执行自有双重鉴权。生产前端提交 `96c93b4` 的 Vercel 部署为 Ready。
3. [x] Webhook 令牌已安全轮换到 v2，数据库只保留摘要和尾四位；EventBridge 规则 `pixel-edm-p51-directmail-receipts` 使用 `acs.dm`、7 类完整事件、HTTPS 目标、Token、指数退避和 MNS DLQ。
4. [x] MNS 普通队列 `pixel-edm-p51-eventbridge-dlq` 保存 7 天；真实验收结束时可见消息和定时中消息均为 0。
5. [x] 第 4 次受控邮件的发送任务 `9f011a6e-6029-4612-9c73-554d3ca04c4d` 于 11:19:05 接受，DirectMail 于 11:19:09 产生事件 `eb5f24cb-d88b-4241-87d3-6141ca199e88`，EventBridge 首次投递返回 200；11:19:14 入库后按 EnvId 精确匹配并投影为 `delivered`。
6. [x] 第 3 次验收事件 `b9e70b9a-721a-4051-91e7-b9428665fb55` 曾因待签字符串兼容问题返回 401；修复上线后由 EventBridge 自动重试，于 11:21:42 回灌并投影为 `delivered`，证明失败重试链路有效且未进入 DLQ。
7. [x] 云端真实验收确认两条事件均为 `applied`、`match_attempts=1`，事件与任务的 EnvId、Message-ID 一致；本地数据库测试继续覆盖重复事件幂等、乱序状态、硬退信、投诉、供应商退订和抑制优先级。
8. [x] 最终复核确认事件表和令牌表均启用 RLS，10 秒发送 Worker、1 分钟回执重匹配和每日 180 天保留任务均为 Active；Advisor 没有新增 EDM 安全或外键告警，已有告警只涉及共享 `public`/`aigc` 基线和新建索引尚未产生使用统计。
9. [ ] 不主动向外部地址制造硬退信、投诉或供应商退订；这些负向状态由自动化测试覆盖，P5-2 上线公开退订入口后再做受控真实退订验收。
