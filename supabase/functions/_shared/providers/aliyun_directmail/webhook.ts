import { importX509 } from "npm:jose@6.1.0";
import {
  assertEventBridgeCertificateUrl,
  assertEventBridgeTimestamp,
  buildEventBridgeStringToSign,
  readEventBridgeHeaders,
  verifyEventBridgeSignature,
} from "../../eventbridge-signature.mjs";
import type { VerifiedWebhook, VerifyWebhookInput } from "../types.ts";

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
      throw new Error("EVENTBRIDGE_CERTIFICATE_TOO_LARGE");
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
    if (!response.ok) throw new Error("EVENTBRIDGE_CERTIFICATE_FETCH_FAILED");
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > maximumCertificateBytes)
      throw new Error("EVENTBRIDGE_CERTIFICATE_TOO_LARGE");
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

export async function verifyDirectMailWebhook(
  input: VerifyWebhookInput,
): Promise<VerifiedWebhook> {
  const headers = readEventBridgeHeaders(input.headers);
  assertEventBridgeTimestamp(
    headers["x-eventbridge-signature-timestamp"],
    input.now,
  );
  const region = input.providerConfig.region;
  if (typeof region !== "string") throw new Error("EVENTBRIDGE_REGION_INVALID");
  const certificateUrl = assertEventBridgeCertificateUrl(
    headers["x-eventbridge-signature-url"],
    region,
  );
  const publicKey = await certificateKey(
    certificateUrl,
    input.fetcher ?? fetch,
  );
  const candidateUrls = [
    ...new Set([input.requestUrl, ...(input.canonicalUrls ?? [])]),
  ];
  const candidateStrings = candidateUrls.flatMap((url) =>
    [true, false].flatMap((includeToken) =>
      [true, false].map((trailingNewline) =>
        buildEventBridgeStringToSign(url, headers, input.rawBody, {
          includeToken,
          trailingNewline,
        }),
      ),
    ),
  );
  for (const stringToSign of candidateStrings) {
    if (
      await verifyEventBridgeSignature({
        publicKey,
        signature: headers["x-eventbridge-signature-v2"],
        stringToSign,
      })
    ) {
      return {
        kind: "notification",
        payload: JSON.parse(input.rawBody),
      };
    }
  }
  throw new Error("EVENTBRIDGE_SIGNATURE_INVALID");
}
