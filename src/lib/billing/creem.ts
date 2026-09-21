import type { EdmBilledPlan } from "./metadata";

export function getCreemApiKey() {
  const key = process.env.CREEM_API_KEY?.trim();
  if (!key) throw new Error("CREEM_API_KEY 未配置。");
  return key;
}

export function getCreemWebhookSecret() {
  const secret = process.env.CREEM_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("CREEM_WEBHOOK_SECRET 未配置。");
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
  if (!id) throw new Error(`${envKey} 未配置。`);
  return id;
}

export function isCreemTestMode() {
  return process.env.NODE_ENV !== "production";
}

/** 规范化并校验 Creem 优惠码，避免把无效格式提交到支付平台。 */
export function normalizeCreemDiscountCode(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";

  const code = value.trim().toUpperCase();
  if (!code) return "";
  if (!/^[A-Z0-9]{1,14}$/.test(code)) {
    throw new Error("Creem 优惠码格式无效：仅支持 1-14 位大写字母或数字。");
  }
  return code;
}
