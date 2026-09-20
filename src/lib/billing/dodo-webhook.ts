import type { DodoPayments } from "dodopayments";
import type { EdmBilledPlan } from "./metadata";
import {
  EDM_BILLING_SCOPE,
  isEdmBillingMetadata,
  parseEdmBillingMetadata,
} from "./metadata";
import { syncWorkspacePlanFromPayment } from "./sync-plan";

type DodoSubscription = DodoPayments.Subscription & Record<string, unknown>;
type DodoPayment = DodoPayments.Payment & Record<string, unknown>;

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function getIsoDate(value: unknown) {
  const stringValue = getString(value);
  if (!stringValue) return null;
  const date = new Date(stringValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getDodoCustomerId(subscription: DodoSubscription) {
  const customer = getRecord(subscription.customer);
  return (
    getString(customer?.customer_id) ??
    getString(customer?.id) ??
    getString(subscription.customer_id)
  );
}

function getDodoSubscriptionId(subscription: DodoSubscription) {
  return getString(subscription.subscription_id) ?? getString(subscription.id);
}

function getDodoQuotaResetAt(subscription: DodoSubscription) {
  return (
    getIsoDate(subscription.current_period_end) ??
    getIsoDate(subscription.current_period_end_date) ??
    getIsoDate(subscription.next_billing_date)
  );
}

function subscriptionStatusFromDodo(
  subscription: DodoSubscription,
  eventType: string,
  grant: boolean,
): string {
  if (!grant) return "canceled";
  if (subscription.status === "active") return "active";
  if (
    subscription.status === "on_hold" ||
    eventType === "subscription.on_hold"
  ) {
    return "past_due";
  }
  return "canceled";
}

async function applyDodoSubscription(
  subscription: DodoSubscription,
  eventType: string,
  providerEventId: string,
  grant: boolean,
) {
  const metadata = getRecord(subscription.metadata) ?? undefined;
  if (!isEdmBillingMetadata(metadata)) {
    return;
  }
  const { workspaceId, billedPlan } = parseEdmBillingMetadata(metadata);
  if (!workspaceId || !billedPlan) return;

  const customerId = getDodoCustomerId(subscription);
  const subscriptionId = getDodoSubscriptionId(subscription);
  if (!customerId || !subscriptionId) {
    console.error("[pixel-edm] Dodo webhook 缺少 customer/subscription id", {
      eventType,
    });
    return;
  }

  await syncWorkspacePlanFromPayment({
    payment_provider: "dodo",
    provider_event_id: providerEventId,
    event_type: eventType,
    workspace_id: workspaceId,
    provider_customer_id: customerId,
    provider_subscription_id: subscriptionId,
    subscription_status: subscriptionStatusFromDodo(
      subscription,
      eventType,
      grant,
    ),
    billed_plan: grant ? (billedPlan as EdmBilledPlan) : "free",
    current_period_end: getDodoQuotaResetAt(subscription),
    cancel_at_period_end: !grant,
  });
}

export async function handleDodoEdmEvent(
  event: DodoPayments.UnwrapWebhookEvent,
  webhookId: string,
) {
  const grantEvents = new Set([
    "subscription.active",
    "subscription.renewed",
    "subscription.updated",
    "subscription.plan_changed",
    "payment.succeeded",
  ]);
  const revokeEvents = new Set([
    "subscription.on_hold",
    "subscription.failed",
    "subscription.cancelled",
    "subscription.expired",
  ]);

  if (event.type === "payment.succeeded") {
    const payment = event.data as DodoPayment;
    const metadata = getRecord(payment.metadata);
    if (!isEdmBillingMetadata(metadata ?? undefined)) {
      return;
    }
    const subscriptionId = getString(payment.subscription_id);
    if (!subscriptionId) return;
    const stub = {
      subscription_id: subscriptionId,
      status: "active",
      customer: payment.customer,
      metadata: payment.metadata,
    } as DodoSubscription;
    await applyDodoSubscription(stub, event.type, webhookId, true);
    return;
  }

  if (!event.type.startsWith("subscription.")) {
    return;
  }

  const subscription = event.data as DodoSubscription;
  if (grantEvents.has(event.type) && subscription.status === "active") {
    await applyDodoSubscription(subscription, event.type, webhookId, true);
    return;
  }
  if (revokeEvents.has(event.type)) {
    await applyDodoSubscription(subscription, event.type, webhookId, false);
  }
}

export function buildDodoCheckoutMetadata(input: {
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
