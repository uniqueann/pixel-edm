# EDM 基础迁移验证记录

基础迁移验证日期：2026-09-09。进度更新日期：2026-09-11。目标：content-up / `gnrhyahjegvcicektebh`。

- 已应用 `20260909072930_edm_foundation`。
- `edm.members`、`edm.workspaces`、`edm.workspace_members` 三表均启用 RLS。
- `aigc_api` 对 `edm` 和 `edm_private` 均无 USAGE。
- 迁移前后 AIGC 策略指纹均为 `711e26ccd601f0144a79352db2260943`。
- 迁移前后 AIGC/public 普通函数定义指纹均为 `447a03ef7a7932204ac1aac80085c0a9`。
- 未对已有用户数据执行增删改，未创建云端测试用户，未修改 Auth 触发器或全局角色。
- 安全顾问未报告 EDM 对象问题。项目已有 AIGC 无策略表、public 函数搜索路径/执行权限及 Auth 密码保护提示，均不在本次修改范围内；没有为修复这些提示改动其他应用。

顾问参考：[无策略的 RLS 表](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[函数搜索路径](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)、[匿名角色执行提权函数](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[登录角色执行提权函数](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)、[密码保护](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

## 2026-09-10 认证与部署补充

- Vercel 项目 `pixel-edm` 已完成首次生产部署，正式站点为 `https://edm.contentup.cc`；Cloudflare DNS 和正式站点环境变量已配置。
- Supabase 白名单已加入 `https://edm.contentup.cc/auth/callback`，共享 Site URL 仍为 `https://contentup.cc`，保留原有回调。
- 用户确认 Google 登录已实际验证通过。
- 用户确认邮箱重置已实际验证通过；应用请求使用 `/auth/callback?next=/reset-password`。
- 上述两项认证结果来自用户实测确认；本次仅同步文档，没有新增数据库测试、云端操作或自动化认证验收。
- 用户明确 P1 收尾只需同步文档，完成后进入 P2 客户与模板开发。

## 后续验证记录

### P2 客户管理迁移（2026-09-10）

- 已应用 `20260910035224_edm_contacts`；客户、标签与关联三表均启用 RLS。
- 本次 AIGC 策略比对使用 schemaname、tablename、policyname、qual、with_check 排序拼接；迁移前后指纹均为 `e7ae0edd202673a2e693be6b65768e0a`。计算口径与 P1 记录不同，不比较两批指纹。
- 公开密钥匿名请求 `/rest/v1/contacts` 并指定 `Accept-Profile: edm`，返回 HTTP 401 / PostgreSQL 42501（无 schema 权限），确认匿名访问被拒绝，未出现 PGRST106。
- 本地 14 项数据库测试和 2 条浏览器流程通过。云端没有写入测试客户；真实登录用户的客户 CRUD 仍需应用部署后验收。

云端 EDM Data API 暴露列表和专门的 RLS 回归、新老账号/注册验证邮件分别覆盖、共享应用端到端回归，以及多数据库连接的并发初始化/成员修改测试，尚缺独立验收记录。历史“未暴露 schema”的判断不作为当前配置结论。这些项目保留为后续相关阶段的验证事项，不阻塞本次 P1 文档收尾；PGlite 单连接测试不能替代并发事务测试。

### P2 模板与业务审计迁移（2026-09-10）

- 已应用 `20260910092601_p2_templates_audit`，新增 `edm.templates` 和 `edm.activity_logs`，两表均启用 RLS。
- 两个存量工作区各初始化六套活跃模板和一条系统日志；默认模板使用唯一稳定键，重复初始化或归档全部模板不会重建。
- `authenticated` 可直接读取模板但不能直接写入，不能直接读取审计表；`anon` 无模板 RPC 权限，登录用户无内部审计写函数权限，`aigc_api` 无新表权限。
- 本次 AIGC 结构比对包含表、字段、策略和函数，迁移前后均为 62 个组成部分，指纹均为 `0ee3d68fae1719bf8ae01ed98cebdb35`。
- 迁移后 Supabase Advisor 没有新增 EDM 安全告警或缺失外键索引；新索引尚无使用统计属于预期信息提示。现有 `aigc/public/Auth` 告警保持不变，按项目隔离约束未修改。

### P3-0 / P3-1 活动草稿基础迁移（2026-09-10）

- 仅应用新增迁移 `20260910135553_p3_campaign_foundation`，云端迁移历史与本地文件名已对齐；未重放或改写 P1、P2、AIGC 及共享项目迁移。
- 新增 `edm.campaigns`，云端为空表并启用 RLS；已核对 13 项约束、7 个索引和 1 条成员读取策略。
- `authenticated` 不能直接选择、插入、更新或删除活动表，只能执行 `list_campaigns`、`get_campaign`、`save_campaign`、`set_campaign_archived` 四个受控 RPC。
- `anon` 和 `aigc_api` 不能直接访问活动表或执行活动 RPC；`aigc_api` 对 `edm`、`edm_private` 仍无 USAGE。公开客户端匿名调用活动列表返回 HTTP 401 / PostgreSQL 42501。
- 本次 AIGC 结构比对包含 `aigc` 的表、字段、策略和函数；迁移前后均为 62 个组成部分，指纹均为 `1e4d0de887b08979e2ef6e51b40e8277`。该查询字段组合与先前批次的记录不同，只比较本次迁移前后。
- Supabase 安全 Advisor 未发现活动对象问题；性能 Advisor 仅提示五个新活动索引尚未使用，空表阶段属于预期信息。既有 `aigc/public/Auth` 告警未修改。
- 本地 34 项单元/数据库测试、4 项端到端测试，以及 lint、类型、格式和生产构建均通过；云端未创建测试活动或修改既有业务数据。

### P3-2 活动管理界面迁移（2026-09-10）

- 仅应用新增迁移 `20260910144358_p3_campaign_editor_options`，本地文件名已与云端迁移版本对齐；本次没有新增或修改表、索引、约束、策略及共享 Auth 对象。
- 新增 `get_campaign_editor_options` 受控 RPC：`edm_private` 实现为固定空搜索路径的 `SECURITY DEFINER`，`edm` 包装为 `SECURITY INVOKER`；仅 `authenticated` 可执行，`anon` 和 `aigc_api` 均不可执行。
- RPC 仅返回活动编辑表单需要的使用中模板标识、名称、分类、活动级变量键和当前工作区标签，不返回模板主题、正文或跨工作区内容；角色与工作区行为由真实迁移测试覆盖。
- `authenticated` 仍不能直接读写 `edm.campaigns`；`anon` 对 `edm` 无 USAGE，`aigc_api` 对 `edm`、`edm_private` 均无 USAGE。公开客户端匿名调用编辑选项返回 HTTP 401 / PostgreSQL 42501。
- AIGC 结构比对继续使用表、字段、策略和函数口径；迁移前后均为 62 个组成部分，指纹均为 `1e4d0de887b08979e2ef6e51b40e8277`。
- Supabase 安全与性能 Advisor 没有发现新的 EDM 问题；现有 `aigc/public/Auth` 告警和既有未使用索引提示保持不变，按项目隔离约束未修改。
- 本地 35 项单元/数据库测试、5 项端到端测试，以及 lint、类型、格式和生产构建均通过；云端未创建测试活动或修改既有业务数据。

### P3-3 动态收件人与预览迁移（2026-09-11）

- 仅应用新增迁移 `20260910223857_p3_campaign_preview`，本地文件名已与云端迁移版本对齐；未重放或改写其他项目迁移。
- 新增 `edm.get_campaign_preview` 调用者权限包装和 `edm_private.get_campaign_preview` 固定空搜索路径提权实现；仅 `authenticated` 可执行公开包装，内部实现再限定管理员和编辑者，`anon` 与 `aigc_api` 均不可执行。
- 动态筛选使用未归档、`subscribed`、无独立抑制及可选标签条件，并新增 `contacts_campaign_eligible_idx` 部分索引；排除人数按已归档、已抑制、非订阅互斥统计。
- 主题和正文的活动级变量缺失、模板归档、活动归档或非草稿状态会阻断合并样本；合格联系人按创建时间和标识稳定排序，最多返回前三位，姓名缺失时回退邮箱前缀。
- 未新增活动快照、收件人快照或持久化收件人数，也未为预览读取写审计；云端未创建测试数据或修改既有业务数据。
- 匿名 Data API 调用预览 RPC 返回 HTTP 401 / PostgreSQL 42501；`aigc_api` 对 `edm`、`edm_private` 仍无 USAGE，内部渲染与变量函数不授予客户端执行权限。
- AIGC 结构比对继续使用表、字段、策略和函数口径；迁移前后均为 62 个组成部分，指纹均为 `1e4d0de887b08979e2ef6e51b40e8277`。
- Supabase 安全 Advisor 未发现新增 EDM 问题；性能 Advisor 仅提示新部分索引尚未使用，测试数据为空时属于预期信息。现有 `aigc/public/Auth` 告警保持不变，按隔离约束未修改。
- 本地 42 项单元/数据库测试、5 项端到端测试，以及 lint、类型、格式和生产构建均通过。

### P3-4 活动确认、快照与 CSV 迁移（2026-09-11）

- 仅应用新增迁移 `20260911015336_p3_campaign_confirmation`，本地文件名已与云端迁移版本对齐；只修改 `edm` 和 `edm_private`，未重放或改写其他项目迁移。
- 新增 `edm.campaign_snapshots` 与 `edm.campaign_recipient_snapshots`；云端两表当前均为 0 行，分别冻结活动/模板/受众/确认信息和逐位合并结果。
- 两表均启用 RLS、配置管理员/编辑者读取策略和不可更新/删除触发器；`authenticated`、`anon` 与 `aigc_api` 均无直接表权限，应用只通过受控 RPC 使用快照。
- 新增确认、复制已确认活动和分块导出三组 `edm` 调用者权限包装及 `edm_private` 固定空搜索路径实现。仅 `authenticated` 可执行业务入口，内部继续校验管理员或编辑者；`anon` 与 `aigc_api` 均不可执行。
- 确认以活动行锁、模板共享锁、单次物化受众查询、唯一快照约束和状态更新构成一个事务；覆盖版本变化、变量缺失、零人、10001 人、重复点击和近并发确认。
- CSV 由服务端路由按 500 行分块读取冻结结果，固定四列并使用 UTF-8 BOM、CRLF、双引号转义和公式注入防护；导出审计按一次下载标识幂等写入，不记录邮件正文、变量值或完整客户数据。
- 匿名 Data API 调用确认 RPC 返回 HTTP 401 / PostgreSQL 42501。迁移前后按同一查询计算 AIGC 表、字段、策略和函数，共 62 个组成部分，指纹均为 `1029237874df0991da81b78cbad0027c`。
- Supabase 安全 Advisor 未发现新增 EDM 问题；性能 Advisor 仅提示三项新索引尚未使用，空表阶段属于预期信息。现有 `aigc/public/Auth` 安全提示和共享项目性能提示保持不变，按隔离约束未修改。
- 本地 49 项单元/数据库测试、5 项端到端测试，以及 lint、类型、格式和生产构建均通过；云端没有创建测试活动或修改既有业务数据。

### P4-0 / P4-1 DirectMail 通道迁移（2026-09-11）

- 仅应用新增迁移 `20260911055101_p4_directmail_channels`；只修改 `edm` 和 `edm_private`，未重放或改写其他项目迁移。
- 新增 `edm.delivery_channels` 安全摘要表和 `edm_private.delivery_channel_credentials` 加密凭据表；两表均启用 RLS，云端当前均为 0 行。
- `authenticated` 对两表均无直接读取权限，只能执行获取摘要、保存配置和断开连接三项 `edm` 调用者权限包装；内部固定空搜索路径实现继续校验工作区管理员。
- `anon` 和 `aigc_api` 均不能执行新 RPC；`aigc_api` 对 `edm`、`edm_private` 仍无 USAGE。公开返回不包含 nonce、密文或 Secret。
- 断开连接在同一事务内物理删除私密凭据并写安全审计；重复断开幂等，重新连接必须提交新凭据。
- 迁移前后按同一查询计算 AIGC 表、字段、策略和函数，共 56 个组成部分，指纹均为 `50a385c10ae2215b91ed351d4aded716`。
- Supabase 安全 Advisor 未发现新增 EDM 问题；性能 Advisor 只提示两项新通道外键索引尚未使用，空表阶段属于预期信息。共享项目既有 `aigc/public/Auth` 提示保持不变。
- 本地 60 项单元/数据库测试和 6 项端到端测试，以及 lint、类型检查和生产构建均通过；没有调用 DirectMail、修改 DNS 或创建云端测试凭据。
