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

function normalizeStatus(status: string | undefined, grant: boolean): string {
  if (grant) {
    if (status === "trialing" || status === "past_due" || status === "active") {
      return status;
    }
    return "active";
  }
  return "canceled";
}

async function applyCreemContext(
  context: CreemSubscriptionContext,
  eventType: string,
  grant: boolean,
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
    subscription_status: normalizeStatus(context.status, grant),
    billed_plan: grant ? (billedPlan as EdmBilledPlan) : "free",
    current_period_end: getIsoDate(context.current_period_end_date),
    cancel_at_period_end: !grant,
  });
}

export async function handleCreemGrantAccess(
  context: CreemSubscriptionContext,
) {
  await applyCreemContext(context, "creem.grant", true);
}

export async function handleCreemRevokeAccess(
  context: CreemSubscriptionContext,
) {
  await applyCreemContext(context, "creem.revoke", false);
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
