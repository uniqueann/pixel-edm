import type { EdmBilledPlan } from "./metadata";

export { normalizeCheckoutDiscountCode as normalizeCreemDiscountCode } from "./discount-code";

function billingConfigError(message: string) {
  return Object.assign(new Error(message), {
    code: "errors.billing.configMissing",
    expose: false,
  });
}

export function getCreemApiKey() {
  const key = process.env.CREEM_API_KEY?.trim();
  if (!key) throw billingConfigError("CREEM_API_KEY 未配置。");
  return key;
}

export function getCreemWebhookSecret() {
  const secret = process.env.CREEM_WEBHOOK_SECRET?.trim();
  if (!secret) throw billingConfigError("CREEM_WEBHOOK_SECRET 未配置。");
  return secret;
}

export function getCreemEdmProductId(
  plan: EdmBilledPlan,
  interval: "monthly" | "yearly",
) {
  const envKey =
    plan === "team"
      ? interval === "yearly"
        ? "CREEM_EDM_TEAM_YEARLY_PRODUCT_ID"
        : "CREEM_EDM_TEAM_MONTHLY_PRODUCT_ID"
      : interval === "yearly"
        ? "CREEM_EDM_PRO_YEARLY_PRODUCT_ID"
        : "CREEM_EDM_PRO_MONTHLY_PRODUCT_ID";
  const id = process.env[envKey]?.trim();
  if (!id) throw billingConfigError(`${envKey} 未配置。`);
  return id;
}

export function isCreemTestMode() {
  return process.env.NODE_ENV !== "production";
}
