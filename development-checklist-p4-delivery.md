# P4 发信闭环交付清单

更新日期：2026-09-12。首家 ESP 为阿里云邮件推送 DirectMail；`send.contentup.cc` 已验证，实际发件人 `edm@send.contentup.cc` 已创建。P4-0 至 P4-3 工程实现和 Supabase 部署均已完成；管理员已收到测试信，通道已进入 `verified`。P4-3 正式活动发送真实验收已通过，活动入队、worker 调度和 DirectMail 受理链路正常。

## 当前完成状态

- [x] P4-0 发送边界与适配契约完成。
- [x] P4-1 工作区通道、加密凭据与设置界面完成。
- [x] P4-2 数据库、Edge Function、权限修复及 SDK 运行时兼容修复完成并已部署。
- [x] P4-2 真实测试信验收通过：管理员已收到测试信，通道已更新为 `verified`。
- [x] P4-3 正式活动发送队列、worker、限速、重试、暂停与人工核对完成并已部署。
- [x] P4-3 正式发送真实验收通过：云端 2 个发送运行均完成，3 个收件人任务均获 DirectMail 受理。
- [x] P5-1 回执事件、状态模型、Webhook 鉴权与幂等已完成本地工程实现；云端部署和真实验收待进行。
- [ ] P5-2 公开退订与 P5-3 回执统计尚未开始。
- [x] 本阶段只操作 `edm`、`edm_private`、`edm-directmail-test` 与 `edm-directmail-worker`，未修改 `aigc` 或共享 Auth 对象。

## P4-0 发送边界与适配契约

- [x] 固定 `DeliveryRequest`、`DeliveryResult`、`DeliveryAdapter` 与错误分类，不让活动流程直接依赖阿里云 SDK。
- [x] 单个请求只描述一位收件人；主题和纯文本正文必须来自 P3 已冻结的收件人快照。
- [x] DirectMail 区域限定为杭州、新加坡、美国和德国，服务端按区域映射固定 Endpoint，不接受任意 URL。
- [x] 错误分为鉴权、配置、限流、临时、永久和未知；未知结果不得自动重试。
- [x] 冻结后续状态：活动 `confirmed → queued → sending → completed / completed_with_errors / failed`；收件任务 `pending → processing → accepted / failed / skipped / unknown`。
- [x] 使用假适配器验证接受结果和未知错误，不安装阿里云 SDK、不调用 DirectMail。

## P4-1 工作区通道与加密凭据

- [x] 新增 `edm.delivery_channels`，保存每工作区一条 DirectMail 安全摘要、区域、发件身份、状态、凭据版本和乐观并发版本。
- [x] 新增 `edm_private.delivery_channel_credentials`，只保存密钥标识、12 字节随机 nonce、AES-GCM 密文和凭据版本。
- [x] AccessKey ID 与 Secret 一起使用 AES-256-GCM 加密；AAD 绑定应用、服务商、格式版本、工作区、通道和凭据版本，防止跨上下文替换密文。
- [x] 服务端从 `EDM_CREDENTIAL_KEYRING` 读取可轮换密钥环；浏览器、公开表、RPC 响应和审计均不能读取 Secret、nonce 或密文。
- [x] `get_delivery_channel` 向成员返回安全摘要，只有管理员可见 AccessKey 末四位和凭据版本。
- [x] `save_delivery_channel` 仅管理员可调用；首次连接必须提交完整凭据，元数据更新可保留凭据，凭据替换必须使用连续版本并重置验证状态。
- [x] `disconnect_delivery_channel` 仅管理员可调用；断开时物理删除私密凭据，重复断开保持幂等且不重复写审计，重新连接必须提交新凭据。
- [x] 通道表和私密凭据表均启用 RLS 且撤销客户端直接权限；`anon`、非成员、跨工作区和 `aigc_api` 均不能绕过受控 RPC。
- [x] 连接、更新、凭据轮换和断开均写业务审计；日志只记录 provider、region、sender domain、状态和是否更换凭据。

## 设置界面

- [x] 设置页展示 DirectMail 状态、区域、发件域名、发件地址、发件人、回复地址和脱敏 AccessKey。
- [x] 管理员通过移动端底部弹层连接、更新或轮换凭据；Secret 永不回填，现有凭据可留空保留。
- [x] 断开操作二次确认并明确会删除凭据；编辑者和查看者只读。
- [x] 首个工作区默认预填杭州、`send.contentup.cc` 和 `edm@send.contentup.cc`，但不把该域名设为所有租户的数据库默认值。
- [x] 生产密钥缺失时页面仍可查看，但禁用连接入口并显示明确提示。
- [x] 界面区分安全保存与测试发送；只有管理员主动点击测试按钮才调用 DirectMail。

