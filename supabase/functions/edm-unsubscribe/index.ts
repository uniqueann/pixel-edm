import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { verifyUnsubscribeToken } from "../_shared/unsubscribe-token.ts";

type EntryPoint = "public_page" | "one_click";

const responseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders,
  });
}

function publicError(status: number) {
  return json(
    { error: status === 503 ? "暂时无法处理，请稍后重试" : "退订链接无效" },
    status,
  );
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "POST")
    return json({ error: "请求方式无效" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const keyringSource = Deno.env.get("EDM_UNSUBSCRIBE_KEYRING");
  if (!supabaseUrl || !serviceRoleKey || !keyringSource)
    return publicError(503);

  const token = request.headers.get("x-edm-unsubscribe-token") ?? "";
  let claims;
  try {
    claims = await verifyUnsubscribeToken({ keyringSource, token });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "UNSUBSCRIBE_KEYRING_INVALID"
    )
      return publicError(503);
    return publicError(404);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "edm" },
  });
  if (request.method === "GET") {
    const { data, error } = await admin.rpc("resolve_public_unsubscribe", {
      payload: { task_id: claims.taskId },
    });
    if (error) {
      if (/UNSUBSCRIBE_NOT_FOUND/.test(error.message)) return publicError(404);
      return publicError(503);
    }
    return json(data);
  }

  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 2048) return publicError(404);
  let entrypoint: EntryPoint;
  try {
    const body = (await request.json()) as { entrypoint?: unknown };
    if (body.entrypoint !== "public_page" && body.entrypoint !== "one_click")
      return publicError(404);
    entrypoint = body.entrypoint;
  } catch {
    return publicError(404);
  }
  const { data, error } = await admin.rpc("apply_public_unsubscribe", {
    payload: {
      task_id: claims.taskId,
      entrypoint,
      key_id: claims.keyId,
    },
  });
  if (error) {
    if (/UNSUBSCRIBE_(NOT_FOUND|INVALID)/.test(error.message))
      return publicError(404);
    return publicError(503);
  }
  return json(data);
});
