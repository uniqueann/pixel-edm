# EDM 基础迁移验证记录

基础迁移验证日期：2026-09-09。进度更新日期：2026-09-13。目标：content-up / `gnrhyahjegvcicektebh`。

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

### 2026-09-16 Google 回调回退修复

- 根因：P6-3 邀请接受流程让普通登录把回调地址扩展为 `https://edm.contentup.cc/auth/callback?next=/onboarding`，该地址未命中当时的 Supabase Redirect URLs，Auth 按共享 Site URL 回退到 `https://contentup.cc`。
- 代码已调整为普通登录/注册使用精确 `/auth/callback`，只有邀请登录保留受控 `next` 参数；本地白名单同步对应路径。
- 云端仅新增 EDM 回调白名单 `https://edm.contentup.cc/auth/callback?next=/onboarding`、`https://edm.contentup.cc/auth/callback?next=/invite/*` 和 `https://edm.contentup.cc/auth/callback?next=**`，保留共享 Site URL、既有 content-up/AIGC 回调、Google Provider、Auth 触发器及 `aigc` 不变。
- 用户当前 Chrome 实测：Google 登录完成后回到 `https://edm.contentup.cc/onboarding`，随后正常进入 EDM 工作台。

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

### P4-2 DirectMail 内部测试发送迁移（2026-09-12）

- 仅应用新增迁移 `20260911155319_p4_directmail_test_delivery`；新增 `edm.delivery_test_attempts` 和测试发送 RPC，只修改 `edm`、`edm_private`。
- 测试记录表为空且启用 RLS；`authenticated` 无直接表权限，只能执行准备和读取安全摘要两项入口，worker 领取与完成仅授予 `service_role`，`anon` 与 `aigc_api` 均无权限。
- 测试收件人固定取当前管理员已验证登录邮箱，数据库仅保存掩码；审计不含完整邮箱、完整 DirectMail 回执、正文、nonce、密文或 AccessKey。
- `edm-directmail-test` Edge Function 初始 v1 已部署；函数使用 `@supabase/server` 自行验证用户 JWT，因此平台旧式 `verify_jwt` 开关关闭，业务鉴权并未关闭。后续 worker 权限和 SDK 兼容修复已随当前 v3 部署，详见下方两节。
- 迁移前后按同一查询计算 AIGC 表、字段、策略和函数，共 62 个组成部分，指纹均为 `b70351784f68989a15a09e7f76aa582e`。
- 权限核对结果：新表 RLS 已开启、0 行；`authenticated` 有 2 项入口 RPC、0 项表权限、0 项 worker 权限；`aigc_api` 对本批对象 0 项授权。
- Supabase Advisor 未发现新增 EDM 安全问题；两项新索引尚无使用统计符合空表预期，其他提示均属于共享 `aigc`、`public` 或 Auth 的既有事项。
- 本地 67 项单元/数据库测试、DirectMail 设置页端到端测试、lint、类型检查和生产构建均通过；后续 SDK 兼容修复部署后，真实邮件发送验收已通过。
- 2026-09-12 已创建 `EDM_CREDENTIAL_KEYRING` Edge Function Secret，并与 Vercel Production 使用同一份密钥环。同步前只读确认 `edm.delivery_channels` 和 `edm_private.delivery_channel_credentials` 均为 0 行；未触碰 `aigc`，密钥值未进入仓库或本文档。

### P4-2 worker schema 权限修复（2026-09-12）