## P4-2 通道验证与内部测试信

- [x] Edge Function 使用阿里云官方 `@alicloud/dm20151123` SDK 调用 `SingleSendMail`，固定 HTTPS、区域 Endpoint、单一收件人和纯文本测试内容。
- [x] 测试信只允许工作区管理员发起，并固定发送到当前登录账号已验证的邮箱；浏览器不能指定任意收件人。
- [x] 新增 `edm.delivery_test_attempts`，记录通道/凭据版本、状态、收件人掩码、回执掩码、错误分类和时间，不保存完整收件邮箱或邮件正文。
- [x] 准备、领取与完成分为三个原子边界；同一幂等键只创建一条记录，任务领取后不再返回凭据，未知结果禁止自动重试。
- [x] 每个通道十分钟最多开始五次测试；通道在准备与领取之间发生变化时安全失败，不使用旧配置发送。
- [x] 成功收到 DirectMail `RequestId` 和 `EnvId` 后将通道标记为已验证；鉴权、配置或永久错误标记异常，临时及未知错误不破坏既有已验证状态。
- [x] 开始与完成事件写业务审计，只记录 provider、region、版本、结果、错误分类和错误码，不记录正文、完整邮箱、完整回执或凭据。
- [x] 设置页展示测试入口、最近结果、脱敏收件人、错误码及最近验证时间；窄屏布局与原有凭据弹层保持可用。
- [x] 数据库测试覆盖幂等、重复领取、回执回写、配置竞态、查看者、跨工作区、AIGC 角色和审计脱敏；Node 与 Edge WebCrypto 交叉验证同一 AES-GCM 信封。
- [x] `20260911155319_p4_directmail_test_delivery` 已应用至 content-up；`edm-directmail-test` Edge Function v3 已部署为 Active，并在函数内部执行用户 JWT 验证。
- [x] Vercel Production 与 Supabase Edge Functions 已配置同一份 `EDM_CREDENTIAL_KEYRING`；同步前确认通道和私密凭据均为 0 行，因此安全轮换没有破坏既有密文。
- [x] 管理员已在设置页保存 DirectMail 专用 RAM AccessKey。
- [x] 修复 Edge Function 使用的 `service_role` 缺少 `edm` schema `USAGE` 的问题；仍不授予测试表或 `edm_private` 访问权。
- [x] 修复阿里云 Node.js CommonJS SDK 在 Deno/ESM 中的构造器双层 `default` 包装，以及 `Config` 实际位于 `openapi-core/dist/utils.js` 的兼容问题。
- [x] 管理员已向自己的已验证登录邮箱重新执行真实测试发送，测试信成功收到，通道进入 `verified`。

## P4-3 正式活动发送

- [x] 正式发送仅管理员可发起，必须输入完整活动名称；单活动最多 500 位冻结收件人，同一幂等键和同一活动不会重复建任务。
- [x] 自有数据库任务表采用原子领取与 90 秒租约；租约过期进入 `unknown`，禁止直接重试。
- [x] 每工作区最多每秒 5 次、上海时区每日 2000 次供应商调用；临时/限流错误最多重试 3 次，间隔为 30 秒、2 分钟、10 分钟。
- [x] 正式调用前重新检查客户邮箱、归档、订阅和抑制；不合格收件人标记为跳过。
- [x] 鉴权或通道配置错误自动暂停；管理员可暂停、继续，暂停后可输入活动名称放弃剩余待发任务。
- [x] 管理员可查看逐收件人明细，并将未知结果人工核对为已受理或失败，核对说明写入审计。
- [x] 活动页每 5 秒刷新发送进度；结束后仍可导出冻结 CSV 和复制为草稿。
- [x] `edm-directmail-worker` v2 已部署；Vault 令牌仅供 `service_role` 校验，`pg_cron` 每 10 秒触发，最近一次空队列调用 HTTP 200。
- [x] P4-3 新表启用 RLS；普通成员无直接表权限，worker RPC 仅 `service_role` 可执行，`aigc_api` 无 EDM schema 权限。
- [x] 本地 75 项全量测试、lint、类型检查和生产构建通过；部署时空队列未误发邮件，随后完成受控正式发送真实验收。
- [x] 验收时云端 2 个正式发送运行均为 `completed`，3 个收件人任务均为 `accepted`，无待处理、未知或失败任务。

## 验证

