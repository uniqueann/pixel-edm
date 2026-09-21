# P12 套餐分层（定稿）

更新日期：2026-09-21。工程：迁移 `20260921103000_*`、`20260921123000_p12_plan_feature_gates.sql`。

## 对外三档

### 个人免费版

- **有效客户**：最多 500（未归档；预置模板不占额度）
- **自定义模板**：最多新建 3 个（六套 `default_key` 预置模板不计入）
- **活动**：每月最多 **确认** 3 个（`confirm_campaign` 成功计 1 次；重复打开已确认活动不计）
- **打开/点击统计**：不含
- **操作日志**：不可查看
- **协作**：单人（1 成员），无团队邀请
- **CSV 导出**：支持（不单独限档）

### 个人专业版

- **有效客户**：最多 **5,000**；更大名单 → **团队版** 或后续「联系人 +5k/月」加购包
- **自定义模板 / 确认活动**：不限
- **打开/点击统计**：支持
- **操作日志**：近 **7** 天
- **协作**：**单人**（不写团队能力；1 成员）

### 团队版

- 包含专业版能力（名单上限 25,000 seed，可再加购扩展）
- **团队成员**：含起步席位（seed 20），超出按人数阶梯加购（支付 SKU 待接）
- **角色**：管理员 / 运营 / 查看者（`admin` / `editor` / `viewer`）
- **操作日志**：**完整**历史（`activity_log_retention_days` 为 NULL）
- 仅 **Team** 可 `create_workspace_invitation`

## 内部护栏（不对价目表主打）

- `daily_send_quota`、`max_rate_per_second`：多租户公平与滥用防护
- 单活动收件人上限与有效客户上限对齐（见 seed 表）

## 配置表字段（`edm.delivery_plan_limits`）

| plan | 客户 | 成员 | 自定义模板 | 月确认活动 | 日志天数 | 统计 |
|------|------|------|-----------|-----------|---------|------|
| free | 500 | 1 | 3 | 3 | 0（不可看） | 否 |
| pro | 5000 | 1 | ∞ | ∞ | 7 | 是 |
| team | 25000 | 20 | ∞ | ∞ | ∞ | 是 |

## Pro 多成员 · grandfather（上线策略）

定稿：**不自动踢人、不批量改历史成员状态**。

| 场景 | 行为 |
|------|------|
| `plan=pro`，配置表 `max_active_members=1` | 新 **邀请** 不可用（仅 Team 可 `create_workspace_invitation`）；**接受邀请** 仍走 `assert_workspace_member_headroom`，已有 1 名活跃成员时无法再接受 |
| 历史/SQL 造成的 Pro 工作区 **活跃成员 > 1** | **只读与既有权限继续可用**；禁止新增成员与邀请；UI 仍提示「个人版单人，协作请升级团队版」 |
| 运维 | 定期跑下方 SQL，对需协作的客户 **人工升 Team** 或沟通减员至 1 人 |

```sql
-- Pro 工作区活跃成员超过套餐配置（grandfather 名单）
select w.id, w.name, w.plan,
  count(*) filter (where wm.status = 'active') as active_members,
  dpl.max_active_members
from edm.workspaces w
join edm.delivery_plan_limits dpl on dpl.plan = w.plan
join edm.workspace_members wm on wm.workspace_id = w.id
where w.plan = 'pro'
group by w.id, w.name, w.plan, dpl.max_active_members
having count(*) filter (where wm.status = 'active') > dpl.max_active_members;
```

**content-up 生产（2026-09-21）**：上述查询 **0 行**（尚无 Pro 多成员 grandfather 个案）。

## 支付商品文案

Creem/Dodo Dashboard 描述见 [`docs/p12-billing-product-copy.md`](p12-billing-product-copy.md)。

## 运维

```sql
select edm.get_workspace_delivery_plan('{"workspace_id":"<uuid>"}'::jsonb);
```