- 线上首次测试产生 3 条 `pending` 记录，但没有 `started_at`、完成结果或阿里云错误。以 `service_role` 直接调用领取 RPC 复现 PostgreSQL `42501 permission denied for schema edm`，确认请求尚未到达 DirectMail，AccessKey 是否有效当时仍未被验证。
- 仅应用新增迁移 `20260912061206_p4_service_role_schema_usage`：授予 `service_role` 对 `edm` schema 的 `USAGE`，保留两项 worker RPC 的既有 `EXECUTE`；没有授予 `edm.delivery_test_attempts` 表权限，也没有授予 `edm_private` schema 权限。
- 3 条迁移前遗留 `pending` 记录统一收尾为 `failed/configuration/EDGE_WORKER_SCHEMA_PERMISSION_MISSING`，各写一条不含邮箱、凭据或正文的系统审计；通道仍为 `configured`，`last_error_code` 仍为空。
- 修复后在事务中临时恢复一条任务并以真实 `service_role` 调用领取 RPC，结果为 `claim_acquired=true`，随后回滚；没有调用 DirectMail。最终 `pending=0`、`processing=0`。
- AIGC 按表、字段、策略和函数的同一查询口径在迁移前后均为 62 个组成部分，本次记录的指纹均为 `72b82d88856d76859c254ad75d90b81e`；未修改 `aigc`、共享 Auth 或其他项目对象。
- Supabase Advisor 没有新增 EDM 安全或性能告警；显示内容仍是共享 `aigc`、`public`、Auth 的既有提示及空表阶段未使用索引。
- 本地数据库测试新增 `service_role` 真实角色边界，验证其可进入 `edm` 并执行 worker RPC，同时不能进入 `edm_private` 或直接读取测试记录表；全量 68 项测试通过。

### P4-2 阿里云 SDK Edge Runtime 兼容修复（2026-09-12）

- 权限修复后的两次真实测试均已成功领取，收件人掩码正确，并在约 90ms 内以 `unknown/TypeError` 完成；这证明数据库、凭据读取和结果回写链路已通过，失败点位于 DirectMail SDK 初始化。
- 使用实际固定版本 `@alicloud/dm20151123@1.11.0` 复现：该包是 CommonJS，ESM 加载后的 Client 构造器位于双层 `default`；`@alicloud/openapi-core@1.0.8` 主入口不导出 `Config`，原代码执行 `new $OpenApi.Config()` 会抛出 `TypeError: Config is not a constructor`。
- 适配器改为从 `openapi-core/dist/utils.js` 解析 `Config`，并对 Client、请求、Config、RetryOptions 和 RuntimeOptions 统一执行最多两层 CommonJS `default` 解包；新增不记录 AccessKey、收件邮箱或正文的结构化错误日志。
- 实际 npm 包探针已成功构造 `Client`、`Config`、`SingleSendMailRequest` 和 `RuntimeOptions`，杭州区域 Endpoint 为 `dm.aliyuncs.com`；新增 CommonJS 互操作回归测试后全量 69 项测试、lint 与格式检查通过。
- `edm-directmail-test` Edge Function v3 已成功打包并部署为 `ACTIVE`；管理员随后在设置页重新发起测试，真实测试信成功收到，DirectMail 回执完成回写，通道状态进入 `verified`。该结果依据管理员实际验收记录，不表述为自动化端到端测试。

### P4-3 正式活动发送队列（2026-09-12）

- 已应用 `20260912133156_p4_campaign_delivery_queue`、`20260912133708_p4_delivery_worker_schedule`、`20260912133814_p4_delivery_fk_indexes` 与 `20260912134602_p4_delivery_resume_finalize`；新增正式发送运行、任务和尝试三表及受控 RPC，只扩展 EDM 活动状态。
- 正式发送限制为每活动 500 位冻结收件人；管理员输入完整活动名后幂等建队列。worker 原子领取、90 秒租约、每工作区每秒 5 次和上海时区每日 2000 次限额均由数据库实现。
- 临时和限流错误按 30 秒、2 分钟、10 分钟最多重试 3 次；调用边界不明或租约过期进入 `unknown`，只能由管理员填写说明并人工核对，不自动重发。
- 通道鉴权/配置错误自动暂停；主动暂停后可继续或放弃剩余待发任务。进行中禁止变更发件身份或断开通道，暂停后允许轮换凭据并要求重新验证。
- `edm-directmail-worker` v2 已部署为 `ACTIVE`。`pg_cron` 每 10 秒通过 `pg_net` 调用；令牌随机生成并仅存 Vault，校验 RPC 只授予 `service_role`。最近一次 cron 成功、HTTP 200、空队列返回 `claimed=0`。
- 部署启用时云端三张队列表均为 0 行，确认定时任务不会在空队列下误发邮件。安全 Advisor 没有新增 EDM 告警；性能 Advisor 的五项新外键索引提示已由补充迁移消除，剩余 EDM 提示均为空表未使用索引。
- 随后由管理员完成 P4-3 正式发送真实验收。验收核对时云端累计 2 个正式发送运行，状态均为 `completed`；3 个收件人任务状态均为 `accepted`，无其他任务状态，确认活动入队、定时调度、worker 与 DirectMail 受理闭环正常。该结论不等同于最终送达，送达、退信、投诉和退订回执由 P5 实现。
- 本地 75 项全量测试、6 条端到端测试、lint、类型检查和生产构建通过；新增测试覆盖幂等、角色隔离、临时重试、暂停/继续、暂停期间任务收敛、通道变更保护、未知核对、放弃剩余任务及结束后导出/复制。