- [x] 加密测试覆盖正确解密、密文篡改、AAD 变化、错误密钥、缺失活动密钥和错误密钥长度。
- [x] 数据库测试覆盖角色权限、跨工作区、直接表访问、凭据保留与轮换、并发版本、断开幂等、安全审计和 AIGC 隔离。
- [x] 浏览器测试覆盖管理员连接、脱敏、Secret 不回显、移动端、轮换、断开和查看者只读。
- [x] 本地 75 项单元/数据库测试和 6 条端到端测试通过；lint、类型检查和生产构建通过。
- [x] 新增迁移应用至 content-up 云端，并复核表、RPC、授权、Advisor 与 AIGC 指纹。
- [x] Vercel Production 已配置仅 Production 生效的 Secret `EDM_CREDENTIAL_KEYRING`，密钥值不可回显。
- [x] 推送 `main` 后生产部署进入 Ready；正式域名 `/settings` 返回 200，设置页使用已配置的服务端密钥环。

## P5 衔接状态

- [x] DirectMail Webhook、最终送达/退信/投诉状态底座已在 P5-1 实现，详见 [P5 回执与退订交付清单](development-checklist-p5-receipts.md)。
- [ ] P5-1 云端部署与真实回执验收。
- [ ] P5-2 公开退订和 P5-3 统计界面。

## 云端迁移记录

- 已向 content-up 应用 `20260911055101_p4_directmail_channels`；云端通道和私密凭据表均为空，没有写入测试凭据或业务数据。
- 两表均启用 RLS；`authenticated` 无直接表读取权限，只能执行三项受控公开 RPC；`anon` 与 `aigc_api` 无 RPC 执行权限。
- 迁移前后按同一查询计算 AIGC 表、字段、策略和函数，共 56 个组成部分，指纹均为 `50a385c10ae2215b91ed351d4aded716`。
- Supabase 安全 Advisor 未发现新增 EDM 问题；性能 Advisor 只提示两项新外键索引尚未使用，空表阶段属于预期信息。共享项目既有 `aigc`、`public` 和 Auth 提示保持不变。
- Vercel Production 已保存不可回显的 `EDM_CREDENTIAL_KEYRING`；提交 `5775786` 的生产部署 `dpl_EqavNr2X7hR3AY2YAppRHaYyhxoE` 状态为 Ready，`https://edm.contentup.cc/settings` 返回 200。
- 已向 content-up 应用 `20260911155319_p4_directmail_test_delivery`；新测试记录表为空、启用 RLS，`authenticated` 无表权限，仅有两项管理员入口 RPC；两个 worker RPC 仅授予 `service_role`。
- `edm-directmail-test` 初始 v1 已部署；完成 worker 权限和 SDK 兼容修复后，当前 v3 为 Active。迁移前后按相同口径计算 AIGC 的 6 张表、50 个字段、5 条策略和 1 个函数，共 62 个组成部分，指纹均为 `b70351784f68989a15a09e7f76aa582e`。
- Supabase Advisor 没有新增 EDM 安全告警；两项新索引尚无使用统计符合空表预期。共享 `aigc`、`public` 和 Auth 既有提示未修改。
- 2026-09-12 已将同一份新密钥环写入 Vercel Production Secret 和 Supabase Edge Function Secret。轮换前云端 `edm.delivery_channels` 与 `edm_private.delivery_channel_credentials` 均为 0 行；密钥值未写入仓库、日志或文档，临时文件已删除。
- 首次真实测试未进入 DirectMail：Edge Function 使用 `service_role` 调用 `edm.worker_claim_delivery_test` 时缺少 `edm` schema 的 `USAGE`，因此 3 条任务停留在 `pending`。新增迁移 `20260912061206_p4_service_role_schema_usage` 补齐最小 schema 权限；3 条遗留任务已标记为基础设施配置失败并写入脱敏审计，通道保持 `configured`。
- 修复后以事务回滚方式验证 `service_role` 可领取任务并进入 `processing`，没有调用 DirectMail。云端最终 `pending=0`、`processing=0`；AIGC 迁移前后均为 62 个组成部分，本次同口径指纹均为 `72b82d88856d76859c254ad75d90b81e`。
- 权限修复后两次测试均成功领取并在约 90ms 内以 `TypeError` 结束。使用实际 `@alicloud/dm20151123@1.11.0` 包复现 `Config is not a constructor`：SDK 为 CommonJS，ESM 默认导出存在双层包装，且 `Config` 不在包主入口。新增显式构造器解包和无敏感值的结构化错误日志，实际包探针已成功构造 Client、Config、请求与 RuntimeOptions；Edge Function v3 已部署为 Active。
- SDK 兼容修复部署后，管理员重新发起真实测试发送并成功收到邮件；DirectMail 回执已由 worker 完成回写，通道状态进入 `verified`，P4-2 真实发送验收通过。
