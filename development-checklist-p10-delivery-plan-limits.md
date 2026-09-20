# P10 套餐发信额度（阶段一，无支付）

更新日期：2026-09-20。状态：工程实现待云端应用迁移。

## 目标

- 按 `edm.workspaces.plan`（`free` / `pro` / `team`）限制发信，配置表 `edm.delivery_plan_limits` 由 migration 维护。
- 管理员人工 `update edm.workspaces set plan=...` 即可切换档位。
- 设置页展示「当前套餐 · 今日已用 x / y」，不暴露 ESP 注册表默认限速。

## 默认档位（migration seed）

| plan | 显示名 | 单活动收件人 | 日配额 | 速率/s | 日界 |
|------|--------|--------------|--------|--------|------|
| free | Free | 500 | 1000 | 2 | Asia/Shanghai（前期默认档，低于 ESP 注册表默认） |
| pro | Pro | 2000 | 10000 | 10 | Asia/Shanghai |
| team | Team | 5000 | 25000 | 20 | Asia/Shanghai |

## 工程项

- [x] 迁移 `20260920103000_p10_delivery_plan_limits.sql`：配置表、RPC `get_workspace_delivery_plan`、confirm/start/claim  enforcement。
- [x] 设置页 `DeliveryPlanSummary`。
- [x] 测试 `tests/delivery-plan-limits.test.mjs`。
- [ ] content-up 应用迁移；Security Advisor 无新增 `edm` 问题。

## 运维：切换套餐

```sql
-- 示例：将工作区升为 pro（仅管理员在库内操作，无支付）
update edm.workspaces set plan = 'pro' where id = '<workspace_uuid>';
```

## 验证

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```
