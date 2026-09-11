# P4 发信闭环交付清单

更新日期：2026-09-12。首家 ESP 为阿里云邮件推送 DirectMail；`send.contentup.cc` 已验证，实际发件人 `edm@send.contentup.cc` 已创建。P4-0、P4-1 与 P4-2 工程实现和 Supabase 部署已完成，Vercel Production 与 Supabase Edge Functions 已使用同一密钥环；待在设置页保存专用 RAM AccessKey，并执行一封真实内部测试信验收。

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
- [x] `20260911155319_p4_directmail_test_delivery` 已应用至 content-up；`edm-directmail-test` Edge Function v1 已部署为 Active，并在函数内部执行用户 JWT 验证。
- [x] Vercel Production 与 Supabase Edge Functions 已配置同一份 `EDM_CREDENTIAL_KEYRING`；同步前确认通道和私密凭据均为 0 行，因此安全轮换没有破坏既有密文。
- [ ] 管理员在设置页保存 DirectMail 专用 RAM AccessKey，并向自己的已验证登录邮箱执行一封真实测试信。

## 验证

- [x] 加密测试覆盖正确解密、密文篡改、AAD 变化、错误密钥、缺失活动密钥和错误密钥长度。
- [x] 数据库测试覆盖角色权限、跨工作区、直接表访问、凭据保留与轮换、并发版本、断开幂等、安全审计和 AIGC 隔离。
- [x] 浏览器测试覆盖管理员连接、脱敏、Secret 不回显、移动端、轮换、断开和查看者只读。
- [x] 本地 67 项单元/数据库测试和 6 条端到端测试通过；lint、类型检查和生产构建通过。
- [x] 新增迁移应用至 content-up 云端，并复核表、RPC、授权、Advisor 与 AIGC 指纹。
- [x] Vercel Production 已配置仅 Production 生效的 Secret `EDM_CREDENTIAL_KEYRING`，密钥值不可回显。
- [x] 推送 `main` 后生产部署进入 Ready；正式域名 `/settings` 返回 200，设置页使用已配置的服务端密钥环。

## 明确暂缓至 P4-3 以后

- [ ] 正式发送任务、worker、速率限制、重试、未知结果人工核对、回执和统计。

## 云端迁移记录

- 已向 content-up 应用 `20260911055101_p4_directmail_channels`；云端通道和私密凭据表均为空，没有写入测试凭据或业务数据。
- 两表均启用 RLS；`authenticated` 无直接表读取权限，只能执行三项受控公开 RPC；`anon` 与 `aigc_api` 无 RPC 执行权限。
- 迁移前后按同一查询计算 AIGC 表、字段、策略和函数，共 56 个组成部分，指纹均为 `50a385c10ae2215b91ed351d4aded716`。
- Supabase 安全 Advisor 未发现新增 EDM 问题；性能 Advisor 只提示两项新外键索引尚未使用，空表阶段属于预期信息。共享项目既有 `aigc`、`public` 和 Auth 提示保持不变。
- Vercel Production 已保存不可回显的 `EDM_CREDENTIAL_KEYRING`；提交 `5775786` 的生产部署 `dpl_EqavNr2X7hR3AY2YAppRHaYyhxoE` 状态为 Ready，`https://edm.contentup.cc/settings` 返回 200。
- 已向 content-up 应用 `20260911155319_p4_directmail_test_delivery`；新测试记录表为空、启用 RLS，`authenticated` 无表权限，仅有两项管理员入口 RPC；两个 worker RPC 仅授予 `service_role`。
- `edm-directmail-test` Edge Function v1 已部署为 Active。迁移前后按相同口径计算 AIGC 的 6 张表、50 个字段、5 条策略和 1 个函数，共 62 个组成部分，指纹均为 `b70351784f68989a15a09e7f76aa582e`。
- Supabase Advisor 没有新增 EDM 安全告警；两项新索引尚无使用统计符合空表预期。共享 `aigc`、`public` 和 Auth 既有提示未修改。
- 2026-09-12 已将同一份新密钥环写入 Vercel Production Secret 和 Supabase Edge Function Secret。轮换前云端 `edm.delivery_channels` 与 `edm_private.delivery_channel_credentials` 均为 0 行；密钥值未写入仓库、日志或文档，临时文件已删除。
