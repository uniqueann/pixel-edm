import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { deliveryPlanLabel as planLabel } from "./plan-labels";

export type WorkspaceDeliveryPlan = {
  plan: string;
  plan_display_name: string;
  max_billable_contacts: number;
  billable_contacts: number;
  remaining_billable_contacts: number;
  max_active_members: number;
  active_members: number;
  remaining_member_slots: number;
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
    typeof row.max_billable_contacts !== "number" ||
    typeof row.billable_contacts !== "number" ||
    typeof row.remaining_billable_contacts !== "number" ||
    typeof row.max_active_members !== "number" ||
    typeof row.active_members !== "number" ||
    typeof row.remaining_member_slots !== "number" ||
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
    max_billable_contacts: row.max_billable_contacts,
    billable_contacts: row.billable_contacts,
    remaining_billable_contacts: row.remaining_billable_contacts,
    max_active_members: row.max_active_members,
    active_members: row.active_members,
    remaining_member_slots: row.remaining_member_slots,
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
  return planLabel(plan.plan, plan.plan_display_name);
}
