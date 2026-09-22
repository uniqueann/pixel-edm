import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/supabase/config";
import {
  getCreemApiKey,
  getCreemEdmProductId,
  isCreemTestMode,
} from "@/lib/billing/creem";
import { getDodoClient, getDodoEdmProductId } from "@/lib/billing/dodo";
import { normalizeCheckoutDiscountCode } from "@/lib/billing/discount-code";
import {
  assessCreemCheckoutDiscount,
  assessDodoDiscount,
  configBlockedDiscountCheck,
  missingDiscountCheck,
  summarizeDiscountChannels,
  type DiscountChannelCheck,
} from "@/lib/billing/discount-availability";
import {
  normalizeCheckoutInterval,
  normalizeCheckoutPlan,
  requireEdmBillingCheckout,
  validateCheckoutPlanForWorkspace,
} from "@/lib/billing/checkout-context";
import { buildCreemCheckoutMetadata } from "@/lib/billing/creem-webhook";
import { describeCheckoutProviderFailure } from "@/lib/billing/checkout-provider-error";

export const runtime = "nodejs";

/** 结账前确认折扣代码能否用于当前套餐，避免直接跳进支付页才失败。 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    workspace_id?: unknown;
    plan?: unknown;
    interval?: unknown;
    code?: unknown;
  } | null;
  const workspaceId =
    typeof body?.workspace_id === "string" ? body.workspace_id : null;
  const ctx = await requireEdmBillingCheckout(workspaceId);
  if (!ctx.ok) {
    return NextResponse.json(
      { ok: false, error: ctx.error },
      { status: ctx.status },
    );
  }

  const plan = normalizeCheckoutPlan(
    typeof body?.plan === "string" ? body.plan : null,
  );
  const interval = normalizeCheckoutInterval(
    typeof body?.interval === "string" ? body.interval : null,
  );
  const planCheck = validateCheckoutPlanForWorkspace(ctx.workspacePlan, plan);
  if (!planCheck.ok) {
    return NextResponse.json(
      { ok: false, error: planCheck.error },
      { status: 400 },
    );
  }

  let code = "";
  try {
    code = normalizeCheckoutDiscountCode(
      typeof body?.code === "string" ? body.code : "",
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "折扣代码无效。",
      },
      { status: 400 },
    );
  }
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "请输入折扣代码。" },
      { status: 400 },
    );
  }

  const [creem, dodo] = await Promise.all([
    checkCreemDiscount(plan, interval, code, {
      userId: ctx.user.id,
      email: ctx.user.email ?? undefined,
      workspaceId: ctx.workspaceId,
    }),
    checkDodoDiscount(plan, interval, code),
  ]);
  const summary = summarizeDiscountChannels({ creem, dodo });
  return NextResponse.json({
    ok: true,
    code,
    available: summary.available,
    message: summary.message,
    creem: summary.creem,
    dodo: summary.dodo,
  });
}

async function checkDodoDiscount(
  plan: "pro" | "team",
  interval: "monthly" | "yearly",
  code: string,
): Promise<DiscountChannelCheck> {
  let productId = "";
  try {
    productId = getDodoEdmProductId(plan, interval);
    const discount = await getDodoClient().discounts.retrieveByCode(code);
    return assessDodoDiscount(
      {
        type: discount.type,
        amount: discount.amount,
        expires_at: discount.expires_at,
        starts_at: discount.starts_at,
        usage_limit: discount.usage_limit,
        times_used: discount.times_used,
        restricted_to: discount.restricted_to,
      },
      productId,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    if (/未配置/.test(detail)) return configBlockedDiscountCheck(detail);
    if (/doesn.?t exist|not found|404/i.test(detail))
      return missingDiscountCheck();
    return {
      available: false,
      message: "暂时无法验证这个折扣代码，请稍后重试。",
    };
  }
}

async function checkCreemDiscount(
  plan: "pro" | "team",
  interval: "monthly" | "yearly",
  code: string,
  customer: { userId: string; email?: string; workspaceId: string },
): Promise<DiscountChannelCheck> {
  // 当前 Creem 密钥不能调用折扣查询接口，用一次结账创建确认代码能否用于该商品。
  try {
    const productId = getCreemEdmProductId(plan, interval);
    const apiKey = getCreemApiKey();
    const baseUrl = isCreemTestMode()
      ? "https://test-api.creem.io"
      : "https://api.creem.io";
    const response = await fetch(`${baseUrl}/v1/checkouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        product_id: productId,
        discount_code: code,
        request_id: `edm-discount-check-${customer.workspaceId}-${Date.now()}`,
        success_url: `${siteUrl()}/settings?checkout=success&provider=creem&plan=${plan}`,
        customer: { email: customer.email },
        metadata: buildCreemCheckoutMetadata({
          userId: customer.userId,
          workspaceId: customer.workspaceId,
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
        hadDiscountCode: true,
      });
      if (failure.reason === "discount") return missingDiscountCheck();
      return {
        available: false,
        message: "暂时无法验证这个折扣代码，请稍后重试。",
      };
    }
    const data = (await response.json()) as {
      discount?: { type?: string | null; amount?: number | null } | null;
    };
    return assessCreemCheckoutDiscount(data.discount ?? null);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    return configBlockedDiscountCheck(detail);
  }
}
