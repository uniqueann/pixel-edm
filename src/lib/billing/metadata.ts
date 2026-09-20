/** Checkout / Webhook 共享的 EDM 账单 metadata 约定。 */
export const EDM_BILLING_SCOPE = "edm";

export type EdmBilledPlan = "pro" | "team";

export function parseEdmBillingMetadata(
  metadata: Record<string, unknown> | undefined,
) {
  const scope =
    typeof metadata?.productScope === "string"
      ? metadata.productScope
      : undefined;
  const workspaceId =
    typeof metadata?.workspaceId === "string"
      ? metadata.workspaceId
      : undefined;
  const billedPlanRaw =
    typeof metadata?.billedPlan === "string" ? metadata.billedPlan : undefined;
  const billedPlan =
    billedPlanRaw === "pro" || billedPlanRaw === "team"
      ? billedPlanRaw
      : undefined;
  const userId =
    typeof metadata?.userId === "string" ? metadata.userId : undefined;

  return { scope, workspaceId, billedPlan, userId };
}

export function isEdmBillingMetadata(
  metadata: Record<string, unknown> | undefined,
) {
  const parsed = parseEdmBillingMetadata(metadata);
  return (
    parsed.scope === EDM_BILLING_SCOPE &&
    Boolean(parsed.workspaceId) &&
    Boolean(parsed.billedPlan)
  );
}
