import type { WorkspaceDeliveryPlan } from "./delivery-plan";
import { deliveryPlanLabel } from "./plan-labels";

/** 仅展示额度摘要；设置页请用 {@link BillingUpgrade}。 */
export function DeliveryPlanSummary({ plan }: { plan: WorkspaceDeliveryPlan }) {
  const label = deliveryPlanLabel(plan.plan, plan.plan_display_name);
  return (
    <div className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3 text-sm">
      <p className="font-medium text-foreground">
        当前套餐：{label} · 有效客户 {plan.billable_contacts} /{" "}
        {plan.max_billable_contacts} · 成员 {plan.active_members} /{" "}
        {plan.max_active_members}
      </p>
      <p className="hint mt-1 mb-0">
        单活动最多 {plan.max_recipients_per_campaign} 位收件人；平台日发信护栏{" "}
        {plan.usage_today} / {plan.daily_send_quota} 封（{plan.quota_timezone}
        ）。
      </p>
    </div>
  );
}
