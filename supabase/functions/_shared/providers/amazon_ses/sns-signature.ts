export type SnsEnvelope = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
};

function requiredString(
  value: Record<string, unknown>,
  key: keyof SnsEnvelope,
) {
  const result = value[key];
  if (typeof result !== "string" || !result.trim())
    throw new Error("SNS_ENVELOPE_INVALID");
  return result.trim();
}

export function parseSnsEnvelope(input: unknown): SnsEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("SNS_ENVELOPE_INVALID");
  const value = input as Record<string, unknown>;
  const type = requiredString(value, "Type");
  if (
    type !== "Notification" &&
    type !== "SubscriptionConfirmation" &&
    type !== "UnsubscribeConfirmation"
  )
    throw new Error("SNS_MESSAGE_TYPE_UNSUPPORTED");
  const envelope: SnsEnvelope = {
    Type: type,
    MessageId: requiredString(value, "MessageId"),
    TopicArn: requiredString(value, "TopicArn"),
    Message: requiredString(value, "Message"),
    Timestamp: requiredString(value, "Timestamp"),
    SignatureVersion: requiredString(value, "SignatureVersion"),
    Signature: requiredString(value, "Signature"),
    SigningCertURL: requiredString(value, "SigningCertURL"),
  };
  if (typeof value.Subject === "string" && value.Subject)
    envelope.Subject = value.Subject;
  if (type !== "Notification") {
    envelope.Token = requiredString(value, "Token");
    envelope.SubscribeURL = requiredString(value, "SubscribeURL");
  }
  return envelope;
}

export function assertSnsTimestamp(source: string, now = Date.now()) {
  const value = new Date(source).getTime();
  if (!Number.isFinite(value) || Math.abs(now - value) > 5 * 60 * 1_000)
    throw new Error("SNS_TIMESTAMP_EXPIRED");
}

export function assertSnsCertificateUrl(source: string, region: string) {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("SNS_CERTIFICATE_URL_INVALID");
  }
  const suffix = region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  const expectedHost = `sns.${region}.${suffix}`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHost ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("SNS_CERTIFICATE_URL_INVALID");
  return url;
}

export function assertSnsTopicArn(topicArn: string, expected: string) {
  if (!expected || topicArn !== expected)
    throw new Error("SNS_TOPIC_ARN_MISMATCH");
}

export function buildSnsStringToSign(envelope: SnsEnvelope) {
  const fields =
    envelope.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : [
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ];
  let result = "";
  for (const field of fields) {
    const value = envelope[field as keyof SnsEnvelope];
    if (typeof value === "string" && value) result += `${field}\n${value}\n`;
  }
  return result;
}

function base64Bytes(value: string) {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("SNS_SIGNATURE_INVALID");
  }
}

export async function verifySnsSignature(
  publicKey: CryptoKey,
  envelope: SnsEnvelope,
) {
  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    base64Bytes(envelope.Signature),
    new TextEncoder().encode(buildSnsStringToSign(envelope)),
  );
}

export function assertSnsSubscribeUrl(source: string, region: string) {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("SNS_SUBSCRIBE_URL_INVALID");
  }
  const suffix = region.startsWith("cn-")
    ? "amazonaws.com.cn"
    : "amazonaws.com";
  if (
    url.protocol !== "https:" ||
    url.hostname !== `sns.${region}.${suffix}` ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.hash ||
    url.searchParams.get("Action") !== "ConfirmSubscription" ||
    !url.searchParams.get("Token") ||
    !url.searchParams.get("TopicArn")
  )
    throw new Error("SNS_SUBSCRIBE_URL_INVALID");
  return url;
}
