import "server-only";
import { serverClient } from "@/lib/supabase/server";

export type WorkspaceDeliveryPlan = {
  plan: string;
  plan_display_name: string;
  daily_send_quota: number;
  usage_today: number;
  remaining_today: number;
  max_recipients_per_campaign: number;
  quota_timezone: string;
};

/** 设置页展示套餐额度；不含 ESP 注册表默认值。 */
export async function getWorkspaceDeliveryPlan(
  workspaceId: string,
): Promise<WorkspaceDeliveryPlan | null> {
  const supabase = await serverClient();
  const { data, error } = await supabase.rpc("get_workspace_delivery_plan", {
    payload: { workspace_id: workspaceId },
  });
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (
    typeof row.plan !== "string" ||
    typeof row.plan_display_name !== "string" ||
    typeof row.daily_send_quota !== "number" ||
    typeof row.usage_today !== "number" ||
    typeof row.remaining_today !== "number" ||
    typeof row.max_recipients_per_campaign !== "number"
  ) {
    return null;
  }
  return {
    plan: row.plan,
    plan_display_name: row.plan_display_name,
    daily_send_quota: row.daily_send_quota,
    usage_today: row.usage_today,
    remaining_today: row.remaining_today,
    max_recipients_per_campaign: row.max_recipients_per_campaign,
    quota_timezone:
      typeof row.quota_timezone === "string"
        ? row.quota_timezone
        : "Asia/Shanghai",
  };
}

/** 中文展示名（配置表为英文产品名时兜底）。 */
export function deliveryPlanLabel(plan: WorkspaceDeliveryPlan): string {
  const localized: Record<string, string> = {
    free: "免费版",
    pro: "专业版",
    team: "团队版",
  };
  return localized[plan.plan] ?? plan.plan_display_name;
}
