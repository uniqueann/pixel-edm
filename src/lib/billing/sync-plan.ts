import type { EdmBilledPlan } from "./metadata";
import { serviceRoleClient } from "@/lib/supabase/service-role";

export type SyncWorkspacePlanInput = {
  payment_provider: "creem" | "dodo";
  provider_event_id: string;
  event_type: string;
  workspace_id: string;
  provider_customer_id: string;
  provider_subscription_id?: string | null;
  subscription_status: string;
  billed_plan: EdmBilledPlan | "free";
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
};

/** 将支付 Webhook 结果写入 edm_private 并更新 workspaces.plan。 */
export async function syncWorkspacePlanFromPayment(
  input: SyncWorkspacePlanInput,
) {
  const db = serviceRoleClient();
  const { data, error } = await db.rpc("sync_workspace_plan_from_payment", {
    payload: input,
  });
  if (error) {
    throw new Error(`同步工作区套餐失败：${error.message}`);
  }
  return data as Record<string, unknown>;
}
