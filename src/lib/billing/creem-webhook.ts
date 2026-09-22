import { billingPeriodStillOpen } from "./billing-period";
import type { EdmBilledPlan } from "./metadata";
import {
  EDM_BILLING_SCOPE,
  isEdmBillingMetadata,
  parseEdmBillingMetadata,
} from "./metadata";
import { syncWorkspacePlanFromPayment } from "./sync-plan";

type CreemSubscriptionContext = {
  id: string;
  customer?: { id: string };
  current_period_end_date?: Date | string | number | null;
  metadata?: Record<string, string | number | null>;
  status?: string;
};

function getIsoDate(value: Date | string | number | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

type CreemAccessMode = "grant" | "schedule" | "revoke";

function normalizeStatus(
  status: string | undefined,
  mode: CreemAccessMode,
): string {
  if (mode === "revoke") return "canceled";
  if (mode === "schedule") return "active";
  if (status === "trialing" || status === "past_due" || status === "active") {
    return status;
  }
  return "active";
}

async function applyCreemContext(
  context: CreemSubscriptionContext,
  eventType: string,
  mode: CreemAccessMode,
) {
  const metadata = context.metadata as Record<string, unknown> | undefined;
  if (!isEdmBillingMetadata(metadata)) {
    console.warn("[pixel-edm] Creem webhook 忽略非 EDM metadata", {
      eventType,
      subscriptionId: context.id,
    });
    return;
  }
  const { workspaceId, billedPlan } = parseEdmBillingMetadata(metadata);
  if (!workspaceId || !billedPlan) return;

  const customerId = context.customer?.id;
  if (!customerId) {
    console.error("[pixel-edm] Creem webhook 缺少 customer id", context.id);
    return;
  }

  await syncWorkspacePlanFromPayment({
    payment_provider: "creem",
    provider_event_id: `${context.id}:${eventType}`,
    event_type: eventType,
    workspace_id: workspaceId,
    provider_customer_id: customerId,
    provider_subscription_id: context.id,
    subscription_status: normalizeStatus(context.status, mode),
    billed_plan: mode === "revoke" ? "free" : (billedPlan as EdmBilledPlan),
    current_period_end: getIsoDate(context.current_period_end_date),
    cancel_at_period_end: mode !== "grant",
  });
}

export async function handleCreemGrantAccess(
  context: CreemSubscriptionContext,
) {
  await applyCreemContext(context, "creem.grant", "grant");
}

/** 取消续费：周期结束前保留当前档。 */
export async function handleCreemScheduledCancel(
  context: CreemSubscriptionContext,
) {
  await applyCreemContext(context, "creem.scheduled_cancel", "schedule");
}

export async function handleCreemSubscriptionCanceled(
  context: CreemSubscriptionContext,
) {
  const periodEnd = getIsoDate(context.current_period_end_date);
  if (billingPeriodStillOpen(periodEnd)) {
    await handleCreemScheduledCancel(context);
    return;
  }
  await handleCreemRevokeAccess(context);
}

export async function handleCreemRevokeAccess(
  context: CreemSubscriptionContext,
) {
  await applyCreemContext(context, "creem.revoke", "revoke");
}

export function buildCreemCheckoutMetadata(input: {
  userId: string;
  workspaceId: string;
  billedPlan: EdmBilledPlan;
  interval: string;
}) {
  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    billedPlan: input.billedPlan,
    productScope: EDM_BILLING_SCOPE,
    interval: input.interval,
  };
}
