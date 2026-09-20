import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { openCredentialEnvelope } from "../_shared/credential-envelope.ts";
import { getDeliveryAdapter } from "../_shared/providers/registry.ts";
import {
  appendUnsubscribeFooter,
  renderTrackedHtmlBody,
  signUnsubscribeToken,
  unsubscribeHeaders,
  unsubscribeUrls,
} from "../_shared/unsubscribe-token.ts";

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
  workspace_name: string;
  mailing_address: string;
  channel: {
    id: string;
    provider: "aliyun_directmail" | "amazon_ses";
    provider_config: Record<string, unknown>;
    sender_address: string;
    sender_alias: string;
    reply_to_address?: string | null;
    credential_version: number;
    tracking_enabled: boolean;
  };
  credential: CredentialEnvelope;
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleDeliveryWorker(request: Request) {
  if (request.method !== "POST") return json({ error: "请求方式无效" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const keyringSource = Deno.env.get("EDM_CREDENTIAL_KEYRING");
  const unsubscribeKeyring = Deno.env.get("EDM_UNSUBSCRIBE_KEYRING");
  const unsubscribeSiteUrl = Deno.env.get("EDM_PUBLIC_SITE_URL");
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !keyringSource ||
    !unsubscribeKeyring ||
    !unsubscribeSiteUrl
  )
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

  const configuredLimit = Number.parseInt(
    Deno.env.get("EDM_WORKER_CLAIM_LIMIT") ?? "50",
    10,
  );
  const claimLimit = Number.isFinite(configuredLimit)
    ? Math.min(100, Math.max(1, configuredLimit))
    : 50;
  const { data, error } = await admin.rpc("worker_claim_delivery_batch", {
    payload: { limit: claimLimit },
  });
  if (error) {
    console.error("[edm-delivery-worker] 领取任务失败", {
      error_code: error.code,
    });
    return json({ error: "无法领取正式发送任务" }, 500);
  }

  const claims = (data ?? []) as DeliveryClaim[];
  const outcomes = await Promise.all(
    claims.map(async (claim) => {
      let completion: Record<string, unknown>;
      const provider = claim.channel.provider;
      try {
        const adapter = await getDeliveryAdapter(provider);
        if (
          claim.channel.tracking_enabled &&
          (!adapter.capabilities.supportsOpenTracking ||
            !adapter.capabilities.supportsClickTracking)
        )
          throw new Error("TRACKING_CAPABILITY_UNSUPPORTED");
        const unsubscribeToken = await signUnsubscribeToken({
          keyringSource: unsubscribeKeyring,
          taskId: claim.task_id,
        });
        const urls = unsubscribeUrls(unsubscribeSiteUrl, unsubscribeToken);
        const textBody = appendUnsubscribeFooter({
          body: claim.body,
          workspaceName: claim.workspace_name,
          mailingAddress: claim.mailing_address,
          pageUrl: urls.pageUrl,
        });
        const htmlBody = claim.channel.tracking_enabled
          ? renderTrackedHtmlBody({
              body: claim.body,
              workspaceName: claim.workspace_name,
              mailingAddress: claim.mailing_address,
              pageUrl: urls.pageUrl,
              provider,
            })
          : undefined;
        const credentials = await openCredentialEnvelope({
          keyringSource,
          context: {
            workspaceId: claim.workspace_id,
            channelId: claim.channel.id,
            credentialVersion: claim.channel.credential_version,
            provider,
          },
          envelope: claim.credential,
        });
        const receipt = await adapter.send({
          credentials,
          providerConfig: claim.channel.provider_config,
          senderAddress: claim.channel.sender_address,
          senderAlias: claim.channel.sender_alias,
          replyToAddress: claim.channel.reply_to_address,
          recipientEmail: claim.recipient_email,
          subject: claim.subject,
          textBody,
          htmlBody,
          trackingEnabled: claim.channel.tracking_enabled,
          headers: unsubscribeHeaders(urls.oneClickUrl),
        });
        completion = {
          status: "accepted",
          provider_request_id: receipt.providerRequestId,
          provider_env_id: receipt.providerEnvId,
          provider_message_id: receipt.providerMessageId,
        };
      } catch (deliveryError) {
        let failure;
        try {
          failure = (await getDeliveryAdapter(provider)).classifyError(
            deliveryError,
          );
        } catch {
          failure = {
            status: "failed",
            error_category: "configuration",
            error_code: "DELIVERY_PROVIDER_UNSUPPORTED",
          };
        }
        completion = failure;
        console.error("[edm-delivery-worker] 邮件服务商调用失败", {
          provider: claim.channel.provider,
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
        console.error("[edm-delivery-worker] 保存发送结果失败", {
          provider: claim.channel.provider,
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
}

Deno.serve(handleDeliveryWorker);
