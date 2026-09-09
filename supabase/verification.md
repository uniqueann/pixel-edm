# EDM 基础迁移验证记录

日期：2026-09-09。目标：content-up / `gnrhyahjegvcicektebh`。

- 已应用 `20260909072930_edm_foundation`。
- `edm.members`、`edm.workspaces`、`edm.workspace_members` 三表均启用 RLS。
- `aigc_api` 对 `edm` 和 `edm_private` 均无 USAGE。
- 迁移前后 AIGC 策略指纹均为 `711e26ccd601f0144a79352db2260943`。
- 迁移前后 AIGC/public 普通函数定义指纹均为 `447a03ef7a7932204ac1aac80085c0a9`。
- 未对已有用户数据执行增删改，未创建云端测试用户，未修改 Auth 触发器或全局角色。
- 安全顾问未报告 EDM 对象问题。项目已有 AIGC 无策略表、public 函数搜索路径/执行权限及 Auth 密码保护提示，均不在本次修改范围内；没有为修复这些提示改动其他应用。

顾问参考：[无策略的 RLS 表](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)、[函数搜索路径](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)、[匿名角色执行提权函数](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)、[登录角色执行提权函数](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)、[密码保护](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。

尚未验收：云端 EDM Data API（未暴露 schema）、真实邮箱/Google 回调、共享应用端到端回归，以及多数据库连接的并发初始化/成员修改测试。PGlite 单连接测试不能作为并发事务测试的替代。
