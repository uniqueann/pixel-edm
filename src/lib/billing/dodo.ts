import DodoPayments from "dodopayments";
import type { EdmBilledPlan } from "./metadata";

export function getDodoApiKey() {
  const key = process.env.DODO_PAYMENTS_API_KEY?.trim();
  if (!key) throw new Error("DODO_PAYMENTS_API_KEY 未配置。");
  return key;
}

export function getDodoWebhookKey() {
  const key = process.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim();
  if (!key) throw new Error("DODO_PAYMENTS_WEBHOOK_KEY 未配置。");
  return key;
}

export function getDodoEdmProductId(
  plan: EdmBilledPlan,
  interval: "monthly" | "yearly",
) {
  const envKey =
    plan === "team"
      ? interval === "yearly"
        ? "DODO_EDM_TEAM_YEARLY_PRODUCT_ID"
        : "DODO_EDM_TEAM_MONTHLY_PRODUCT_ID"
      : interval === "yearly"
        ? "DODO_EDM_PRO_YEARLY_PRODUCT_ID"
        : "DODO_EDM_PRO_MONTHLY_PRODUCT_ID";
  const id = process.env[envKey]?.trim();
  if (!id) throw new Error(`${envKey} 未配置。`);
  return id;
}

export function getDodoEnvironment() {
  const configured = process.env.DODO_PAYMENTS_ENVIRONMENT?.trim();
  if (configured === "test_mode" || configured === "live_mode") {
    return configured;
  }
  if (configured) {
    throw new Error(
      "DODO_PAYMENTS_ENVIRONMENT 必须是 test_mode 或 live_mode。",
    );
  }
  return process.env.NODE_ENV !== "production" ? "test_mode" : "live_mode";
}

export function getDodoClient(options: { includeWebhookKey?: boolean } = {}) {
  return new DodoPayments({
    bearerToken: getDodoApiKey(),
    webhookKey: options.includeWebhookKey ? getDodoWebhookKey() : null,
    environment: getDodoEnvironment(),
    baseURL: null,
  });
}
