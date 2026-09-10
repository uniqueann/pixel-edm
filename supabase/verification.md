# EDM 基础迁移验证记录

基础迁移验证日期：2026-09-09。进度更新日期：2026-09-10。目标：content-up / `gnrhyahjegvcicektebh`。

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
