# P6 团队协作交付清单

更新日期：2026-09-16。P6-0 规则确认、P6 数据库/RPC、首版团队界面和自动化验收已完成。Supabase 继续复用 content-up 项目，业务对象只落在 `edm` / `edm_private`；本批未修改 `aigc`、共享 Auth 触发器或既有迁移历史。

## 当前完成状态

- [x] P6-0 邀请、成员生命周期、角色、移除和所有权规则已固化。
- [x] P6 数据库迁移、受控 RPC、RLS、权限和审计已完成并应用至云端。
- [x] 团队成员页和 `/invite/[token]` 邀请接受页已完成。
- [x] 本地数据库测试、类型检查、lint、格式检查和生产构建通过。
- [ ] 使用第二个真实账号在生产域名完成一次邀请链接接受的人工验收；该项需要额外已验证邮箱，不影响本批代码和数据库交付。

## 规则与状态契约

- [x] 首个有效邀请与 `personal → team` 转换在同一工作区事务内完成；校验失败不转换，转换不可回退。
- [x] 邀请状态固定为 `pending → accepted | revoked | expired`；默认 7 天，读取/接受/重发时惰性过期。
- [x] 邮箱统一使用 `lower(btrim(email))`，同工作区同邮箱只能保留一条 pending 邀请。
- [x] 服务端生成一次性随机 token，数据库只保存 SHA-256 摘要和短提示；重发立即替换旧摘要并延长 7 天。
- [x] 接受要求已登录、Auth 邮箱已验证且与邀请邮箱精确匹配；接受后立即消费 token，重复接受失败且不改变成员关系。
- [x] 已禁用 EDM 成员不能借邀请激活；被移除成员可由新邀请恢复 active 并使用新角色。
- [x] 角色固定为 `admin`、`editor`、`viewer`；只有活动 admin 可管理团队，owner 始终是活动 admin。
- [x] owner 不可降级或移除；所有权只能转给同工作区活动 admin，原 owner 继续保留 admin。
- [x] 成员移除采用 `status='removed'` 软删除并记录 `removed_at`；客户、模板、活动、快照、发送历史和审计不级联删除。
- [x] 所有邀请和成员变更先锁定工作区行，再锁定目标邀请/成员行；`version` 防止陈旧页面覆盖最新变更。

## 数据库与受控接口

- [x] `edm.workspace_members` 增加 `removed_at`、`updated_at`、`version`，保留既有 `status`、owner-admin 约束和 `workspace_role()`。
- [x] 新增 `edm.workspace_invitations`、pending 邮箱唯一索引、token 唯一约束、状态约束、生命周期索引和操作者外键索引。
- [x] 邀请表启用 RLS，明确 deny-all policy，并撤销 `public`、`anon`、`authenticated`、`aigc_api` 的直接表权限。
- [x] `edm_private` 实现并由 `edm` 暴露：创建、重发、撤销、接受、列表、预览、改角色、移除、转移 owner。
- [x] 公开入口仅允许 `authenticated` 执行；服务端实现固定 `search_path=''`，按工作区角色再次校验。
- [x] 创建/重发响应只向服务端动作返回必要邀请状态和一次性链接；链接不写入数据库、审计、日志或客户端持久化。
- [x] 接受邀请不会调用 EDM 个人工作区初始化流程，只创建或恢复目标工作区成员关系。
- [x] 审计覆盖工作区转换、邀请创建/重发/接受/撤销/过期、角色变更、成员移除和 owner 转移；不记录明文 token、正文、变量值或完整客户数据。

## 界面与权限

- [x] 团队页按活动成员、待处理邀请分区；管理员可邀请、重发、撤销、改角色、移除和转移 owner。
- [x] editor/viewer 只能查看成员和角色；后端 RPC 同时拒绝 viewer 越权，不能只依赖按钮隐藏。
- [x] 创建或重发后一次性显示链接；关闭后不能再次复制，重新获取必须重发并使旧链接失效。
- [x] `/invite/[token]` 校验 token 形状；未登录引导登录并通过 `next` 保留邀请地址，已登录后展示掩码邮箱与目标角色。
- [x] 接受成功后设置当前工作区 cookie 并进入 dashboard；错误信息统一，不泄漏邀请是否存在或邮箱是否注册。

## 测试与隔离验收

- [x] 首次有效邀请转换团队，失败邀请不转换，团队类型不回退。
- [x] pending 唯一、邮箱规范化、重发失效、撤销、惰性过期、重复接受和邮箱不匹配均有测试。
- [x] active 成员不可重复邀请，removed 成员可重新邀请并恢复为新角色；禁用成员不能接受邀请。
- [x] owner 保护、最后管理员保护、角色权限、转移 owner 后原 owner 保留 admin 均有测试。
- [x] 并发角色变更通过工作区锁串行化，最终仍保留活动管理员；陈旧 `version` 不可覆盖新状态。
- [x] 跨工作区成员/邀请访问、viewer 越权、直接表读取、`anon` 和 `aigc_api` 均被拒绝。
- [x] 审计脱敏验证通过：无明文 token、原始邮箱、正文或变量值。
- [x] `aigc.members` 状态及 AIGC schema 结构在测试和云端核对中保持不变。

## 云端迁移与 Advisor

- [x] 已向 content-up 应用本地迁移 `20260915153722_p6_team_collaboration.sql`；Supabase 云端记录为 `20260915155134_p6_team_collaboration`。
- [x] 已向 content-up 应用 `20260915155319_p6_team_collaboration_hardening.sql`；云端记录为 `20260915155553_p6_team_collaboration_hardening`。
- [x] 云端已核对邀请表字段、RLS、直接表权限、9 个公开 RPC、9 个私有实现和 `aigc_api` 隔离。
- [x] Security Advisor 不再报告 P6 邀请表缺少 RLS policy；剩余提示属于既有 `aigc`/`public`/Auth 配置，不在本批范围。
- [x] Performance Advisor 不再报告 P6 外键缺少 covering index；邀请表新索引暂未使用属于空表阶段信息，其他提示为既有项目索引/策略提示。

## 验证命令

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

最近一次本地全量结果：101 项测试通过，类型检查、lint、格式检查和生产构建通过。Node 对既有 `.mjs/.ts` 混用模块的 warning 不影响结果。
