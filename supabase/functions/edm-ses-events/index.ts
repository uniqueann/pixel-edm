import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { sesAdapter } from "../_shared/providers/amazon_ses/adapter.ts";
import { sha256Hex } from "../_shared/eventbridge-signature.mjs";

const maximumBodyBytes = 256 * 1024;

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

async function confirmSubscription(subscribeUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(subscribeUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "text/plain,application/xml" },
    });
    if (!response.ok) throw new Error("SNS_SUBSCRIPTION_CONFIRMATION_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "请求方式无效" }, 405);
  const requestUrl = new URL(request.url);
  const channelId = requestUrl.searchParams.get("channel_id") ?? "";
  const token =
    requestUrl.searchParams.get("token") ??
    request.headers.get("x-edm-webhook-token") ??
    "";
  if (!/^[0-9a-f-]{36}$/i.test(channelId) || token.length < 32)
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
    const tokenDigest = await sha256Hex(token);
    const { data: channel, error: authorizationError } = await admin.rpc(
      "webhook_authorize_delivery_event",
      { payload: { channel_id: channelId, token_digest: tokenDigest } },
    );
    if (authorizationError || !channel)
      return json({ error: "回执鉴权失败" }, 401);
    const authorizedChannel = channel as {
      provider: string;
      provider_config: Record<string, unknown>;
      sender_address: string;
    };
    if (authorizedChannel.provider !== "amazon_ses")
      return json({ error: "回执通道类型不匹配" }, 400);

    const rawBytes = await readLimitedBytes(request.body, maximumBodyBytes);
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
    const verified = await sesAdapter.verifyWebhookSignature({
      requestUrl: request.url,
      headers: request.headers,
      rawBody,
      providerConfig: authorizedChannel.provider_config,
    });
    if (verified.kind === "subscription_confirmation") {
      await confirmSubscription(verified.subscribeUrl);
      console.info("[edm-ses-events] SNS 订阅确认完成", {
        channel_id: channelId,
      });
      return json({ received: true, subscription_confirmed: true });
    }

    const normalizedEvents = sesAdapter.parseWebhookEvent(verified);
    const payloadSha256 = await sha256Hex(rawBytes);
    const results = [];
    for (const normalized of normalizedEvents) {
      if (
        normalized.sender_address &&
        normalized.sender_address !== authorizedChannel.sender_address
      )
        return json({ error: "回执发件地址不匹配" }, 400);
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
        console.error("[edm-ses-events] 回执入库失败", {
          channel_id: channelId,
          error_code: error.code,
        });
        return json({ error: "回执暂时无法处理" }, 500);
      }
      results.push(data);
    }
    return json({ received: true, count: results.length, data: results });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = code.includes("TOO_LARGE")
      ? 413
      : /INVALID|UNSUPPORTED|MISMATCH|EXPIRED/.test(code)
        ? 400
        : code.includes("CONFIRMATION_FAILED")
          ? 502
          : 401;
    console.error("[edm-ses-events] 回执校验失败", {
      channel_id: channelId,
      error_code: code.slice(0, 100),
    });
    return json(
      {
        error:
          status === 401
            ? "回执鉴权失败"
            : status === 502
              ? "SNS 订阅确认失败"
              : "回执格式无效",
      },
      status,
    );
  }
});
