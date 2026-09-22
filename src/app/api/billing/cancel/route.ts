import { Creem } from "creem";
import { NextResponse } from "next/server";
import { getCreemApiKey, isCreemTestMode } from "@/lib/billing/creem";
import { requireEdmBillingCheckout } from "@/lib/billing/checkout-context";
import { redirectCheckoutError } from "@/lib/billing/checkout-redirect";
import { getDodoClient } from "@/lib/billing/dodo";
import type { EdmBilledPlan } from "@/lib/billing/metadata";
import { syncWorkspacePlanFromPayment } from "@/lib/billing/sync-plan";
import { siteUrl } from "@/lib/supabase/config";
import { serviceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

type CancelTarget = {
  plan: string;
  payment_provider: string | null;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  billed_plan: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  has_subscription: boolean;
};

function redirectScheduled() {
  const url = new URL("/settings", siteUrl());
  url.searchParams.set("checkout", "cancel_scheduled");
  return NextResponse.redirect(url.toString(), 303);
}

function paidPlan(value: string): EdmBilledPlan | null {
  return value === "pro" || value === "team" ? value : null;
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const formWorkspaceId =
    typeof formData?.get("workspace_id") === "string"
      ? formData.get("workspace_id")!.toString()
      : null;
  const ctx = await requireEdmBillingCheckout(formWorkspaceId);
  if (!ctx.ok) {
    return NextResponse.json(
      { ok: false, error: ctx.error },
      { status: ctx.status },
    );
  }

  const db = serviceRoleClient();
  const { data, error } = await db.rpc("get_workspace_billing_cancel_target", {
    payload: { workspace_id: ctx.workspaceId },
  });
  if (error || !data || typeof data !== "object") {
    return redirectCheckoutError({
      reason: "config",
      message: "读取订阅信息失败。",
    });
  }
  const target = data as CancelTarget;
  const plan = paidPlan(target.billed_plan) ?? paidPlan(target.plan);
  if (
    !target.has_subscription ||
    !target.provider_subscription_id ||
    !target.provider_customer_id ||
    !plan ||
    (target.payment_provider !== "creem" && target.payment_provider !== "dodo")
  ) {
    return redirectCheckoutError({
      reason: "config",
      message: "当前没有可取消续费的付费订阅。",
    });
  }
  if (target.cancel_at_period_end) {
    return redirectScheduled();
  }

  try {
    if (target.payment_provider === "creem") {
      const creem = new Creem({
        apiKey: getCreemApiKey(),
        server: isCreemTestMode() ? "test" : "prod",
      });
      await creem.subscriptions.cancel(target.provider_subscription_id, {
        mode: "scheduled",
        onExecute: "cancel",
      });
    } else {
      const client = getDodoClient();
      await client.subscriptions.update(target.provider_subscription_id, {
        status: "cancelled",
        cancel_at_next_billing_date: true,
      });
    }
  } catch (cancelError) {
    const message =
      cancelError instanceof Error
        ? cancelError.message
        : "支付平台取消续费失败。";
    return redirectCheckoutError({
      reason: "provider",
      provider: target.payment_provider,
      message,
    });
  }

  await syncWorkspacePlanFromPayment({
    payment_provider: target.payment_provider,
    provider_event_id: `app-cancel:${target.provider_subscription_id}:${Date.now()}`,
    event_type: "app.schedule_cancel",
    workspace_id: ctx.workspaceId,
    provider_customer_id: target.provider_customer_id,
    provider_subscription_id: target.provider_subscription_id,
    subscription_status: "active",
    billed_plan: plan,
    current_period_end: target.current_period_end,
    cancel_at_period_end: true,
  });

  return redirectScheduled();
}
