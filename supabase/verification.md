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

云端 EDM Data API 暴露列表和专门的 RLS 回归、新老账号/注册验证邮件分别覆盖、共享应用端到端回归，以及多数据库连接的并发初始化/成员修改测试，尚缺独立验收记录。历史“未暴露 schema”的判断不作为当前配置结论。这些项目保留为后续相关阶段的验证事项，不阻塞本次 P1 文档收尾；PGlite 单连接测试不能替代并发事务测试。
