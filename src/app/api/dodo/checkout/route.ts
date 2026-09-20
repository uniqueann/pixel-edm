import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/supabase/config";
import { getDodoClient, getDodoEdmProductId } from "@/lib/billing/dodo";
import { buildDodoCheckoutMetadata } from "@/lib/billing/dodo-webhook";
import {
  normalizeCheckoutInterval,
  normalizeCheckoutPlan,
  requireEdmBillingCheckout,
} from "@/lib/billing/checkout-context";

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

  let productId: string;
  try {
    productId = getDodoEdmProductId(plan, interval);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dodo 商品未配置。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const client = getDodoClient();
  const returnUrl = `${siteUrl()}/settings?checkout=success&provider=dodo`;

  try {
    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
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
      return NextResponse.json(
        { ok: false, error: "Dodo 未返回 checkout URL。" },
        { status: 502 },
      );
    }
    return NextResponse.redirect(session.checkout_url, 303);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dodo Checkout 创建失败。";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
