# P8 多 ESP 支持交付清单

更新日期：2026-09-18。状态：规划已定稿，尚未开始工程实现。本批目标是让工作区可以选择发信服务商，而不是只能使用阿里云邮件推送。

Supabase 继续复用 content-up 项目，业务对象只落在 `edm` / `edm_private`。本批全部采用前向迁移，不改写 `aigc`、共享 Auth 触发器或既有迁移历史，也不使用 `DROP SCHEMA CASCADE` 作为回滚手段。

## 已确定的决策

- [x] 第二家 ESP 选定 Amazon SES；首版只支持阿里云邮件推送和 SES 两家。
- [x] 执行顺序确定为先完成 P8-1 数据库去耦，再执行 P7 发布验收，其余 P8 子批在 P7 之后推进。
- [x] 多通道语义确定为「一个工作区可配置多个通道，但同时只有一个主发送通道」；首版不做自动故障切换，也不做按活动选择通道。
- [x] 归一化事件词表沿用 P5 既有定义，不因新增厂商扩展枚举；厂商专有事件在适配器内映射或丢弃。
- [x] 工作区抑制始终是发送资格的唯一判据；厂商侧自有抑制名单和重新订阅事件都不得自动解除工作区抑制。

## 执行顺序与 P7 的关系

`edm.delivery_channels` 目前接近空表，把厂商专属列从共享表抬出、把死约束换成注册表，现在是一次纯前向迁移；等生产数据积累后同样的改造还要处理回填与双读写兼容。因此：

1. P8-1 数据库去耦先行，完成后 DirectMail 行为与界面保持完全不变。
2. P7 发布验收在去耦后的结构上执行一次到位，避免上线后再动通道表结构。
3. P8-2 至 P8-4 在 P7 之后推进，SES 作为第二家厂商接入并验收。

## 现状耦合盘点

去耦前需要处理的硬编码点：

| 层 | 耦合点 |
| --- | --- |
| 数据库 | `aliyun_directmail` 字面量出现 24 处，分布在 8 个迁移文件 |
| 数据库 | `edm.delivery_channels.provider` 带 `check (provider='aliyun_directmail')` |
| 数据库 | `edm.campaign_delivery_events.provider` 带同样的单值约束 |
| 数据库 | 厂商专属列直接建在共享表：`region` 四值枚举、`sender_domain`、`access_key_hint`、`tracking_tag_name` |
| 数据库 | `sender_alias` 限制 14 字符，这是 DirectMail 的发件人名称上限 |
| 数据库 | 退信分级写进 SQL：`provider_status='2'` 判硬退信、`='3'` 判投诉 |
| 数据库 | 限速写死在 `worker_claim_delivery_batch`：每工作区 5 次/秒、2000 次/日 |
| Edge Function | 4 个函数中 3 个为 DirectMail 专属，含阿里云 SDK 与 EventBridge 证书验签 |
| 前端 | `channel-settings.tsx` 有 20 处直接引用 region / sender_domain / access_key |

已经与厂商无关、本批可直接复用的部分：

- `src/features/channels/provider.ts` 已定义 `DeliveryAdapter`、`DeliveryRequest`、`DeliveryResult` 和六类 `DeliveryErrorCategory`，适配器接缝已存在。
- 回执事件已归一化：`parseDirectMailEvent` 把 `dm:Deliver:Succeed` 等映射为 `delivery_succeeded` 等中立事件类型。
- 凭据信封为 AES-256-GCM 不透明密文，换厂商只改明文 JSON 形状，不改存储结构。
- 退订使用自签 HMAC 令牌和 RFC 8058 标准邮件头，不依赖任何厂商的退订能力。
- 活动、客户、模板、收件人快照和队列状态机不感知厂商。

## 两家厂商的结构差异

