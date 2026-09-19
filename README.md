# 卖家邮局 · pixel-edm

基于交互原型构建的邮件营销管理应用。第一批已实现工程基础、真实 Auth 接入、EDM 用户和工作区数据库、七页应用外壳及基础设置。

进度更新：2026-09-18，P1 至 P5 已完成工程交付；P6-0 至 P6-3 已完成工程实现，P6-4 已完成审计与自动化验收，生产双账号邀请接受的人工验收待完成。P4-2 的 DirectMail 真实测试信及 P4-3 正式活动发送已通过验收；P5 已完成真实投递回执、公开退订、工作区抑制、行为追踪和活动统计闭环验收。用户已实际验证 Google 登录与邮箱重置。

## 正式部署

- 站点：[卖家邮局](https://edm.contentup.cc)。
- Vercel 项目：`pixel-edm`，已完成首次生产部署和正式域名绑定。
- Cloudflare：`edm` 的 CNAME 指向 `0ad5ec7ada8335ab.vercel-dns-017.com`，采用仅 DNS 模式。
- Production 和 Preview 的 `NEXT_PUBLIC_SITE_URL` 已配置为 `https://edm.contentup.cc`；本地继续使用本地 origin。
- Supabase 连接使用 content-up 的项目地址和公开客户端密钥；不在文档记录密钥值。

## 本地启动

需要 Node.js 22 以上，建议使用 24。

```sh
npm ci
npm run dev
```

将 `.env.example` 中的字段配置到 `.env.local`。本机已配置 content-up 的公开连接信息，文件被 Git 忽略。浏览器打开 [本地邮局](http://localhost:3105)。采用 3105 端口，以避开现有应用使用的 3000 和 3001。

环境变量：

- `NEXT_PUBLIC_SUPABASE_URL`：Supabase 项目地址。
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`：公开客户端密钥；不使用 service role。
- `NEXT_PUBLIC_SITE_URL`：本站完整 origin，本地为 `http://localhost:3105`。
- `EDM_CREDENTIAL_KEYRING`：服务端与 Supabase Edge Function 共用的 AES-256-GCM 密钥环，只能保存为 Secret，不能使用 `NEXT_PUBLIC_` 前缀。
- `EDM_UNSUBSCRIBE_KEYRING`：Supabase Edge Functions 专用的 HMAC-SHA256 退订签名密钥环，与凭据加密密钥分离并支持旧密钥继续验签。
- `EDM_PUBLIC_SITE_URL`：Edge Function 生成退订链接时使用的正式站点 origin，生产为 `https://edm.contentup.cc`。

## 数据库归属与隔离

- 云端项目：content-up，引用 `gnrhyahjegvcicektebh`。
- `edm.members`：应用级用户资格和展示资料，关联共享 `auth.users`。
- `edm.workspaces`：工作区、所有者、初始工作区标记及联系地址。
- `edm.workspace_members`：工作区成员及角色。
- `edm_private`：不暴露的内部函数。

首次登录后通过幂等 RPC 创建 EDM 用户和个人工作区。EDM 停用不会修改 AIGC 状态，也不会删除共享 Auth 账号。没有改写现有注册触发器；EDM 新注册账号仍会触发 content-up 现有资料/额度初始化。

已应用 EDM 迁移：`20260909072930_edm_foundation`、`20260910035224_edm_contacts`、`20260910081147_edm_contact_imports`、`20260910092601_p2_templates_audit`、`20260910135553_p3_campaign_foundation`、`20260910144358_p3_campaign_editor_options`、`20260910223857_p3_campaign_preview`、`20260911015336_p3_campaign_confirmation`、`20260911055101_p4_directmail_channels`、`20260911155319_p4_directmail_test_delivery`；本地文件版本均与云端记录对齐。

### 云端认证与验证记录

Auth Redirect URLs 已加入 `https://edm.contentup.cc/auth/callback`；应用的密码重置请求使用同一路径并携带 `?next=/reset-password`。用户于 2026-09-10 确认正式站点 Google 登录及邮箱重置均已验证通过。

2026-09-16 修复共享 Auth 回调回退问题：P6-3 为保留邀请登录路径曾让普通登录携带 `?next=/onboarding`，该地址未命中原有白名单，Supabase 因而回退到共享 Site URL `https://contentup.cc`。现在普通登录和注册使用精确的 `/auth/callback`，邀请登录才携带受控的 `next`；云端新增 `https://edm.contentup.cc/auth/callback?next=/onboarding`、`https://edm.contentup.cc/auth/callback?next=/invite/*` 与 `https://edm.contentup.cc/auth/callback?next=**` 兼容旧客户端、邀请 token 和 URL 编码，Site URL 及既有 content-up/AIGC 回调保持不变。用户已在 Chrome 实测 Google 登录回到 EDM 并正常进入工作台。

共享 Site URL 保持 `https://contentup.cc`，既有回调地址保留。此次配置未修改 Google Provider、共享 Auth 触发器或 AIGC 对象。认证流程通过依据用户实测，不将其表述为自动化端到端测试。

P3-2 至 P3-4 已复核活动编辑、动态预览、确认、复制与分块导出 RPC 的最小权限：仅 `authenticated` 可执行公开包装，内部再按管理员/编辑者角色授权；`anon` 和 `aigc_api` 均不可执行，匿名 Data API 请求返回 HTTP 401 / PostgreSQL 42501。快照表不授予客户端直接读取权限，`edm_private` 不作为客户端数据接口。其他未覆盖场景见 `supabase/verification.md`。

本地回调使用 `http://localhost:3105/auth/callback`（密码重置附带 `?next=/reset-password`）；本地白名单未单独记录验收，不能由正式站点验证推断其已配置。

## 验证命令

```sh
npm run lint
npm run typecheck
npm run format:check
npm test
npm run test:e2e
npm run build
npm run db:types
```

`npm test` 在 PGlite 的 PostgreSQL 内执行同一份迁移、真实角色授权和 RLS 测试。`db:types` 从该迁移生成的数据库结构提取 EDM 表类型。

端到端测试使用本机 Chrome（CI 会安装 Chrome），独占 3100 和 54329 端口。认证协议由仅在 `tests` 中运行的模拟接口提供，业务读写使用 PGlite 的真实 RLS。测试包含登录、幂等初始化、七页导航、设置保存、查看者工作区、活动草稿管理、动态收件人计数、变量阻断、前三位合并预览、确认快照、历史查看、模板归档后的复制、CSV 编码与公式注入防护、弹层焦点、窄屏和退出，不连接云端，不代表云端邮件/Google 登录验收已完成。运行测试时不要同时构建应用。

完整本地 Supabase 需要 Docker；安装后可使用 `npx supabase start`。`supabase/config.toml` 仅用于本地，不得整份推送到 content-up。当前机器缺少 Docker，尚未完成 GoTrue/PostgREST 整套本地服务验收。

## 共享项目迁移规则

1. 每次变更前核对远端迁移历史和 AIGC 结构。EDM 迁移只维护本应用新增对象，不把远端历史当作本仓库独占。
2. 用 CLI 创建迁移文件，在本地验证后单独应用 EDM 增量；禁止远端 reset、覆盖共享 Auth 触发器、重建 AIGC 表或删除其他项目的迁移记录。
3. 工具应用迁移如生成不同时间戳，只对齐本地文件名，不修复或重写共享历史。基础迁移已完成对齐，不要再次执行。
4. 恢复时优先回退应用版本并保留数据库数据；必要时仅撤销 EDM 的 API 暴露和授权。不得用 `DROP SCHEMA CASCADE` 作为常规回滚。修复表结构应新增前向迁移。

## 当前交付边界

已完成：应用外壳、邮箱和 Google 登录代码、回调、重置密码、局部退出、EDM 初始化和停用检查、工作区选择、管理员名称/地址设置、权限测试与 CI 配置。

P2 客户管理第一部分已实现并部署：客户新增编辑、标签、搜索分页、归档恢复及工作区权限，总览展示真实未归档客户数。云端已应用 `20260910035224_edm_contacts`，逐项记录见 [客户管理交付记录](development-checklist-p2-contacts.md)。

P2 名单导入与订阅模型已实现：支持粘贴/CSV、邮箱去重、错误报告、同意证据、订阅筛选、手动退订和独立抑制；云端已应用 `20260910081147_edm_contact_imports`，详见 [名单导入交付记录](development-checklist-p2-imports.md)。

P2 模板管理与业务审计已实现并部署：支持纯文本编辑、七个变量插入与校验、可编辑预览、预览复制、模板复制归档、六套默认模板一次性初始化，以及全部 P2 业务审计和管理员日志页；云端已应用 `20260910092601_p2_templates_audit`，详见 [模板与审计交付记录](development-checklist-p2-templates-audit.md)。

P3-0 至 P3-4 已完成并部署：活动草稿、角色权限、动态名单、变量校验、前三位预览、原子确认、不可变活动与收件人快照、历史查看和安全 CSV 导出均已实现。确认冻结模板版本及合并后的主题和正文，后续客户或模板变化不影响历史结果；重复确认只返回同一快照。云端最新迁移为 `20260911015336_p3_campaign_confirmation`，逐项状态见 [P3 活动管理交付清单](development-checklist-p3-campaigns.md)。

P4 已完成工程交付并通过真实验收：首家 ESP 为阿里云 DirectMail，支持工作区级加密凭据、管理员内部测试信、正式活动持久队列、每工作区限速与日配额、明确重试、租约恢复、暂停/继续、放弃剩余任务、未知结果人工核对和脱敏审计。`send.contentup.cc` 与 `edm@send.contentup.cc` 已在阿里云侧创建；管理员已收到真实测试信，通道为 `verified`，正式活动发送链路也已完成真实验收，详见 [P4 发信闭环交付清单](development-checklist-p4-delivery.md)。

P5-1 已完成工程实现、云端部署和真实投递成功验收：接收 DirectMail 7 类 EventBridge 事件，以 RSA-SHA256 签名和每通道令牌双重鉴权，幂等写入回执并投影送达/反馈状态；投诉、退订和硬退信即时进入工作区抑制，供应商重新订阅不会自动解封。详见 [P5 回执与退订交付清单](development-checklist-p5-receipts.md)。

P5-2 已完成工程实现、生产部署和受控真实退订验收：每封正式邮件使用仅含发送任务标识的长期 HMAC 签名令牌，正文包含中英双语退订链接、工作区名称和发送时冻结的联系地址，并附带标准 `List-Unsubscribe` / `List-Unsubscribe-Post` 邮件头。页面 GET 只展示确认，确认页和 one-click POST 共用一个幂等事务；退订后立即进入工作区抑制，排队中的后续邮件在实际领取前会被跳过。真实邮箱客户端通过顶部“取消订阅”入口以 GET 打开 API 地址时，会安全跳转到确认页；两个受控地址完成确认后，云端均只产生一条退订事件，并同步形成抑制、联系人退订状态和来源任务反馈投影。严格 RFC one-click POST 的真实客户端触发及退订后的新活动排除作为扩展回归项保留，现有自动化测试已覆盖对应协议与门禁。

P5-3 已完成工程实现、生产部署和真实闭环验收：管理员可为通道配置 DirectMail 行为追踪标签，发送运行冻结追踪配置；追踪邮件使用安全 HTML、标签和 ClickTrace，退订链接不计入点击。活动列表和明细展示受理、送达、退信、投诉、退订、打开及点击统计，并支持逐收件人结果筛选。真实验收活动最终记录送达、打开、点击和退订各 1，四个状态均可在生产界面及数据库中一致核对。验收期间发现并修复 EventBridge 旧通道目标，轮换 Webhook 令牌后仅定向重放 3 条已知事件，未改动其他历史事件。

P6-0 至 P6-3 已完成并部署，P6-4 已完成审计与自动化验收，生产双账号邀请接受的人工验收待完成：新增团队邀请表和受控 RPC，支持个人工作区有效邀请后转团队、7 天一次性链接、重发/撤销/惰性过期、已验证邮箱接受、角色变更、成员软删除、重新邀请恢复、owner 转移及并发版本保护。管理员可在团队页邀请、重发、撤销、改角色、移除成员和转移 owner；编辑者与查看者只读。审计只记录工作区、成员/邀请 ID、角色和掩码邮箱，不记录令牌、正文、变量值或完整客户数据；邀请接受页为 `/invite/[token]`。云端已应用 `20260915155134_p6_team_collaboration` 和 `20260915155553_p6_team_collaboration_hardening`，详见 [P6 团队协作交付清单](development-checklist-p6-team.md)。

P8 多 ESP 支持已完成规划定稿和 P8-1 数据库去耦，P8-2 适配器层与 worker 分发已完成工程实现、等待 PR 合并后发布：第二家 ESP 选定 Amazon SES，首版只支持阿里云邮件推送和 SES 两家，同一工作区同时只有一个主发送通道，不做自动故障切换。P8-1 引入 `edm.delivery_providers` 注册表和逐厂商 `provider_config`，归一化凭据提示、退信分级、限速与发送运行冻结；云端已应用 `20260919024521_p8_delivery_provider_registry`，Advisor 无新增 P8 告警。P8-2 将适配器统一为发送、错误分类、回执解析、Webhook 验签和能力描述五件套，DirectMail 原行为平移保留兼容入口，新增 SES v2 / SigV4 发送、SNS SignatureVersion 2 与 Topic ARN 双重鉴权、订阅握手、多收件人事件拆分及硬退/软退归一化；SES 发送尝试和任务显式保存 `provider_message_id`，不借用 DirectMail EnvId。通用 worker 与测试函数按冻结 provider 分派，SES 不启用厂商列表管理并使用 `ses:no-track` 排除自建退订链接。120 项测试及 Edge/Next 类型、Lint、格式和生产构建均通过。`amazon_ses` 在 P8-3 动态配置界面完成并通过真实验收前继续保持 `enabled=false`，详见 [P8 多 ESP 支持交付清单](development-checklist-p8-multi-esp.md)。

设计依据见 `architecture-draft-v1.3.md`、`development-plan-v0.1.md`；逐项状态见 P1、P2、P3、P4、P5、P6 与 P8 交付清单；原始交互文件归档于 `references/seller-post-office-premium.html`。
