import Dm20151123, * as $Dm from "npm:@alicloud/dm20151123@1.11.0";
import * as $OpenApiUtil from "npm:@alicloud/openapi-core@1.0.8/dist/utils.js";
import * as $dara from "npm:@darabonba/typescript@1.0.5";
import { resolveCjsConstructor } from "./cjs-interop.ts";

export type DirectMailErrorCategory =
  | "authentication"
  | "configuration"
  | "rate_limit"
  | "temporary"
  | "permanent"
  | "unknown";

export type DirectMailFailure = {
  status: "failed" | "unknown";
  error_category: DirectMailErrorCategory;
  error_code: string;
};

const allowedRegions = new Set([
  "cn-hangzhou",
  "ap-southeast-1",
  "us-east-1",
  "eu-central-1",
]);

function safeCode(error: unknown) {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    statusCode?: unknown;
  };
  const source =
    typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.name === "string"
        ? candidate.name
        : typeof candidate.statusCode === "number"
          ? `HTTP_${candidate.statusCode}`
          : "UNKNOWN";
  return source.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 100) || "UNKNOWN";
}

export function classifyDirectMailError(error: unknown): DirectMailFailure {
  const code = safeCode(error);
  const normalized = code.toLowerCase();
  if (
    /invalidaccesskey|signature|forbidden|unauthorized|authentication/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "authentication",
      error_code: code,
    };
  if (
    /account|sender|mailfrom|domain|reply|parameter|invalid.*address|credential|keyring|region/.test(
      normalized,
    )
  )
    return {
      status: "failed",
      error_category: "configuration",
      error_code: code,
    };
  if (/throttl|ratelimit|quota|frequency/.test(normalized))
    return { status: "failed", error_category: "rate_limit", error_code: code };
  if (/timeout|network|socket|connection|abort/.test(normalized))
    return { status: "unknown", error_category: "unknown", error_code: code };
  if (/internal|serviceunavailable|temporar|http_5/.test(normalized))
    return { status: "failed", error_category: "temporary", error_code: code };
  if (/invalid|rejected|denied|unsupported/.test(normalized))
    return { status: "failed", error_category: "permanent", error_code: code };
  return { status: "failed", error_category: "unknown", error_code: code };
}

export async function sendDirectMailTest(input: {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  senderAddress: string;
  senderAlias: string;
  replyToAddress?: string | null;
  recipientEmail: string;
}) {
  if (!allowedRegions.has(input.region)) throw new Error("REGION_UNSUPPORTED");
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
  const DirectMailClient = resolveCjsConstructor<typeof Dm20151123>(Dm20151123);
  const SingleSendMailRequest = resolveCjsConstructor<
    typeof $Dm.SingleSendMailRequest
  >($Dm, "SingleSendMailRequest");

  const config = new Config({
    accessKeyId: input.accessKeyId,
    accessKeySecret: input.accessKeySecret,
    regionId: input.region,
    retryOptions: new RetryOptions({ retryable: false }),
  });
  const client = new DirectMailClient(config);
  const request = new SingleSendMailRequest({
    accountName: input.senderAddress,
    addressType: 1,
    replyToAddress: Boolean(input.replyToAddress),
    replyAddress: input.replyToAddress || undefined,
    toAddress: input.recipientEmail,
    fromAlias: input.senderAlias,
    subject: "[卖家邮局] DirectMail 发信通道测试",
    textBody:
      "这是一封由卖家邮局发送的 DirectMail 通道测试邮件。收到此邮件表示 AccessKey、区域与发件身份已通过实际发送验证。",
    clickTrace: "0",
    unSubscribeLinkType: "disabled",
    unSubscribeFilterLevel: "disabled",
  });
  const runtime = new RuntimeOptions({
    connectTimeout: 10_000,
    readTimeout: 20_000,
    retryOptions: new RetryOptions({ retryable: false }),
  });
  const response = await client.singleSendMailWithOptions(request, runtime);
  const requestId = response.body?.requestId;
  const eventId = response.body?.envId;
  if (!requestId || !eventId) throw new Error("PROVIDER_RECEIPT_INCOMPLETE");
  return { requestId, eventId };
}