### P5-2 公开退订与抑制闭环（2026-09-13）

- 已应用 `20260913100530_p5_public_unsubscribe`；只扩展 `edm` 和 `edm_private`，新增退订事件来源任务关联、发送运行工作区名称/地址快照及两个仅授予 `service_role` 的公开退订 RPC。
- 迁移前无 `queued`、`sending` 或 `paused` 运行；迁移后历史发送运行的地址快照均非空。两个工作区中有一个当前未填写联系地址，该工作区的新正式发送会被数据库门禁拒绝，未替用户填入虚构地址。
- 页面 GET 不产生退订，确认页 Server Action 和 RFC one-click POST 共用签名校验与数据库事务；邮箱客户端将 one-click URL 当普通网页打开时，GET 会跳转到确认页而不会直接退订。请求重复、两个入口交叉提交和并发提交均由任务行锁、邮箱 advisory lock 与唯一索引收敛。
- `EDM_UNSUBSCRIBE_KEYRING` 和 `EDM_PUBLIC_SITE_URL` 已保存为 Edge Function Secrets，密钥与发信凭据密钥分离且未进入仓库。`edm-unsubscribe` v3 和 `edm-directmail-worker` v6 均为 Active。
- Vercel 生产部署为 Ready，`edm.contentup.cc` 已绑定；邮箱客户端以 GET 打开 one-click API 地址的兼容修复部署 `dpl_4T8FpYSQ9K57KT7EyFyKG4mpUVUB` 已上线。无效公开令牌返回 404，无效 Worker 调用返回 401，确认两端配置完整并仍受自身鉴权保护。
- Supabase Advisor 未新增 EDM 安全或外键告警；现有安全提示仍只涉及共享 `public`、`aigc` 和 Auth 基线，新索引未使用属于刚上线阶段的预期信息。
- 本地 86 项数据库/单元测试、8 项浏览器端到端测试、lint、类型、格式和生产构建通过。
- 用户于 2026-09-13 确认受控真实退订验收通过。客户端顶部“取消订阅”入口实际执行 GET，兼容修复后安全跳转到确认页；两个不同的工作区邮箱完成确认。脱敏云端复核显示 2 条 `public_page` 退订事件分别关联 2 个投递任务，并各自同步形成抑制记录、联系人 `unsubscribed` 状态和来源任务 `unsubscribed` 反馈投影，闭环数据一致。
- 此次真实客户端未触发标准 RFC one-click POST，且验收后尚无新建的投递任务，因此 one-click POST 和退订后新活动排除继续作为扩展真实回归项；两项已有自动化测试覆盖，不将其误记为本次真实证据。

### P8-1 发信通道多服务商去耦迁移（2026-09-19）

