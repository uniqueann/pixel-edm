import type { WorkspaceDeliveryPlan } from "./delivery-plan";
import { deliveryPlanLabel } from "./delivery-plan";

export function DeliveryPlanSummary({ plan }: { plan: WorkspaceDeliveryPlan }) {
  const label = deliveryPlanLabel(plan);
  return (
    <div className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3 text-sm">
      <p className="font-medium text-foreground">
        当前套餐：{label} · 今日已用 {plan.usage_today} /{" "}
        {plan.daily_send_quota} 封
      </p>
      <p className="hint mt-1 mb-0">
        单活动最多 {plan.max_recipients_per_campaign} 位收件人；日界按{" "}
        {plan.quota_timezone}{" "}
        计算。在线升级（Stripe）将在本阶段接入，当前仍由运维在库内调整 plan。
      </p>
    </div>
  );
}
