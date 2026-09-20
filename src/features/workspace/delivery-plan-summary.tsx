import type { WorkspaceDeliveryPlan } from "./delivery-plan";
import { deliveryPlanLabel } from "./plan-labels";

/** 仅展示额度摘要；设置页请用 {@link BillingUpgrade}。 */
export function DeliveryPlanSummary({ plan }: { plan: WorkspaceDeliveryPlan }) {
  const label = deliveryPlanLabel(plan.plan, plan.plan_display_name);
  return (
    <div className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3 text-sm">
      <p className="font-medium text-foreground">
        当前套餐：{label} · 今日已用 {plan.usage_today} /{" "}
        {plan.daily_send_quota} 封
      </p>
      <p className="hint mt-1 mb-0">
        单活动最多 {plan.max_recipients_per_campaign} 位收件人；日界按{" "}
        {plan.quota_timezone} 计算。
      </p>
    </div>
  );
}
