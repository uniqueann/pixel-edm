const headerOrder = [
  "x-eventbridge-signature-timestamp",
  "x-eventbridge-hash-method",
  "x-eventbridge-signature-version",
  "x-eventbridge-signature-url",
  "x-eventbridge-signature-token",
];

/**
 * @typedef {{
 * "x-eventbridge-signature-timestamp": string,
 * "x-eventbridge-hash-method": string,
 * "x-eventbridge-signature-version": string,
 * "x-eventbridge-signature-url": string,
 * "x-eventbridge-signature-token": string,
 * "x-eventbridge-signature-v2": string
 * }} EventBridgeHeaders
 */

/** @returns {EventBridgeHeaders} */
export function readEventBridgeHeaders(headers) {
  const values = Object.fromEntries(
    headerOrder.map((name) => [name, headers.get(name) ?? ""]),
  );
  const signature = headers.get("x-eventbridge-signature-v2") ?? "";
  if (
    !signature ||
    !values["x-eventbridge-signature-timestamp"] ||
    values["x-eventbridge-hash-method"] !== "SHA256" ||
    values["x-eventbridge-signature-version"] !== "1.0" ||
    !values["x-eventbridge-signature-url"] ||
    !values["x-eventbridge-signature-token"]
  ) {
    throw new Error("EVENTBRIDGE_HEADERS_INVALID");
  }
  return /** @type {EventBridgeHeaders} */ ({
    ...values,
    "x-eventbridge-signature-v2": signature,
  });
}

export function assertEventBridgeTimestamp(timestamp, now = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isSafeInteger(value) || Math.abs(now - value) > 60_000)
    throw new Error("EVENTBRIDGE_TIMESTAMP_EXPIRED");
}

export function assertEventBridgeCertificateUrl(source, region) {
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("EVENTBRIDGE_CERTIFICATE_URL_INVALID");
  }
  const expectedHost = `${region}-eventbridge.oss-accelerate.aliyuncs.com`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHost ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/x509_public_certificate_[A-Za-z0-9._-]+\.pem$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error("EVENTBRIDGE_CERTIFICATE_URL_INVALID");
  }
  return url;
}

export function buildEventBridgeStringToSign(url, headers, rawBody) {
  const fixedHeaders = headerOrder
    .filter((name) => headers[name])
    .map((name) => `${name}: ${headers[name]}`)
    .join("\n");
  return `${url}\n${fixedHeaders}\n${rawBody}`;
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function verifyEventBridgeSignature({
  publicKey,
  signature,
  stringToSign,
}) {
  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    decodeBase64(signature),
    new TextEncoder().encode(stringToSign),
  );
}

export async function sha256Hex(value) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