- 仅应用新增迁移，云端记录为 `20260919024521_p8_delivery_provider_registry`；只修改 `edm` 和 `edm_private`，未重放或改写 `aigc`、共享 Auth 及其他项目迁移。本地文件名时间戳为 `20260919021500`，与云端记录版本的差异沿用本项目既有惯例。
- 应用前核对：`edm` 与 `edm_private` 下无依赖视图或物化视图；待删除的 `region`、`tracking_tag_name`、`access_key_hint` 三列存在且 `provider_config`、`is_primary`、`failure_class` 尚未存在；五个待改约束的云端实际名称与迁移脚本一致，其中 `sender_address` 与 `sender_domain` 的联合约束在云端同样自动命名为表级 `delivery_channels_check`。
- 应用前逐一复核被 `create or replace` 覆盖的 16 个函数均取自其最后一次定义，未回退 `p4_delivery_worker_schedule`、`p4_delivery_fk_indexes`、`p4_delivery_resume_finalize`、`p5_public_unsubscribe` 与 `p5_campaign_statistics_tracking` 的既有修订。
- 数据回填核对：2 个通道与 8 条发送运行的 `region` 全部进入 `provider_config`，其中各有 1 条同时携带 `tracking_tag_name`；`credential_hint` 在改名后保留非空；两个工作区的现存通道均置为主通道，符合去耦前「每个工作区最多一个通道」的前提，主通道部分唯一索引未发生冲突。8 条回执事件均非 `delivery_failed`，因此 `failure_class` 全部保持为空。
- 注册表落库为 `aliyun_directmail`（启用，5 次/秒、2000 次/日、`Asia/Shanghai`）与 `amazon_ses`（未启用，1 次/秒、200 次/日、`UTC`）；DirectMail 限速默认值与去耦前一致。
- Security Advisor 无任何 `edm` 条目，现有提示仍只涉及共享 `aigc`、`public` 与 Auth 基线。Performance Advisor 的 `unindexed_foreign_keys`、`auth_rls_initplan` 与 `duplicate_index` 均无 `edm` 条目，确认三个新增服务商外键已被覆盖索引；仅 INFO 级 `unused_index` 新增 `delivery_channels_provider_idx`、`campaign_delivery_runs_provider_idx` 和 `campaign_delivery_events_provider_idx` 三条，属新建索引尚未使用，且为覆盖外键所必需，不予删除。
- 云端未创建测试通道、测试信或发送任务，也未修改既有业务数据；本次没有真实发送验收，SES 实际发信能力待 P8-2 适配器接入后单独验收。

### P8-4 多 ESP 验收（2026-09-19）

#### 自动化验收（本地 PGlite，129 项测试）

新增 `tests/p8-multi-esp-acceptance.test.mjs`，覆盖 P8-4 清单中可在数据库层验证的项：

- 在途冻结：主通道从 DirectMail 切到 SES 后，已在途 run 仍冻结原 `channel_id` 与 `provider`；新活动使用新主通道。
- 跨厂商隔离：错误 Webhook 令牌返回 `WEBHOOK_UNAUTHORIZED`；A 通道回执不得匹配 B 通道任务；各通道凭据独立存储。
- 退信分级：SES `soft_bounce` 不写入 `edm.suppressions`。
- 重订阅：`provider_resubscribed` 对 DirectMail 与 SES 均返回 `ignored`，不解除既有抑制。
- 能力降级：注册表关闭追踪能力时 `configure_delivery_tracking` 服务端拒绝。
- 审计脱敏：`delivery_channel.*`、`delivery_webhook.configured` 等 metadata 不含凭据或完整邮箱。
- AIGC 隔离：`aigc` schema 未被 EDM 迁移改写。

DirectMail 全链路回归由既有 `campaign-delivery`、`directmail-events`、`channels-database` 等测试共同覆盖；本次未新增数据库迁移。

#### 生产人工验收（待用户配合）

`amazon_ses` 在注册表仍为 `enabled=false`，生产用户暂不能创建 SES 通道。以下项需在 SES 沙箱/生产权限与 AWS 基础设施就绪后，由管理员在 `https://edm.contentup.cc` 逐项实测：

