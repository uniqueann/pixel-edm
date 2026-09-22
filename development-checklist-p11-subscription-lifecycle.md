# P11-5 订阅生命周期（取消续费与升档生效）

更新日期：2026-09-22。状态：**规划定稿，尚未开工**。总原则：**多给的马上生效，少给的等到当前计费周期结束再生效**。

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

- [ ] 新前向迁移只改 `edm` / `edm_private`：`sync_workspace_plan_from_payment` 在 `subscription_status` 仍为 `active`/`trialing` 且 `cancel_at_period_end=true` 时，**保持** `billed_plan`，不写成 free。
- [ ] 仅在周期已结束或供应商明确结束授权时降 free：Creem `subscription.expired`（现有 `onRevokeAccess`）、以及确认「canceled 表示周期已结束」的事件；Dodo `subscription.expired`。`past_due` 维持现有「仍给 billed_plan」策略，本批不改催收。
- [ ] Creem：接入 `onSubscriptionScheduledCancel`，只写 `cancel_at_period_end=true`，不调用现有 `handleCreemRevokeAccess`。
- [ ] 修正 `onSubscriptionCanceled`：若事件仍代表「已预约、周期未结束」，不得降 `plan`。以 Creem 文档与一条测试事件核对后再改调用。
- [ ] Dodo：`cancel_at_next_billing_date=true` 且状态仍 active 时走预约取消；`subscription.expired` 才降 free。`subscription.cancelled` 若在周期结束前到达，按同一规则处理，不默认立刻降级。
- [ ] 扩展 `tests/billing-plan-sync.test.mjs`：预约取消保持 pro/team；到期事件变为 free；重复事件仍幂等。

### P11-5b 应用内取消续费

依赖 5a。

- [ ] `POST /api/billing/cancel`：仅工作区 admin。按 `workspace_billing_subscriptions.payment_provider` 调对应 API。
  - Creem：`subscriptions.cancel`，`mode: "scheduled"`，`onExecute: "cancel"`（不要 `immediate`，不要 `pause`）。
  - Dodo：`subscriptions.update`，`status: "cancelled"` 且 `cancel_at_next_billing_date: true`。
- [ ] 成功后再以服务端写入 `cancel_at_period_end`（Webhook 到达前设置页也能显示「已设置周期末取消」）。Webhook 仍是最终事实来源。
- [ ] 设置页：admin、且当前有有效付费订阅、且尚未预约取消时，显示「取消续费」。文案写明权益保留到 `current_period_end`，到期后降为免费版，数据不删除。
- [ ] 编辑者、查看者无此入口；服务端同样拒绝。
- [ ] 若供应商支持在周期结束前恢复续费，可加「恢复续费」；某一家不支持则该家只做取消，并在按钮旁说明需到对方账户操作。本步不阻塞取消。

### P11-5c 降档后的锁定（只锁不删）

可与 5b 并行，依赖的是 `plan` 已降或成员数已超过当前档上限。

- [ ] **客户**：保持现有 headroom。禁止任何「降档时删除或自动归档超额联系人」的任务。
- [ ] **成员**：不修改 `workspace_members.role`，不软删超额成员，不把 `workspaces.type` 改回 personal。
- [ ] **写操作**：当活跃成员数 **大于** 当前档 `max_active_members` 时，editor 的发信、导入、保存客户、确认活动、改模板一律拒绝；admin 仍可管理账单、移除成员、转移 owner。恢复到席位内（减员或重新订阅）后写操作自动恢复，不需要迁回角色。
- [ ] 团队功能开关继续只看 `plan=team`（邀请、协作入口）。降到 free/pro 后邀请保持关闭。
- [ ] 设置页与团队页说明：超额成员仍在名单中，协作能力已锁定，重新订阅后恢复。不要写成「已降为只读角色」。

### P11-5d 接近上限提示

- [ ] 有效客户 ≥ 80% 且未达 100% 时，设置页（及客户列表空态/顶栏若已有套餐条）提示剩余名额，并链到升档。100% 仍用现有硬拒绝。
- [ ] 团队席位 ≥ 80% 且 `plan=team` 时同样提示。席位加购 SKU 未做，文案只引导联系或等待加购，不打开不存在的结账。

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
