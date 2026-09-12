import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { openCredentialEnvelope } from "../_shared/credential-envelope.ts";
import {
  classifyDirectMailError,
  sendDirectMailMessage,
} from "../_shared/directmail.ts";

type CredentialEnvelope = {
  key_id: string;
  nonce: string;
  ciphertext: string;
  credential_version: number;
};

type DeliveryClaim = {
  task_id: string;
  run_id: string;
  workspace_id: string;
  attempt_id: string;
  lease_token: string;
  recipient_email: string;
  subject: string;
  body: string;
  channel: {
    id: string;
    region: string;
    sender_address: string;
    sender_alias: string;
    reply_to_address?: string | null;
    credential_version: number;
  };
  credential: CredentialEnvelope;
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "请求方式无效" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const keyringSource = Deno.env.get("EDM_CREDENTIAL_KEYRING");
  if (!supabaseUrl || !serviceRoleKey || !keyringSource)
    return json({ error: "工作进程配置不完整" }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "edm" },
  });
  const workerToken = request.headers.get("x-edm-worker-token") ?? "";
  const { data: authorized, error: authorizationError } = await admin.rpc(
    "worker_authorize_delivery_invocation",
    { payload: { token: workerToken } },
  );
  if (authorizationError || authorized !== true)
    return json({ error: "工作进程鉴权失败" }, 401);
  const { data, error } = await admin.rpc("worker_claim_delivery_batch", {
    payload: { limit: 10 },
  });
  if (error) {
    console.error("[edm-directmail-worker] 领取任务失败", {
      error_code: error.code,
    });
    return json({ error: "无法领取正式发送任务" }, 500);
  }

  const claims = (data ?? []) as DeliveryClaim[];
  const outcomes = await Promise.all(
    claims.map(async (claim) => {
      let completion: Record<string, unknown>;
      try {
        const credentials = await openCredentialEnvelope({
          keyringSource,
          context: {
            workspaceId: claim.workspace_id,
            channelId: claim.channel.id,
            credentialVersion: claim.channel.credential_version,
          },
          envelope: claim.credential,
        });
        const receipt = await sendDirectMailMessage({
          ...credentials,
          region: claim.channel.region,
          senderAddress: claim.channel.sender_address,
          senderAlias: claim.channel.sender_alias,
          replyToAddress: claim.channel.reply_to_address,
          recipientEmail: claim.recipient_email,
          subject: claim.subject,
          textBody: claim.body,
        });
        completion = {
          status: "accepted",
          provider_request_id: receipt.requestId,
          provider_env_id: receipt.envId,
        };
      } catch (deliveryError) {
        completion = classifyDirectMailError(deliveryError);
        console.error("[edm-directmail-worker] DirectMail 调用失败", {
          run_id: claim.run_id,
          task_id: claim.task_id,
          attempt_id: claim.attempt_id,
          error_name:
            deliveryError instanceof Error
              ? deliveryError.name
              : typeof deliveryError,
          error_code: completion.error_code,
        });
      }

      const { data: completed, error: completionError } = await admin.rpc(
        "worker_complete_delivery_task",
        {
          payload: {
            task_id: claim.task_id,
            attempt_id: claim.attempt_id,
            lease_token: claim.lease_token,
            ...completion,
          },
        },
      );
      if (completionError) {
        console.error("[edm-directmail-worker] 保存发送结果失败", {
          run_id: claim.run_id,
          task_id: claim.task_id,
          attempt_id: claim.attempt_id,
          error_code: completionError.code,
        });
        return "completion_failed";
      }
      return (
        (completed as { task_status?: string } | null)?.task_status ??
        "completed"
      );
    }),
  );

  return json({
    claimed: claims.length,
    completed: outcomes.filter((outcome) => outcome !== "completion_failed")
      .length,
    completion_failed: outcomes.filter(
      (outcome) => outcome === "completion_failed",
    ).length,
  });
});
