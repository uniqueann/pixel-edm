import { importX509 } from "npm:jose@6.1.0";
import type { VerifiedWebhook, VerifyWebhookInput } from "../types.ts";
import {
  assertSnsCertificateUrl,
  assertSnsSubscribeUrl,
  assertSnsTimestamp,
  assertSnsTopicArn,
  buildSnsStringToSign,
  parseSnsEnvelope,
} from "./sns-signature.ts";

const maximumCertificateBytes = 32 * 1024;
const certificateCache = new Map<
  string,
  { publicKey: CryptoKey; expiresAt: number }
>();

async function readLimitedBytes(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("SNS_CERTIFICATE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function certificateKey(url: URL, fetcher: typeof fetch) {
  const cached = certificateCache.get(url.href);
  if (cached && cached.expiresAt > Date.now()) return cached.publicKey;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetcher(url, {
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/x-pem-file,text/plain" },
    });
    if (!response.ok) throw new Error("SNS_CERTIFICATE_FETCH_FAILED");
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > maximumCertificateBytes)
      throw new Error("SNS_CERTIFICATE_TOO_LARGE");
    const certificate = new TextDecoder("utf-8", { fatal: true }).decode(
      await readLimitedBytes(response.body, maximumCertificateBytes),
    );
    const publicKey = await importX509(certificate, "RS256");
    certificateCache.set(url.href, {
      publicKey,
      expiresAt: Date.now() + 6 * 60 * 60 * 1_000,
    });
    return publicKey;
  } finally {
    clearTimeout(timeout);
  }
}

function base64Bytes(value: string) {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("SNS_SIGNATURE_INVALID");
  }
}

function assertSnsHeaders(
  headers: Headers,
  envelope: ReturnType<typeof parseSnsEnvelope>,
) {
  const checks = [
    ["x-amz-sns-message-type", envelope.Type],
    ["x-amz-sns-message-id", envelope.MessageId],
    ["x-amz-sns-topic-arn", envelope.TopicArn],
  ] as const;
  for (const [name, expected] of checks) {
    const actual = headers.get(name);
    if (actual && actual !== expected) throw new Error("SNS_HEADERS_MISMATCH");
  }
}

export async function verifySesWebhook(
  input: VerifyWebhookInput,
): Promise<VerifiedWebhook> {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(input.rawBody);
  } catch {
    throw new Error("SNS_ENVELOPE_INVALID");
  }
  const envelope = parseSnsEnvelope(parsedBody);
  if (envelope.SignatureVersion !== "2")
    throw new Error("SNS_SIGNATURE_VERSION_UNSUPPORTED");
  assertSnsHeaders(input.headers, envelope);
  assertSnsTimestamp(envelope.Timestamp, input.now);

  const region = input.providerConfig.region;
  const topicArn = input.providerConfig.sns_topic_arn;
  if (typeof region !== "string" || typeof topicArn !== "string")
    throw new Error("SNS_PROVIDER_CONFIG_INVALID");
  assertSnsTopicArn(envelope.TopicArn, topicArn);
  const certificateUrl = assertSnsCertificateUrl(
    envelope.SigningCertURL,
    region,
  );
  const publicKey = await certificateKey(
    certificateUrl,
    input.fetcher ?? fetch,
  );
  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    base64Bytes(envelope.Signature),
    new TextEncoder().encode(buildSnsStringToSign(envelope)),
  );
  if (!valid) throw new Error("SNS_SIGNATURE_INVALID");

  if (envelope.Type === "SubscriptionConfirmation") {
    const subscribeUrl = assertSnsSubscribeUrl(
      envelope.SubscribeURL ?? "",
      region,
    );
    if (subscribeUrl.searchParams.get("TopicArn") !== topicArn)
      throw new Error("SNS_TOPIC_ARN_MISMATCH");
    return {
      kind: "subscription_confirmation",
      providerEventId: envelope.MessageId,
      subscribeUrl: subscribeUrl.href,
      topicArn,
      payload: envelope,
    };
  }
  if (envelope.Type !== "Notification")
    throw new Error("SNS_MESSAGE_TYPE_UNSUPPORTED");

  let message: unknown;
  try {
    message = JSON.parse(envelope.Message);
  } catch {
    throw new Error("SES_EVENT_INVALID");
  }
  return {
    kind: "notification",
    providerEventId: envelope.MessageId,
    payload: message,
  };
}
