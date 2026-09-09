# 卖家邮局 · pixel-edm

基于交互原型构建的邮件营销管理应用。第一批已实现工程基础、真实 Auth 接入、EDM 用户和工作区数据库、七页应用外壳及基础设置。

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

## 数据库归属与隔离

- 云端项目：content-up，引用 `gnrhyahjegvcicektebh`。
- `edm.members`：应用级用户资格和展示资料，关联共享 `auth.users`。
- `edm.workspaces`：工作区、所有者、初始工作区标记及联系地址。
- `edm.workspace_members`：工作区成员及角色。
- `edm_private`：不暴露的内部函数。

首次登录后通过幂等 RPC 创建 EDM 用户和个人工作区。EDM 停用不会修改 AIGC 状态，也不会删除共享 Auth 账号。没有改写现有注册触发器；EDM 新注册账号仍会触发 content-up 现有资料/额度初始化。

已应用迁移：`supabase/migrations/20260909072930_edm_foundation.sql`，本地文件版本已与云端记录对齐。

### 云端尚需完成的配置

1. 在 [content-up Data API 设置](https://supabase.com/dashboard/project/gnrhyahjegvcicektebh/integrations/data_api/settings) 的 Exposed schemas 加入 `edm`，保留 `public` 和 `graphql_public`。不要加入 `edm_private`，也不要把 `aigc` 加入暴露列表。
2. 在 Auth URL Configuration 保留既有站点和回调配置，并确认允许以下 EDM 回调：`http://localhost:3105/auth/callback`、`http://localhost:3105/auth/callback?next=/reset-password`。部署时另增正式站点地址。
3. 验证注册邮件、密码重置和 Google OAuth 的实际回调。当前已只读确认 Google 和邮箱登录启用、注册要求邮箱确认；未修改项目级邮件模板、Site URL 或 OAuth 配置。

当前连接工具可执行数据库迁移，但 CLI 未登录 Management API，控制台连接也未成功。因此未设置 SQL 级 PostgREST 覆盖，以免影响 Dashboard 后续管理共享项目。完成第 1 项之前，云端业务 API 会返回 `PGRST106`，登录后的初始化无法成功。

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

端到端测试使用本机 Chrome（CI 会安装 Chrome），独占 3100 和 54329 端口。认证协议由仅在 `tests` 中运行的模拟接口提供，业务读写使用 PGlite 的真实 RLS。测试包含登录、幂等初始化、七页导航、设置保存、查看者工作区、弹层焦点、窄屏和退出，不连接云端，不代表云端邮件/Google 登录验收已完成。运行测试时不要同时构建应用。

完整本地 Supabase 需要 Docker；安装后可使用 `npx supabase start`。`supabase/config.toml` 仅用于本地，不得整份推送到 content-up。当前机器缺少 Docker，尚未完成 GoTrue/PostgREST 整套本地服务验收。

## 共享项目迁移规则

1. 每次变更前核对远端迁移历史和 AIGC 结构。EDM 迁移只维护本应用新增对象，不把远端历史当作本仓库独占。
2. 用 CLI 创建迁移文件，在本地验证后单独应用 EDM 增量；禁止远端 reset、覆盖共享 Auth 触发器、重建 AIGC 表或删除其他项目的迁移记录。
3. 工具应用迁移如生成不同时间戳，只对齐本地文件名，不修复或重写共享历史。基础迁移已完成对齐，不要再次执行。
4. 恢复时优先回退应用版本并保留数据库数据；必要时仅撤销 EDM 的 API 暴露和授权。不得用 `DROP SCHEMA CASCADE` 作为常规回滚。修复表结构应新增前向迁移。

## 当前交付边界

已完成：应用外壳、邮箱和 Google 登录代码、回调、重置密码、局部退出、EDM 初始化和停用检查、工作区选择、管理员名称/地址设置、权限测试与 CI 配置。

后续批次：客户 CRUD、名单导入、六套默认模板、活动草稿和 CSV、真实 ESP、回执与退订、团队邀请及完整审计。页面对这些功能显示待接入，不展示虚构数据。

设计依据见 `architecture-draft-v1.3.md`、`development-plan-v0.1.md`；逐项状态见 `development-checklist-p1.md`；原始交互文件归档于 `references/seller-post-office-premium.html`。
