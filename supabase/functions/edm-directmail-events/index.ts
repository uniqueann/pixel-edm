import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { importX509 } from "jose";
import { parseDirectMailEvent } from "../_shared/directmail-event.ts";
import {
  assertEventBridgeCertificateUrl,
  assertEventBridgeTimestamp,
  buildEventBridgeStringToSign,
  readEventBridgeHeaders,
  sha256Hex,
  verifyEventBridgeSignature,
} from "../_shared/eventbridge-signature.mjs";

const maximumBodyBytes = 256 * 1024;
const certificateCache = new Map<
  string,
  { publicKey: CryptoKey; expiresAt: number }
>();

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

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
      throw new Error("CONTENT_TOO_LARGE");
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

async function certificateKey(url: URL) {
  const cached = certificateCache.get(url.href);
  if (cached && cached.expiresAt > Date.now()) return cached.publicKey;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/x-pem-file,text/plain" },
    });
    if (!response.ok) throw new Error("EVENTBRIDGE_CERTIFICATE_FETCH_FAILED");
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > 32 * 1024)
      throw new Error("EVENTBRIDGE_CERTIFICATE_TOO_LARGE");
    const certificate = new TextDecoder("utf-8", { fatal: true }).decode(
      await readLimitedBytes(response.body, 32 * 1024),
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

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "请求方式无效" }, 405);
  const requestUrl = new URL(request.url);
  const channelId = requestUrl.searchParams.get("channel_id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(channelId))
    return json({ error: "回执通道无效" }, 400);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maximumBodyBytes)
    return json({ error: "回执内容过大" }, 413);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey)
    return json({ error: "回执服务配置不完整" }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "edm" },
  });

  try {
    const headers = readEventBridgeHeaders(request.headers);
    assertEventBridgeTimestamp(headers["x-eventbridge-signature-timestamp"]);
    const token = headers["x-eventbridge-signature-token"];
    const tokenDigest = await sha256Hex(token);
    const { data: channel, error: authorizationError } = await admin.rpc(
      "webhook_authorize_delivery_event",
      { payload: { channel_id: channelId, token_digest: tokenDigest } },
    );
    if (authorizationError || !channel)
      return json({ error: "回执鉴权失败" }, 401);

    const rawBytes = await readLimitedBytes(request.body, maximumBodyBytes);
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
    const certificateUrl = assertEventBridgeCertificateUrl(
      headers["x-eventbridge-signature-url"],
      (channel as { region: string }).region,
    );
    const publicKey = await certificateKey(certificateUrl);
    const verified = await verifyEventBridgeSignature({
      publicKey,
      signature: headers["x-eventbridge-signature-v2"],
      stringToSign: buildEventBridgeStringToSign(request.url, headers, rawBody),
    });
    if (!verified) return json({ error: "回执签名无效" }, 401);

    const normalized = parseDirectMailEvent(JSON.parse(rawBody));
    if (
      normalized.region &&
      normalized.region !== (channel as { region: string }).region
    ) {
      return json({ error: "回执区域不匹配" }, 400);
    }
    if (
      normalized.sender_address &&
      normalized.sender_address !==
        (channel as { sender_address: string }).sender_address
    ) {
      return json({ error: "回执发件地址不匹配" }, 400);
    }
    if (!normalized.provider_event_id)
      return json({ error: "回执事件标识缺失" }, 400);

    const payloadSha256 = await sha256Hex(rawBytes);
    const { data, error } = await admin.rpc("webhook_ingest_delivery_event", {
      payload: {
        channel_id: channelId,
        token_digest: tokenDigest,
        payload_sha256: payloadSha256,
        ...normalized,
      },
    });
    if (error) {
      if (error.message.includes("WEBHOOK_EVENT_ID_CONFLICT"))
        return json({ error: "回执事件标识冲突" }, 409);
      if (error.message.includes("WEBHOOK_UNAUTHORIZED"))
        return json({ error: "回执鉴权失败" }, 401);
      console.error("[edm-directmail-events] 回执入库失败", {
        error_code: error.code,
      });
      return json({ error: "回执暂时无法处理" }, 500);
    }
    return json({ received: true, data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = code.includes("TOO_LARGE")
      ? 413
      : code.includes("JSON")
        ? 400
        : 401;
    console.error("[edm-directmail-events] 回执校验失败", {
      error_code: code.slice(0, 100),
    });
    return json(
      { error: status === 401 ? "回执鉴权失败" : "回执格式无效" },
      status,
    );
  }
});
