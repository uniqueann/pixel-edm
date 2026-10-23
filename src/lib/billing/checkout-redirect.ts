import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/supabase/config";
import type { EdmBilledPlan } from "./metadata";
import type { CheckoutErrorReason } from "./checkout-toast-copy";

/** HTML 表单 POST 失败时回设置页并 toast，避免裸 JSON。 */
export function redirectCheckoutError(input: {
  reason: CheckoutErrorReason;
  plan?: EdmBilledPlan;
  provider?: "creem" | "dodo";
}) {
  const url = new URL("/settings", siteUrl());
  url.searchParams.set("checkout", "error");
  url.searchParams.set("reason", input.reason);
  if (input.plan) url.searchParams.set("plan", input.plan);
  if (input.provider) url.searchParams.set("provider", input.provider);
  return NextResponse.redirect(url.toString(), 303);
}

/** requireEdmBillingCheckout 失败时映射为可展示的 reason。 */
export function redirectBillingAccessError(input: {
  status: number;
  plan?: EdmBilledPlan;
  provider?: "creem" | "dodo";
}) {
  const reason: CheckoutErrorReason =
    input.status === 401
      ? "auth"
      : input.status === 403
        ? "forbidden"
        : "config";
  return redirectCheckoutError({
    reason,
    plan: input.plan,
    provider: input.provider,
  });
}
