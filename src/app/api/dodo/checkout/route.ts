import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/supabase/config";
import { getDodoClient, getDodoEdmProductId } from "@/lib/billing/dodo";
import { buildDodoCheckoutMetadata } from "@/lib/billing/dodo-webhook";
import { normalizeCheckoutDiscountCode } from "@/lib/billing/discount-code";
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
      provider: "dodo",
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
      provider: "dodo",
    });
  }

  const planCheck = validateCheckoutPlanForWorkspace(ctx.workspacePlan, plan);
  if (!planCheck.ok) {
    return redirectCheckoutError({
      reason: "plan",
      plan,
      provider: "dodo",
    });
  }

  let productId: string;
  try {
    productId = getDodoEdmProductId(plan, interval);
  } catch {
    return redirectCheckoutError({
      reason: "missing_product",
      plan,
      provider: "dodo",
    });
  }

  const client = getDodoClient();
  const returnUrl = `${siteUrl()}/settings?checkout=success&provider=dodo&plan=${plan}`;

  try {
    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      ...(discountCode ? { discount_codes: [discountCode] } : {}),
      customer: ctx.user.email ? { email: ctx.user.email } : undefined,
      return_url: returnUrl,
      metadata: buildDodoCheckoutMetadata({
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
        billedPlan: plan,
        interval,
      }),
    });
    if (!session.checkout_url) {
      return redirectCheckoutError({
        reason: "provider",
        plan,
        provider: "dodo",
      });
    }
    return NextResponse.redirect(session.checkout_url, 303);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Dodo Checkout 创建失败。";
    const failure = describeCheckoutProviderFailure({
      provider: "dodo",
      detail,
      hadDiscountCode: Boolean(discountCode),
    });
    return redirectCheckoutError({
      reason: failure.reason,
      plan,
      provider: "dodo",
    });
  }
}
