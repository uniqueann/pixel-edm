"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import {
  credentialStorageReady,
  sealDirectMailCredentials,
} from "./credentials";
import { deliveryChannelInput, type DeliveryChannel } from "./model";

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
  ];
  return {
    error: safeMessages.some((prefix) => message.startsWith(prefix))
      ? message
      : "发信通道保存失败，请检查配置后重试。",
  };
}

async function loadChannel(
  db: Awaited<ReturnType<typeof serverClient>>,
  workspaceId: string,
) {
  const { data, error } = await db.rpc("get_delivery_channel", {
    payload: { workspace_id: workspaceId },
  });
  if (error) throw new Error("发信通道加载失败，请重试。");
  return data as unknown as DeliveryChannel | null;
}

export async function getDeliveryChannel() {
  const { workspace } = await getContext();
  const db = await serverClient();
  return loadChannel(db, workspace.id);
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
