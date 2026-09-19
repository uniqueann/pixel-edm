"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import {
  credentialStorageReady,
  sealDirectMailCredentials,
} from "./credentials";
import {
  deliveryChannelInput,
  deliveryTrackingInput,
  type DeliveryChannel,
  type DeliveryTestAttempt,
} from "./model";

async function adminWorkspace(workspaceId: string) {
  const context = await getContext();
  if (context.workspace.id !== workspaceId)
    throw new Error("工作区已切换，请刷新后重试。");
  if (context.role !== "admin") throw new Error("只有管理员可以配置发信通道。");
  return serverClient();
}

function actionError(error: unknown) {
  if (error instanceof z.ZodError)
    return { error: error.issues[0]?.message ?? "发信通道配置无效。" };
  const message = error instanceof Error ? error.message : "操作失败，请重试。";
  const safeMessages = [
    "工作区已切换",
    "只有管理员",
    "发信通道已被修改",
    "重新连接必须",
    "首次连接必须",
    "服务器尚未配置",
    "测试发送过于频繁",
    "登录邮箱尚未验证",
    "Webhook 配置已变化",
    "行为追踪",
    "阿里云标签",
  ];
  return {
    error: safeMessages.some((prefix) => message.startsWith(prefix))
      ? message
      : "发信通道保存失败，请检查配置后重试。",
  };
}

