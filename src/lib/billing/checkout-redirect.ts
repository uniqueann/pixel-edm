import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/supabase/config";
import type { EdmBilledPlan } from "./metadata";

/** HTML 表单 POST 失败时回设置页并 toast，避免裸 JSON。 */
export function redirectCheckoutError(input: {
  reason: "missing_product" | "config" | "provider" | "discount";
  plan?: EdmBilledPlan;
  provider?: "creem" | "dodo";
  message?: string;
}) {
  const url = new URL("/settings", siteUrl());
  url.searchParams.set("checkout", "error");
  url.searchParams.set("reason", input.reason);
  if (input.plan) url.searchParams.set("plan", input.plan);
  if (input.provider) url.searchParams.set("provider", input.provider);
  if (input.message) {
    url.searchParams.set("msg", input.message.slice(0, 200));
  }
  return NextResponse.redirect(url.toString(), 303);
}
