import { NextResponse } from "next/server";
import { getDodoClient } from "@/lib/billing/dodo";
import { handleDodoEdmEvent } from "@/lib/billing/dodo-webhook";
import { hasServiceRoleEnv } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasServiceRoleEnv()) {
    return NextResponse.json(
      { ok: false, error: "Supabase 服务端密钥未配置。" },
      { status: 500 },
    );
  }

  const webhookId = request.headers.get("webhook-id");
  const webhookSignature = request.headers.get("webhook-signature");
  const webhookTimestamp = request.headers.get("webhook-timestamp");

  if (!webhookId || !webhookSignature || !webhookTimestamp) {
    return NextResponse.json(
      { ok: false, error: "Dodo webhook 签名头缺失。" },
      { status: 401 },
    );
  }

  let client: ReturnType<typeof getDodoClient>;
  try {
    client = getDodoClient({ includeWebhookKey: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dodo webhook key 未配置。";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const body = await request.text();
  let event;
  try {
    event = client.webhooks.unwrap(body, {
      headers: {
        "webhook-id": webhookId,
        "webhook-signature": webhookSignature,
        "webhook-timestamp": webhookTimestamp,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dodo webhook 签名校验失败。";
    return NextResponse.json({ ok: false, error: message }, { status: 401 });
  }

  try {
    await handleDodoEdmEvent(event, webhookId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dodo webhook 处理失败。";
    console.error("[pixel-edm] Dodo webhook", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