export async function configureDeliveryTracking(input: unknown) {
  try {
    const parsed = deliveryTrackingInput.parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc("configure_delivery_tracking", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/settings");
    revalidatePath("/campaigns");
    revalidatePath("/dashboard");
    revalidatePath("/logs");
    return { data: data as unknown as DeliveryChannel };
  } catch (error) {
    return actionError(error);
  }
}

async function loadChannel(
  db: Awaited<ReturnType<typeof serverClient>>,
  workspaceId: string,
) {
  const { data, error } = await db.rpc("get_delivery_channel", {
    payload: { workspace_id: workspaceId },
  });
  if (error) throw new Error("发信通道加载失败，请重试。");
  const channel = data as unknown as DeliveryChannel | null;
  if (!channel) return null;
  const { url } = supabaseConfig();
  const baseUrl = url.replace(/\/+$/, "");
  const webhookFunction =
    channel.provider === "amazon_ses"
      ? "edm-ses-events"
      : "edm-directmail-events";
  return {
    ...channel,
    webhook: channel.webhook
      ? {
          ...channel.webhook,
          endpoint: `${baseUrl}/functions/v1/${webhookFunction}?channel_id=${channel.id}`,
        }
      : undefined,
  };
}

export async function getDeliveryChannel() {
  const { workspace } = await getContext();
  const db = await serverClient();
  return loadChannel(db, workspace.id);
}

export async function getDeliveryTestSummary(channelId: string) {
  const { workspace, role } = await getContext();
  if (role !== "admin") return null;
  const db = await serverClient();
  const { data, error } = await db.rpc("get_delivery_test_summary", {
    payload: { workspace_id: workspace.id, channel_id: channelId },
  });
  if (error) throw new Error("测试发送结果加载失败，请重试。");
  return data as unknown as DeliveryTestAttempt | null;
}

export async function saveDeliveryChannel(input: unknown) {
  try {
    const parsed = deliveryChannelInput.parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    if (!credentialStorageReady())
      throw new Error("服务器尚未配置 EDM 凭据加密密钥。");

    const current = await loadChannel(db, parsed.workspace_id);
    if (current && current.id !== parsed.id)
      throw new Error("发信通道已被修改，请重新加载后重试。");
    if (current && current.version !== parsed.expected_version)
      throw new Error("发信通道已被修改，请重新加载后重试。");
    if (!current && parsed.id)
      throw new Error("发信通道已被修改，请重新加载后重试。");

    const channelId = current?.id ?? randomUUID();
    const accessKeyId = parsed.access_key_id;
    const accessKeySecret = parsed.access_key_secret;
    const credential =
      accessKeyId && accessKeySecret
        ? sealDirectMailCredentials({
            workspaceId: parsed.workspace_id,
            channelId,
            credentialVersion: (current?.credential_version ?? 0) + 1,
            accessKeyId,
            accessKeySecret,
          })
        : undefined;

    const { data, error } = await db.rpc("save_delivery_channel", {
      payload: {
        workspace_id: parsed.workspace_id,
        id: channelId,
        expected_version: current?.version,
        region: parsed.region,
        sender_domain: parsed.sender_domain,
        sender_address: parsed.sender_address,
        sender_alias: parsed.sender_alias,
        reply_to_address: parsed.reply_to_address,
        credential,
      },
    });
    if (error) throw new Error(error.message);
    revalidatePath("/settings");
    revalidatePath("/logs");
    revalidatePath("/dashboard");
    return { data: data as unknown as DeliveryChannel };
  } catch (error) {
    return actionError(error);
  }
}

const disconnectInput = z.object({
  workspace_id: z.string().uuid(),
  id: z.string().uuid(),
  expected_version: z.number().int().positive(),
});

export async function disconnectDeliveryChannel(input: unknown) {
  try {
    const parsed = disconnectInput.parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc("disconnect_delivery_channel", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/settings");
    revalidatePath("/logs");
    revalidatePath("/dashboard");
    return { data: data as unknown as DeliveryChannel };
  } catch (error) {
    return actionError(error);
  }
}

const deliveryWebhookInput = z.object({
  workspace_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  expected_token_version: z.number().int().positive().optional(),
});

export async function configureDeliveryWebhook(input: unknown) {
  try {
    const parsed = deliveryWebhookInput.parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const current = await loadChannel(db, parsed.workspace_id);
    if (!current || current.id !== parsed.channel_id)
      throw new Error("发信通道已被修改，请重新加载后重试。");
    if (current.webhook?.token_version !== parsed.expected_token_version) {
      throw new Error("Webhook 配置已变化，请重新加载后重试。");
    }

    const token = randomBytes(32).toString("base64url");
    const tokenDigest = createHash("sha256").update(token).digest("hex");
    const { error } = await db.rpc("configure_delivery_webhook", {
      payload: {
        ...parsed,
        token_digest: tokenDigest,
        token_hint: token.slice(-4),
      },
    });
    if (error) throw new Error(error.message);
    const channel = await loadChannel(db, parsed.workspace_id);
    if (!channel) throw new Error("发信通道加载失败，请重试。");
    revalidatePath("/settings");
    revalidatePath("/logs");
    return { data: channel, token };
  } catch (error) {
    return actionError(error);
  }
}

const revokeWebhookInput = deliveryWebhookInput.extend({
  expected_token_version: z.number().int().positive(),
});

export async function revokeDeliveryWebhook(input: unknown) {
  try {
    const parsed = revokeWebhookInput.parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const { error } = await db.rpc("revoke_delivery_webhook", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    const channel = await loadChannel(db, parsed.workspace_id);
    if (!channel) throw new Error("发信通道加载失败，请重试。");
    revalidatePath("/settings");
    revalidatePath("/logs");
    return { data: channel };
  } catch (error) {
    return actionError(error);
  }
}

const deliveryTestInput = z.object({
  workspace_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  idempotency_key: z.string().uuid(),
});

export async function sendDeliveryChannelTest(input: unknown) {
  try {
    const parsed = deliveryTestInput.parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const { data, error } = await db.functions.invoke("edm-delivery-test", {
      body: { ...parsed, attempt_id: parsed.idempotency_key },
    });
    if (error) throw new Error("测试邮件发送失败，请稍后重试。");
    if (!data?.data)
      throw new Error(data?.error ?? "测试邮件发送失败，请稍后重试。");
    const channel = await loadChannel(db, parsed.workspace_id);
    revalidatePath("/settings");
    revalidatePath("/logs");
    return { data: data.data as DeliveryTestAttempt, channel };
  } catch (error) {
    return actionError(error);
  }
}
