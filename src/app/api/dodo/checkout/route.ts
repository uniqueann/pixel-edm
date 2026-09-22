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
import { redirectCheckoutError } from "@/lib/billing/checkout-redirect";

export const runtime = "nodejs";

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

  const plan = normalizeCheckoutPlan(formData?.get("plan") ?? null);
  const interval = normalizeCheckoutInterval(formData?.get("interval") ?? null);

  let discountCode: string;
  try {
    discountCode = normalizeCheckoutDiscountCode(
      formData?.get("discount_code") ?? null,
    );
  } catch (error) {
    return redirectCheckoutError({
      reason: "discount",
      plan,
      provider: "dodo",
      message: error instanceof Error ? error.message : "优惠码无效。",
    });
  }

  const planCheck = validateCheckoutPlanForWorkspace(ctx.workspacePlan, plan);
  if (!planCheck.ok) {
    return NextResponse.json(
      { ok: false, error: planCheck.error },
      { status: 400 },
    );
  }

  let productId: string;
  try {
    productId = getDodoEdmProductId(plan, interval);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dodo 商品未配置。";
    return redirectCheckoutError({
      reason: "missing_product",
      plan,
      provider: "dodo",
      message,
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
        message: "Dodo Payments 未返回结账链接，请稍后重试。",
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
      message: failure.message,
    });
  }
}