| 能力 | 阿里云邮件推送 | Amazon SES |
| --- | --- | --- |
| 发送接口 | `SingleSendMail` | SES v2 `SendEmail`，SigV4 签名 |
| 凭据形状 | AccessKey ID + Secret | AWS Access Key ID + Secret Access Key |
| 区域 | 4 个固定值 | 多区域，需按 AWS 区域格式校验而非枚举 |
| 发件身份 | 验证域名并建发件地址 | 验证域名（DKIM）或验证单个地址 |
| 行为追踪 | `tagName` + `clickTrace` 参数 | Configuration Set 加事件目标 |
| 回执通道 | EventBridge HTTPS 目标 | SNS 或 EventBridge，首版用 SNS |
| 回执验签 | 阿里云 OSS 证书 RSA-SHA256 | SNS `SigningCertURL` 证书校验，需限定 amazonaws.com 主机 |
| 订阅握手 | 无 | SNS `SubscriptionConfirmation` 必须显式确认 |
| 消息标识 | `RequestId` + `EnvId` | `MessageId` |
| 退信分级 | `provider_status` 数字码 | `bounceType` 为 Permanent / Transient / Undetermined |
| 厂商自带退订 | `unSubscribeLinkType` 置 disabled | 不启用 `ListManagementOptions` |
| 单链接免追踪 | 退订链接不计入点击 | 锚标签加 `ses:no-track` 属性 |
| 初始额度 | 按账号审批 | 沙箱模式：仅可发给已验证地址，200 封/日、1 封/秒 |

## P8-0 契约定稿

- [ ] 冻结 provider 描述符结构：标识、显示名、凭据字段定义、配置字段定义、能力位、限速默认值。
- [ ] 冻结能力位清单：是否支持点击追踪、是否支持打开追踪、是否需要 HTML 正文、是否支持单链接免追踪、是否需要订阅握手。
- [ ] 冻结每家的凭据明文 JSON 形状，并确认信封上下文仍绑定工作区、通道和凭据版本。
- [ ] 冻结每家的回执匹配策略：阿里云以 `EnvId` 为主、SES 以 `MessageId` 为主；无对应标识的厂商不得回落到时间窗猜测。
- [ ] 冻结主通道切换规则：切换只影响新发起的发送运行，在途运行继续使用冻结通道。
- [ ] 记录外部等待项：SES 域名验证、DKIM 配置、沙箱升级申请，均不计入工程工时。

## P8-1 数据库去耦

先行批次。完成后 DirectMail 的界面、接口和行为必须与去耦前完全一致。

- [ ] 新增 `edm.delivery_providers` 注册表，登记 `aliyun_directmail` 与 `amazon_ses`，并以外键替换两处 `provider` 单值 check 约束。
- [ ] 通用列保留强类型：发件地址、发件人显示名、回复地址、状态、凭据版本、验证时间、错误码、追踪开关。
- [ ] 厂商专属项收入 `provider_config jsonb`，由按 provider 分派的校验函数在受控 RPC 内校验，不放宽到客户端自由写入。
- [ ] `region` 与 `tracking_tag_name` 迁入 `provider_config`；`sender_domain` 保留为可空通用列。
- [ ] 放开 `sender_alias` 的 14 字符上限，改为按 provider 校验，DirectMail 仍为 14。
- [ ] `access_key_hint` 泛化为 `credential_hint`，保留尾四位语义。
- [ ] 把 `provider_status='2'/'3'` 的退信与投诉判定移出 SQL；SQL 只接收归一化 `event_type` 和归一化退信分级（硬退 / 软退 / 未定）。
- [ ] 限速改为按 provider 读取配置，DirectMail 默认值保持 5 次/秒与 2000 次/日不变。
- [ ] 放开 `unique(workspace_id,provider)` 的单通道假设，新增主通道标识及 `workspace_id` 上的部分唯一索引，保证同时只有一个主通道。
- [ ] 发送运行冻结字段扩展为同时冻结 provider 与 channel，确保切换通道不影响在途活动。
- [ ] 现有 RPC 对外签名保持兼容；新增参数一律带默认值，旧客户端调用行为不变。
- [ ] 数据库测试补充：注册表约束、`provider_config` 逐厂商校验、主通道唯一性、归一化退信分级投影、限速按 provider 生效。
- [ ] 回归确认：DirectMail 通道配置、测试信、正式发送、回执投影与统计全部无行为变化。
- [ ] 云端应用迁移并核对 Security 与 Performance Advisor 无新增 P8 提示。

## P8-2 适配器层与 worker 分发

