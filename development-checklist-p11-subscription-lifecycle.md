# P11-5 订阅生命周期（取消续费与升档生效）

更新日期：2026-09-22。状态：**5a–5d 工程已实现，5e 补差价未做**。总原则：**多给的马上生效，少给的等到当前计费周期结束再生效**。

前提：P11-0 至 P11-3 已完成（Checkout、Webhook、设置页升档）。P12 已按有效客户数与席位门控，超额客户只拦新增、不删数据。本批不重做这些能力。

逐项对照见下文「现状」。正式付款闭环仍属 [P11-4](development-checklist-p11-billing.md)，可与 5a 并行，但不阻塞本地测试。

## 原则

| 方向 | 生效时机 | 数据 |
|------|----------|------|
| 升档（Free→Pro、Free→Team、Pro→Team） | 付款成功后立刻解锁 | 同一 `workspace`，不迁移 |
| 取消续费、到期降档 | 当前周期内权益保留；到期后再降到 free | 只锁不删；`workspaces.type` 不因降档回退 |

## 现状（本批不重做）

- 设置页已有管理员 Checkout：Free 可购 Pro/Team，Pro 可购 Team。Webhook `grant` 后立刻写 `edm.workspaces.plan`。
- Pro→Team 是**再开一份 Team 订阅**，界面提示去支付平台取消原 Pro，避免双扣。不是原订阅换档，也没有按天补差价。
- 客户超额：`assert_workspace_billable_contact_headroom` 只拒绝新增，不删除、不归档已有联系人。
- 成员超额：不踢人、不改角色；新邀请被 `assert_workspace_member_headroom` 拦住。仅 Team 可 `create_workspace_invitation`。
- `type` 与 `plan` 分离：计费只改 `plan`。`personal`→`team` 发生在首条有效邀请，取消订阅不会把 `type` 改回 personal。
- 升档按钮仅 `role === "admin"`（含 owner 的管理员身份）。

## 缺口（本批要补）

| 缺口 | 现在的行为 |
|------|------------|
| 应用内取消 | 无按钮、无门户。文案让用户自己去 Creem/Dodo |
| 周期末才降权 | Creem `onSubscriptionCanceled` 立刻 `revoke`→`plan=free`。`subscription.scheduled_cancel` 未接。Dodo `subscription.cancelled` 同样立刻降 free |
| 降档后的写操作 | 超额成员仍保持 editor 等角色，仍可发信、导入、确认活动 |
| 接近上限提示 | 设置页只展示「已用 / 上限」，没有 80% 提前提示 |
| 按天补差价 | 两家都有换档能力（见 5e），产品路径仍是新 Checkout |

## 分步交付

### P11-5a 周期末降级（先做）

没有这一步，应用内「取消续费」会把当月权益立刻关掉。

- [x] 新前向迁移只改 `edm` / `edm_private`：`sync_workspace_plan_from_payment` 在预约取消且周期未结束时保持已付费档。
- [x] 仅在 `expired` 或立即取消（未标记周期末）时降 free。`past_due` 仍保留 billed plan。
- [x] Creem：接入 `onSubscriptionScheduledCancel`。`onSubscriptionCanceled` 在周期未结束时改为预约取消。
- [x] Dodo：`subscription.cancelled` 在 `cancel_at_next_billing_date` 或周期未结束时保留档位；`subscription.expired` 降 free。
- [x] 扩展 `tests/billing-plan-sync.test.mjs`。
- [x] 2026-09-22 已应用到 content-up，云端记录 `20260922020435_20260922083000_p11_subscription_lifecycle`。见 `supabase/verification.md`。

### P11-5b 应用内取消续费

依赖 5a。

- [x] `POST /api/billing/cancel`：仅工作区 admin。Creem `mode: "scheduled"`；Dodo `status: "cancelled"` 且 `cancel_at_next_billing_date: true`。
- [x] 成功后写入 `cancel_at_period_end`，设置页显示周期末取消。
- [x] 设置页文案写明到期后降为免费版，数据不删除。
- [x] 编辑者、查看者无入口；服务端沿用管理员校验。
- [ ] 恢复续费：本批不做。

### P11-5c 降档后的锁定（只锁不删）

可与 5b 并行，依赖的是 `plan` 已降或成员数已超过当前档上限。

- [x] **客户**：仍只拦新增，不删除。
- [x] **成员**：不改角色、不踢人、不改 `type`。
- [x] **写操作**：活跃成员数大于 `max_active_members` 时，editor 的保存客户、导入、模板、活动确认和发信被拒绝；admin 不受限。减员后自动恢复。
- [x] 邀请仍只在 `plan=team` 时开放。
- [x] 设置页与团队页说明锁定原因，不把成员写成只读角色。

### P11-5d 接近上限提示

- [x] 有效客户 ≥ 80% 且未达 100% 时，设置页提示剩余名额。100% 仍硬拒绝。
- [x] 团队席位 ≥ 80% 时提示，不打开加购结账。

### P11-5e 补差价（决策门，默认不开发）

升档「马上生效」已由新 Checkout 满足。按剩余天数补差价另开，两家都确认可用再做。

| 供应商 | 已看到的能力 | 本批决定前要核对的点 |
|--------|----------------|----------------------|
| Creem | `subscriptions.upgrade({ productId, updateBehavior })`，含 `proration-charge-immediately` | 能否从 Pro 商品换到 Team 商品；metadata `billedPlan` 是否跟着变；失败时是否已扣款 |
| Dodo | `subscription.plan_changed` Webhook；更新订阅接口 | 是否支持换 product 并按剩余周期补差；`cancel_at_next_billing_date` 与换档能否同存 |

在 5e 结论文档之前，Pro→Team 继续「新 Team Checkout + 提示取消原 Pro」。不要在 UI 承诺补差价或按人头即时计价。

## 明确不做

- 席位加购 SKU，以及加人补差、减人下周期退款。
- 降档时删除客户、踢出成员、把 editor 批量改成 viewer。
- 把已是 team 的工作区改回 personal。
- 应用内退款、发票、暂停订阅（Creem `pause` / Dodo `paused`）。
- 改 content-up 主站支付、`aigc`、共享 Auth。

## 验收

1. **预约取消**：admin 取消后续费后，周期结束前 `plan` 仍为 pro 或 team，设置页显示周期末取消；editor 调用取消 API 得到拒绝。
2. **到期**：模拟或真实 `expired` 后 `plan=free`；客户行数不变；超额后不能再新增客户。
3. **超额成员**：降档后成员还在，角色不变，editor 不能确认活动；admin 仍能移除成员。减到上限内后 editor 恢复。
4. **升档**：Free→Pro、Pro→Team 付款成功后权限立即变化，工作区 id 不变，历史活动仍在。
5. **80%**：客户数达到上限 80% 时出现提示；低于 80% 不出现。

```sh
npm test -- tests/billing-plan-sync.test.mjs
npm run ci:push
```

改设置页或套餐门控后，提 PR 前再跑 `npm run ci:verify`。

## 建议顺序

5a → 5b。5c、5d 可在 5a 之后并行。5e 只做核对，不进同一 PR。
