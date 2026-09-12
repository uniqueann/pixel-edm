import { withSupabase } from "npm:@supabase/server@1.6.0";
import {
  openCredentialEnvelope,
  type CredentialEnvelope,
} from "../_shared/credential-envelope.ts";
import {
  classifyDirectMailError,
  sendDirectMailTest,
} from "../_shared/directmail.ts";

type TestAttempt = {
  id: string;
  workspace_id: string;
  channel_id: string;
  status: "pending" | "processing" | "accepted" | "failed" | "unknown";
  recipient_hint?: string;
  provider_request_hint?: string;
  provider_event_hint?: string;
  error_category?: string;
  error_code?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
};

type Claim = {
  attempt: TestAttempt;
  claim_acquired: boolean;
  recipient_email?: string;
  channel?: {
    id: string;
    region: string;
    sender_address: string;
    sender_alias: string;
    reply_to_address?: string;
    channel_version: number;
    credential_version: number;
  };
  credential?: CredentialEnvelope;
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function validUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

const handler = {
  fetch: withSupabase(
    { auth: "user", errors: { detailed: false } },
    async (request, context) => {
      if (request.method !== "POST")
        return json({ error: "请求方式无效" }, 405);
      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        return json({ error: "请求内容无效" }, 400);
      }
      if (
        !validUuid(body.workspace_id) ||
        !validUuid(body.channel_id) ||
        !validUuid(body.attempt_id) ||
        !validUuid(body.idempotency_key) ||
        !Number.isInteger(body.expected_version) ||
        Number(body.expected_version) < 1
      )
        return json({ error: "测试发送参数无效" }, 400);

      const { data: authData, error: authError } =
        await context.supabase.auth.getUser();
      const recipientEmail = authData.user?.email;
      if (authError || !recipientEmail || !authData.user.email_confirmed_at)
        return json({ error: "登录邮箱尚未验证" }, 400);

      const { data: prepared, error: prepareError } = await context.supabase
        .schema("edm")
        .rpc("prepare_delivery_test", { payload: body });
      if (prepareError) return json({ error: "无法开始测试发送" }, 400);
      const preparation = prepared as {
        attempt: TestAttempt;
        is_new: boolean;
      };
      if (!preparation.is_new)
        return json({ data: preparation.attempt, reused: true });

      const { data: claimed, error: claimError } = await context.supabaseAdmin
        .schema("edm")
        .rpc("worker_claim_delivery_test", {
          payload: {
            workspace_id: body.workspace_id,
            attempt_id: body.attempt_id,
            recipient_email: recipientEmail,
          },
        });
      if (claimError) return json({ error: "无法领取测试发送任务" }, 500);
      const claim = claimed as Claim;
      if (!claim.claim_acquired)
        return json({ data: claim.attempt, reused: true });
      if (!claim.channel || !claim.credential || !claim.recipient_email)
        return json({ error: "测试发送任务不完整" }, 500);

      let completion: Record<string, unknown>;
      try {
        const keyringSource = Deno.env.get("EDM_CREDENTIAL_KEYRING");
        if (!keyringSource) throw new Error("CREDENTIAL_KEYRING_MISSING");
        const credentials = await openCredentialEnvelope({
          keyringSource,
          context: {
            workspaceId: claim.attempt.workspace_id,
            channelId: claim.channel.id,
            credentialVersion: claim.channel.credential_version,
          },
          envelope: claim.credential,
        });
        const receipt = await sendDirectMailTest({
          ...credentials,
          region: claim.channel.region,
          senderAddress: claim.channel.sender_address,
          senderAlias: claim.channel.sender_alias,
          replyToAddress: claim.channel.reply_to_address,
          recipientEmail: claim.recipient_email,
        });
        completion = {
          workspace_id: body.workspace_id,
          attempt_id: body.attempt_id,
          status: "accepted",
          provider_request_id: receipt.requestId,
          provider_event_id: receipt.eventId,
        };
      } catch (error) {
        const failure = classifyDirectMailError(error);
        const stackFrame =
          error instanceof Error
            ? error.stack
                ?.split("\n")
                .slice(1, 3)
                .map((line) => line.trim())
                .join(" | ")
            : undefined;
        console.error("[edm-directmail-test] DirectMail 调用失败", {
          attempt_id: body.attempt_id,
          error_name: error instanceof Error ? error.name : typeof error,
          error_code: failure.error_code,
          stack_frame: stackFrame,
        });
        completion = {
          workspace_id: body.workspace_id,
          attempt_id: body.attempt_id,
          ...failure,
        };
      }

      const { data: completed, error: completeError } =
        await context.supabaseAdmin
          .schema("edm")
          .rpc("worker_complete_delivery_test", { payload: completion });
      if (completeError) return json({ error: "测试发送结果保存失败" }, 500);
      return json({ data: completed });
    },
  ),
};

export default handler;
