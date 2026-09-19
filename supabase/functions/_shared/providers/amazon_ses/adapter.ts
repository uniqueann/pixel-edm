import {
  SESv2Client,
  SendEmailCommand,
} from "npm:@aws-sdk/client-sesv2@3.1136.0";
import { buildSesSendEmailInput } from "./request.ts";
import { parseSesEvent } from "./event.ts";
import { verifySesWebhook } from "./webhook.ts";
import type {
  DeliveryAdapter,
  DeliveryFailure,
  DeliverySendInput,
} from "../types.ts";

function safeCode(error: unknown) {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const source =
    typeof candidate.name === "string"
      ? candidate.name
      : typeof candidate.code === "string"
        ? candidate.code
        : typeof candidate.$metadata?.httpStatusCode === "number"
          ? `HTTP_${candidate.$metadata.httpStatusCode}`
          : "UNKNOWN";
  return source.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 100) || "UNKNOWN";
}

export function classifySesError(error: unknown): DeliveryFailure {
  const code = safeCode(error);
  const normalized = code.toLowerCase();
  if (
    /credential|unrecognizedclient|invalidsignature|accessdenied|unauthorized|expiredtoken/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "authentication",
      error_code: code,
    };
  if (
    /mailfromdomainnotverified|notfound|badrequest|sendingpaused|accountsuspended|configuration|region/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "configuration",
      error_code: code,
    };
  if (/toomanyrequests|limitexceeded|throttl|quota/.test(normalized))
    return { status: "failed", error_category: "rate_limit", error_code: code };
  if (/timeout|network|socket|connection|abort|requestaborted/.test(normalized))
    return { status: "unknown", error_category: "unknown", error_code: code };
  if (/serviceunavailable|internal|temporar|http_5/.test(normalized))
    return { status: "failed", error_category: "temporary", error_code: code };
  if (/messagerejected|rejected|invalid|unsupported/.test(normalized))
    return { status: "failed", error_category: "permanent", error_code: code };
  return { status: "failed", error_category: "unknown", error_code: code };
}

export async function sendSes(input: DeliverySendInput) {
  const region = input.providerConfig.region;
  if (
    typeof region !== "string" ||
    !/^[a-z]{2}(-gov)?-[a-z]+-[0-9]$/.test(region)
  )
    throw new Error("REGION_UNSUPPORTED");
  const configurationSetName = input.providerConfig.configuration_set_name;
  if (
    configurationSetName !== undefined &&
    typeof configurationSetName !== "string"
  )
    throw new Error("SES_CONFIGURATION_SET_INVALID");

  const client = new SESv2Client({
    region,
    credentials: {
      accessKeyId: input.credentials.accessKeyId,
      secretAccessKey: input.credentials.accessKeySecret,
      sessionToken: input.credentials.sessionToken,
    },
    maxAttempts: 1,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await client.send(
      new SendEmailCommand(
        buildSesSendEmailInput({
          senderAddress: input.senderAddress,
          senderAlias: input.senderAlias,
          replyToAddress: input.replyToAddress,
          recipientEmail: input.recipientEmail,
          subject: input.subject,
          textBody: input.textBody,
          htmlBody: input.htmlBody,
          trackingEnabled: input.trackingEnabled,
          configurationSetName:
            typeof configurationSetName === "string"
              ? configurationSetName
              : undefined,
          headers: input.headers,
        }),
      ),
      { abortSignal: controller.signal },
    );
    const providerRequestId = response.$metadata.requestId;
    const providerAcceptanceId = response.MessageId;
    if (!providerRequestId || !providerAcceptanceId)
      throw new Error("PROVIDER_RECEIPT_INCOMPLETE");
    return { providerRequestId, providerAcceptanceId };
  } finally {
    clearTimeout(timeout);
    client.destroy();
  }
}

export const sesAdapter: DeliveryAdapter = {
  provider: "amazon_ses",
  capabilities: {
    supportsOpenTracking: true,
    supportsClickTracking: true,
    requiresHtmlForTracking: true,
    supportsLinkTrackingOptOut: true,
    requiresWebhookSubscriptionConfirmation: true,
  },
  send: sendSes,
  classifyError: classifySesError,
  parseWebhookEvent: parseSesEvent,
  verifyWebhookSignature: verifySesWebhook,
};
