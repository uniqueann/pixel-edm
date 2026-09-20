import "server-only";
import { serverClient } from "@/lib/supabase/server";

export type WorkspaceBillingStatus = {
  plan: string;
  payment_provider: string | null;
  has_payment_provider: boolean;
  subscription_status: string;
  billed_plan: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

/** 管理员可读：工作区订阅摘要（无支付密钥）。 */
export async function getWorkspaceBillingStatus(
  workspaceId: string,
): Promise<WorkspaceBillingStatus | null> {
  const supabase = await serverClient();
  const { data, error } = await supabase.rpc("get_workspace_billing_status", {
    payload: { workspace_id: workspaceId },
  });
  if (error || !data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.plan !== "string" || typeof row.billed_plan !== "string") {
    return null;
  }
  return {
    plan: row.plan,
    payment_provider:
      typeof row.payment_provider === "string" ? row.payment_provider : null,
    has_payment_provider: row.has_payment_provider === true,
    subscription_status:
      typeof row.subscription_status === "string"
        ? row.subscription_status
        : "none",
    billed_plan: row.billed_plan,
    current_period_end:
      typeof row.current_period_end === "string"
        ? row.current_period_end
        : null,
    cancel_at_period_end: row.cancel_at_period_end === true,
  };
}