1. **DirectMail 回归**：测试信 → 小活动发送 → 回执投影 → 公开退订（复核 P5 项无回归）。
2. **SES 首次闭环**（先 `update delivery_providers set enabled=true where provider='amazon_ses'` 并部署，再配置 DNS/DKIM、Configuration Set、SNS Topic 与 `edm-ses-events` 订阅握手）：
   - 设置页新增 SES 通道、保存 IAM 凭据、发送测试信；
   - 确认沙箱提示可见；创建 SES 主通道或切换主通道；
   - 向已验证地址发送小活动；核对送达/退信/投诉/打开/点击回执；
   - 公开退订与 one-click 仍走自建链路，厂商 resubscribe 不解除抑制。
3. **在途冻结人工复核**：DirectMail 活动发送中切换主通道到 SES，确认在途任务仍从 DirectMail 完成、新活动走 SES。
4. **SES 生产放量前**：申请移出沙箱；确认 `send.contentup.cc` 的阿里云与 AWS DNS 记录不冲突。

人工验收通过后，再单独应用 `amazon_ses` 启用迁移并记录于本文档。

### P9-1 SendGrid 服务商登记（2026-09-19）

- 仅应用新增迁移，云端记录为 `20260919145034_p9_sendgrid_provider_registry`；只修改 `edm` 和 `edm_private`，未重放或改写 `aigc`、共享 Auth 及其他项目迁移。本地文件名时间戳为 `20260919101800`，与云端记录版本的差异沿用本项目既有惯例。
- 注册表新增 `sendgrid`（未启用，10 次/秒、100000 次/日、`UTC`，`sender_alias_max_length=64`）；`aliyun_directmail` 仍为启用，`amazon_ses` 仍为未启用。未创建 SendGrid 通道、未写入凭据或发送任务。
- 扩展 `edm_private.delivery_provider_config`（`api_host` 为 `global` | `eu`）、`delivery_tracking_configured`（SendGrid 恒为已配置追踪）与 `delivery_failure_class`（SendGrid blocked/invalid/hard 与 expired/soft 分级）；DirectMail 与 SES 分支行为与 P8-1 一致。
- Security Advisor 无任何 `edm` 条目，现有提示仍只涉及共享 `aigc`、`public` 与 Auth 基线。SendGrid 实际发信与 Event Webhook 待 P9-2 适配器与 `edm-sendgrid-events` 接入后单独验收；开放用户创建通道待 P9-4 后将 `sendgrid.enabled` 置为 `true`。

### P10 套餐发信额度（2026-09-20）

- 云端已应用 `20260920072135_20260920103000_p10_delivery_plan_limits`（表 `edm.delivery_plan_limits`、helper、`assert_campaign_recipient_limit(uuid,int)`、套餐版 `confirm_campaign` / `start_campaign_delivery` / `worker_claim_delivery_batch`、`edm.get_workspace_delivery_plan`）。首次 MCP 应用仅写入前半段 DDL，后续在同一项目内用 `execute_sql` 补全函数体，并登记 `20260920072519_p10_delivery_plan_limits_start_delivery`（runs 收件人上限约束）、`20260920072528_p10_delivery_plan_limits_start_fn`（`start_campaign_delivery` 套餐校验）；仅修改 `edm` / `edm_private`。
- 随后应用 `20260920072533_20260920120000_p10_tighten_free_plan_limits`（free 日配额 1000、2 封/s 兜底）。
- 云端 seed 核对：`free` 500/1000/2，`pro` 2000/10000/10，`team` 5000/25000/20。Security Advisor 仍无新增 `edm` 条目。

### P10 发信扛量（2026-09-20，PR #16）

- 已应用 `20260920105053_20260920183000_p10_delivery_worker_fair_claim`（公平 `ws_round` 排序、默认 batch 50/上限 100、候选扫描 500）与 `20260920105058_20260920183100_p10_delivery_worker_schedule`（`edm-delivery-worker` cron **5 seconds**）。
- 已重新部署 Edge `edm-delivery-worker`（含 `EDM_WORKER_CLAIM_LIMIT` 默认 50）。未改 Supabase 项目 Secrets 时沿用既有 `EDM_*` 环境变量。
- 生产 soak（10 户 free × 500）仍为人工验收项，见 `development-checklist-p10-delivery-scale.md`。
