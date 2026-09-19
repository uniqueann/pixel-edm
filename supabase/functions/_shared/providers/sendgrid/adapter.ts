import {
  buildSendGridMailPayload,
  resolveSendGridApiBaseUrl,
} from "./request.ts";
import { parseSendGridEvent } from "./event.ts";
import { verifySendGridWebhook } from "./webhook.ts";
import { classifySendGridError, sendGridHttpError } from "./error.ts";
import type { DeliveryAdapter, DeliverySendInput } from "../types.ts";

export { classifySendGridError } from "./error.ts";

export async function sendSendGrid(input: DeliverySendInput) {
  const apiBase = resolveSendGridApiBaseUrl(input.providerConfig.api_host);
  const payload = buildSendGridMailPayload({
    senderAddress: input.senderAddress,
    senderAlias: input.senderAlias,
    replyToAddress: input.replyToAddress,
    recipientEmail: input.recipientEmail,
    subject: input.subject,
    textBody: input.textBody,
    htmlBody: input.htmlBody,
    trackingEnabled: input.trackingEnabled,
    headers: input.headers,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${apiBase}/v3/mail/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.credentials.accessKeySecret}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.status !== 202) {
      let errorCode: string | undefined;
      try {
        const body = (await response.json()) as {
          errors?: { message?: string }[];
        };
        errorCode = body.errors?.[0]?.message?.slice(0, 80);
      } catch {
        errorCode = undefined;
      }
      throw sendGridHttpError(response.status, errorCode);
    }
    const providerMessageId = response.headers.get("x-message-id")?.trim();
    if (!providerMessageId) throw new Error("PROVIDER_RECEIPT_INCOMPLETE");
    return {
      providerRequestId: providerMessageId,
      providerAcceptanceId: providerMessageId,
      providerMessageId,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const sendGridAdapter: DeliveryAdapter = {
  provider: "sendgrid",
  capabilities: {
    supportsOpenTracking: true,
    supportsClickTracking: true,
    requiresHtmlForTracking: true,
    supportsLinkTrackingOptOut: true,
    requiresWebhookSubscriptionConfirmation: false,
  },
  send: sendSendGrid,
  classifyError: classifySendGridError,
  parseWebhookEvent: parseSendGridEvent,
  verifyWebhookSignature: verifySendGridWebhook,
};
