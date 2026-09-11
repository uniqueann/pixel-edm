# P4 发信闭环交付清单

更新日期：2026-09-11。首家 ESP 已确定为阿里云邮件推送 DirectMail；当前没有可用账号和已验证发件域名，因此 P4-0 与 P4-1 先完成可安全上线的适配边界和通道配置，P4-2 才接真实验证与内部测试信。

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
- [x] 首个工作区默认预填新加坡和 `send.contentup.cc`，但不把该域名设为所有租户的数据库默认值。
- [x] 生产密钥缺失时页面仍可查看，但禁用连接入口并显示明确提示。
- [x] 界面明确说明本阶段只保存配置，不验证账号、不改 DNS、不发送邮件。

## 验证

- [x] 加密测试覆盖正确解密、密文篡改、AAD 变化、错误密钥、缺失活动密钥和错误密钥长度。
- [x] 数据库测试覆盖角色权限、跨工作区、直接表访问、凭据保留与轮换、并发版本、断开幂等、安全审计和 AIGC 隔离。
- [x] 浏览器测试覆盖管理员连接、脱敏、Secret 不回显、移动端、轮换、断开和查看者只读。
- [x] 本地 60 项单元/数据库测试和 6 条端到端测试通过；lint、类型检查和生产构建通过。
- [x] 新增迁移应用至 content-up 云端，并复核表、RPC、授权、Advisor 与 AIGC 指纹。
- [x] Vercel Production 已配置仅 Production 生效的 Secret `EDM_CREDENTIAL_KEYRING`，密钥值不可回显。
- [ ] 推送 `main` 触发生产部署，并验证设置页可使用服务端密钥环。

## 明确暂缓至 P4-2 以后

- [ ] 接入阿里云 SDK，使用真实账号验证 AccessKey、区域、发件域名和发件地址。
- [ ] 仅允许向管理员或团队成员发送内部测试邮件，并记录不含正文和凭据的测试审计。
- [ ] Cloudflare 的 `send.contentup.cc` DNS 记录按阿里云控制台实际给出的值配置，未取得账号前不猜测记录。
- [ ] 正式发送任务、worker、速率限制、重试、未知结果人工核对、回执和统计。

## 云端迁移记录

- 已向 content-up 应用 `20260911055101_p4_directmail_channels`；云端通道和私密凭据表均为空，没有写入测试凭据或业务数据。
- 两表均启用 RLS；`authenticated` 无直接表读取权限，只能执行三项受控公开 RPC；`anon` 与 `aigc_api` 无 RPC 执行权限。
- 迁移前后按同一查询计算 AIGC 表、字段、策略和函数，共 56 个组成部分，指纹均为 `50a385c10ae2215b91ed351d4aded716`。
- Supabase 安全 Advisor 未发现新增 EDM 问题；性能 Advisor 只提示两项新外键索引尚未使用，空表阶段属于预期信息。共享项目既有 `aigc`、`public` 和 Auth 提示保持不变。
