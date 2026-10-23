import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/supabase/config";
import {
  getCreemApiKey,
  getCreemEdmProductId,
  isCreemTestMode,
} from "@/lib/billing/creem";
import { normalizeCheckoutDiscountCode } from "@/lib/billing/discount-code";
import { buildCreemCheckoutMetadata } from "@/lib/billing/creem-webhook";
import {
  normalizeCheckoutInterval,
  normalizeCheckoutPlan,
  requireEdmBillingCheckout,
  validateCheckoutPlanForWorkspace,
} from "@/lib/billing/checkout-context";
import { describeCheckoutProviderFailure } from "@/lib/billing/checkout-provider-error";
import {
  redirectBillingAccessError,
  redirectCheckoutError,
} from "@/lib/billing/checkout-redirect";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const formWorkspaceId =
    typeof formData?.get("workspace_id") === "string"
      ? formData.get("workspace_id")!.toString()
      : null;
  const plan = normalizeCheckoutPlan(formData?.get("plan") ?? null);
  const interval = normalizeCheckoutInterval(formData?.get("interval") ?? null);

  const ctx = await requireEdmBillingCheckout(formWorkspaceId);
  if (!ctx.ok) {
    return redirectBillingAccessError({
      status: ctx.status,
      plan,
      provider: "creem",
    });
  }

  let discountCode: string;
  try {
    discountCode = normalizeCheckoutDiscountCode(
      formData?.get("discount_code") ?? null,
    );
  } catch {
    return redirectCheckoutError({
      reason: "discount",
      plan,
      provider: "creem",
    });
  }

  const planCheck = validateCheckoutPlanForWorkspace(ctx.workspacePlan, plan);
  if (!planCheck.ok) {
    return redirectCheckoutError({
      reason: "plan",
      plan,
      provider: "creem",
    });
  }

  let productId: string;
  try {
    productId = getCreemEdmProductId(plan, interval);
  } catch {
    return redirectCheckoutError({
      reason: "missing_product",
      plan,
      provider: "creem",
    });
  }

  const apiKey = getCreemApiKey();
  const testMode = isCreemTestMode();
  const baseUrl = testMode
    ? "https://test-api.creem.io"
    : "https://api.creem.io";
  const origin = siteUrl();
  const successUrl = `${origin}/settings?checkout=success&provider=creem&plan=${plan}`;

  const response = await fetch(`${baseUrl}/v1/checkouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      product_id: productId,
      ...(discountCode ? { discount_code: discountCode } : {}),
      request_id: `edm-${ctx.workspaceId}-${plan}-${interval}-${Date.now()}`,
      success_url: successUrl,
      customer: { email: ctx.user.email ?? undefined },
      metadata: buildCreemCheckoutMetadata({
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
        billedPlan: plan,
        interval,
      }),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const failure = describeCheckoutProviderFailure({
      provider: "creem",
      detail: text,
      hadDiscountCode: Boolean(discountCode),
    });
    return redirectCheckoutError({
      reason: failure.reason,
      plan,
      provider: "creem",
    });
  }

  const data = (await response.json()) as { checkout_url?: string };
  if (!data.checkout_url) {
    return redirectCheckoutError({
      reason: "provider",
      plan,
      provider: "creem",
    });
  }

  return NextResponse.redirect(data.checkout_url, 303);
}
