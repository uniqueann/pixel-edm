import type { VerifiedWebhook, VerifyWebhookInput } from "../types.ts";

const signatureHeader = "x-twilio-email-event-webhook-signature";
const timestampHeader = "x-twilio-email-event-webhook-timestamp";
const maximumTimestampSkewMs = 5 * 60 * 1_000;

type StarkbankEcdsa = {
  Ecdsa: {
    verify: (
      message: string,
      signature: { toBase64?: () => string },
      publicKey: unknown,
    ) => boolean;
  };
  PublicKey: { fromPem: (pem: string) => unknown };
  Signature: { fromBase64: (value: string) => unknown };
};

async function loadStarkbankEcdsa(): Promise<StarkbankEcdsa> {
  if (typeof Deno !== "undefined") {
    return (await import("npm:starkbank-ecdsa@1.2.0")) as StarkbankEcdsa;
  }
  return (await import("starkbank-ecdsa")) as StarkbankEcdsa;
}

function assertTimestamp(timestamp: string, now = Date.now()) {
  if (!/^\d{1,16}$/.test(timestamp))
    throw new Error("SENDGRID_TIMESTAMP_INVALID");
  const parsed = Number(timestamp) * 1_000;
  if (!Number.isFinite(parsed)) throw new Error("SENDGRID_TIMESTAMP_INVALID");
  if (Math.abs(now - parsed) > maximumTimestampSkewMs)
    throw new Error("SENDGRID_TIMESTAMP_EXPIRED");
}

function normalizePublicKeyPem(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("SENDGRID_WEBHOOK_KEY_MISSING");
  return trimmed.includes("BEGIN PUBLIC KEY")
    ? trimmed
    : `-----BEGIN PUBLIC KEY-----\n${trimmed}\n-----END PUBLIC KEY-----`;
}

export async function verifySendGridWebhookSignature(input: {
  publicKeyPem: string;
  rawBody: string;
  signature: string;
  timestamp: string;
  now?: number;
}) {
  assertTimestamp(input.timestamp, input.now);
  const { Ecdsa, PublicKey, Signature } = await loadStarkbankEcdsa();
  const publicKey = PublicKey.fromPem(
    normalizePublicKeyPem(input.publicKeyPem),
  );
  const signedPayload = `${input.timestamp}${input.rawBody}`;
  let decodedSignature: unknown;
  try {
    decodedSignature = Signature.fromBase64(input.signature);
  } catch {
    throw new Error("SENDGRID_SIGNATURE_INVALID");
  }
  if (!Ecdsa.verify(signedPayload, decodedSignature, publicKey))
    throw new Error("SENDGRID_SIGNATURE_INVALID");
}

export async function verifySendGridWebhook(
  input: VerifyWebhookInput,
): Promise<VerifiedWebhook> {
  const signature = input.headers.get(signatureHeader);
  const timestamp = input.headers.get(timestampHeader);
  if (!signature || !timestamp)
    throw new Error("SENDGRID_SIGNATURE_HEADERS_MISSING");

  const publicKeyPem =
    typeof input.providerConfig.event_webhook_public_key === "string"
      ? input.providerConfig.event_webhook_public_key.trim()
      : "";
  await verifySendGridWebhookSignature({
    publicKeyPem,
    rawBody: input.rawBody,
    signature,
    timestamp,
    now: input.now,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    throw new Error("SENDGRID_EVENT_INVALID");
  }
  if (!Array.isArray(parsed) || !parsed.length)
    throw new Error("SENDGRID_EVENT_INVALID");

  return {
    kind: "notification",
    payload: parsed,
  };
}