- [ ] 将 `DeliveryAdapter` 正式扩展为五件套：`send`、`classifyError`、`parseWebhookEvent`、`verifyWebhookSignature`、`capabilities`。
- [ ] 建立 `supabase/functions/_shared/providers/<provider>/` 目录，DirectMail 现有实现平移进去且不改行为。
- [ ] 实现 SES 适配器：SES v2 `SendEmail`、SigV4 签名、`MessageId` 回执、`bounceType` 归一化。
- [ ] `edm-directmail-worker` 改为 `edm-delivery-worker` 并按冻结的 provider 分派；过渡期保留旧函数直至队列排空。
- [ ] `edm-directmail-test` 改为 `edm-delivery-test`，测试信文案按 provider 区分但流程统一。
- [ ] 回执函数按厂商拆分：保留 `edm-directmail-events`，新增 `edm-ses-events`；两者写入同一张归一化事件表。
- [ ] `edm-ses-events` 实现 SNS 证书校验、`SubscriptionConfirmation` 握手、消息类型判别和通道令牌双重鉴权。
- [ ] SES 发送显式不启用 `ListManagementOptions`，避免与自建退订链接重复。
- [ ] SES 开启点击追踪时，退订链接锚标签加 `ses:no-track`，与 DirectMail 的退订链接免追踪行为对齐。
- [ ] 能力降级：厂商不支持的追踪能力在服务端直接拒绝，不依赖界面隐藏。

## P8-3 配置界面按 provider 动态化

- [ ] 设置页新增 provider 选择；已配置通道不允许原地改 provider，只能新增通道后切换主通道。
- [ ] 表单字段、标签、校验与帮助文案由 provider 描述符驱动生成，不再写死阿里云字段。
- [ ] 凭据输入按 provider 区分字段数量与命名，保存后只回显 `credential_hint`。
- [ ] 通道列表展示各通道 provider、状态、是否为主通道，并提供主通道切换入口。
- [ ] 向管理员展示该 provider 的能力矩阵；不支持的开关置为禁用并说明原因。
- [ ] SES 沙箱状态在界面明确提示，避免把沙箱限制误判为配置错误。
- [ ] 既有 DirectMail 通道的展示与编辑路径无可见变化。
- [ ] 编辑者与查看者仍不可查看或修改任何通道凭据。

## P8-4 多 ESP 验收

- [ ] 两家厂商各完成一次真实测试信、真实活动发送、真实回执投影和真实公开退订。
- [ ] 跨厂商隔离：两个工作区分别使用不同厂商，事件不得跨通道错配，凭据不得跨厂商复用。
- [ ] 在途冻结：活动发送中切换主通道，在途任务仍用原通道完成，新活动使用新通道。
- [ ] 退信分级：两家的硬退与软退分别正确投影，软退不得误入永久抑制。
- [ ] 能力降级：对不支持的追踪能力，界面禁用且服务端拒绝。
- [ ] 厂商侧重新订阅事件不解除工作区抑制，两家均验证。
- [ ] 审计脱敏：不记录凭据、明文令牌、完整收件人地址或完整点击链接。
- [ ] DirectMail 全链路无回归；P5 既有验收项复核通过。
- [ ] `aigc` 结构、策略与共享 Auth 触发器保持不变。

## 风险与外部依赖

- SES 新账号默认处于沙箱，仅可发送给已验证地址，额度为每日 200 封、每秒 1 封；生产权限需单独申请，属外部等待项。
- SES 域名验证与 DKIM 配置需要 DNS 记录，与既有 `send.contentup.cc` 的阿里云配置并存，须确认不冲突。
- SNS 订阅握手失败会导致回执静默丢失，需在函数中记录握手结果并在界面暴露。
- SES 无 `EnvId` 概念，匹配完全依赖 `MessageId`；若消息标识缺失，事件应保持待匹配而不是猜测归属。
- 通道切换是最容易破坏在途活动的操作，冻结逻辑必须在 P8-1 就位，而不是留到 P8-2。
- 每家厂商都有自己的抑制名单，可能出现厂商侧已抑制但工作区未抑制的情况；此时发送会被厂商拒绝，需归入 `permanent` 并写入工作区抑制。

## 验证命令

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```
