import Dm20151123, * as $Dm from "npm:@alicloud/dm20151123@1.11.0";
import * as $OpenApiUtil from "npm:@alicloud/openapi-core@1.0.8/dist/utils.js";
import * as $dara from "npm:@darabonba/typescript@1.0.5";
import { resolveCjsConstructor } from "../../cjs-interop.ts";
import { buildDirectMailRequest } from "./request.ts";
import { parseDirectMailEvent } from "./event.ts";
import { verifyDirectMailWebhook } from "./webhook.ts";
import { classifyDirectMailError } from "./error.ts";
import type { DeliveryAdapter, DeliverySendInput } from "../types.ts";

export { classifyDirectMailError } from "./error.ts";

const allowedRegions = new Set([
  "cn-hangzhou",
  "ap-southeast-1",
  "us-east-1",
  "eu-central-1",
]);

type DirectMailClientConstructor = new (
  config: InstanceType<typeof $OpenApiUtil.Config>,
) => {
  singleSendMailWithOptions(
    request: InstanceType<typeof $Dm.SingleSendMailRequest>,
    runtime: InstanceType<typeof $dara.RuntimeOptions>,
  ): Promise<{
    body?: {
      requestId?: string;
      envId?: string;
    };
  }>;
};

export async function sendDirectMail(input: DeliverySendInput) {
  const region = input.providerConfig.region;
  if (typeof region !== "string" || !allowedRegions.has(region))
    throw new Error("REGION_UNSUPPORTED");
  const trackingTagName = input.providerConfig.tracking_tag_name;
  if (
    input.trackingEnabled &&
    (typeof trackingTagName !== "string" || !trackingTagName)
  )
    throw new Error("TRACKING_TAG_REQUIRED");

  const Config = resolveCjsConstructor<typeof $OpenApiUtil.Config>(
    $OpenApiUtil,
    "Config",
  );
  const RetryOptions = resolveCjsConstructor<typeof $dara.RetryOptions>(
    $dara,
    "RetryOptions",
  );
  const RuntimeOptions = resolveCjsConstructor<typeof $dara.RuntimeOptions>(
    $dara,
    "RuntimeOptions",
  );
  const DirectMailClient =
    resolveCjsConstructor<DirectMailClientConstructor>(Dm20151123);
  const SingleSendMailRequest = resolveCjsConstructor<
    typeof $Dm.SingleSendMailRequest
  >($Dm, "SingleSendMailRequest");

  const config = new Config({
    accessKeyId: input.credentials.accessKeyId,
    accessKeySecret: input.credentials.accessKeySecret,
    regionId: region,
    retryOptions: new RetryOptions({ retryable: false }),
  });
  const client = new DirectMailClient(config);
  const request = new SingleSendMailRequest(
    buildDirectMailRequest({
      senderAddress: input.senderAddress,
      senderAlias: input.senderAlias,
      replyToAddress: input.replyToAddress,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      textBody: input.textBody,
      htmlBody: input.htmlBody,
      trackingTagName: input.trackingEnabled
        ? (trackingTagName as string)
        : undefined,
      headers: input.headers,
    }),
  );
  const runtime = new RuntimeOptions({
    connectTimeout: 10_000,
    readTimeout: 20_000,
    retryOptions: new RetryOptions({ retryable: false }),
  });
  const response = await client.singleSendMailWithOptions(request, runtime);
  const providerRequestId = response.body?.requestId;
  const providerAcceptanceId = response.body?.envId;
  if (!providerRequestId || !providerAcceptanceId)
    throw new Error("PROVIDER_RECEIPT_INCOMPLETE");
  return {
    providerRequestId,
    providerAcceptanceId,
    providerEnvId: providerAcceptanceId,
  };
}

export const directMailAdapter: DeliveryAdapter = {
  provider: "aliyun_directmail",
  capabilities: {
    supportsOpenTracking: true,
    supportsClickTracking: true,
    requiresHtmlForTracking: true,
    supportsLinkTrackingOptOut: true,
    requiresWebhookSubscriptionConfirmation: false,
  },
  send: sendDirectMail,
  classifyError: classifyDirectMailError,
  parseWebhookEvent(input) {
    if (input.kind !== "notification")
      throw new Error("DIRECTMAIL_EVENT_TYPE_UNSUPPORTED");
    return [parseDirectMailEvent(input.payload)];
  },
  verifyWebhookSignature: verifyDirectMailWebhook,
};
