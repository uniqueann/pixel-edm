"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import { campaignInput, type CampaignDetail, type CampaignList } from "./model";

async function authorizedWorkspace(workspaceId: string, write = false) {
  const context = await getContext();
  if (context.workspace.id !== workspaceId)
    throw new Error("工作区已切换，请刷新后重试。");
  if (write && !["admin", "editor"].includes(context.role))
    throw new Error("没有活动管理权限。");
  return serverClient();
}

function actionError(error: unknown) {
  return {
    error: error instanceof Error ? error.message : "操作失败，请重试。",
  };
}

function refreshCampaignViews() {
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  revalidatePath("/logs");
}

export async function listCampaigns(input: { status?: string; page?: string }) {
  const { workspace } = await getContext();
  const db = await authorizedWorkspace(workspace.id);
  const { data, error } = await db.rpc("list_campaigns", {
    payload: {
      workspace_id: workspace.id,
      archived: input.status === "archived",
      page: Math.min(
        1000000,
        Math.max(1, Number.parseInt(input.page ?? "1") || 1),
      ),
    },
  });
  if (error) throw new Error("活动加载失败，请重试。");
  return data as unknown as CampaignList;
}

const campaignReference = z.object({
  workspace_id: z.string().uuid(),
  id: z.string().uuid(),
});

export async function getCampaign(input: unknown) {
  try {
    const parsed = campaignReference.parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id, true);
    const { data, error } = await db.rpc("get_campaign", { payload: parsed });
    if (error) throw new Error(error.message);
    return { data: data as unknown as CampaignDetail };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "活动标识无效。" };
    return actionError(error);
  }
}

export async function saveCampaign(input: unknown) {
  try {
    const parsed = campaignInput.parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id, true);
    const { data, error } = await db.rpc("save_campaign", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    refreshCampaignViews();
    return { success: true, id: data };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "活动内容无效。" };
    return actionError(error);
  }
}

export async function setCampaignArchived(input: unknown) {
  try {
    const parsed = campaignReference
      .extend({
        expected_version: z.number().int().positive(),
        archived: z.boolean(),
      })
      .parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id, true);
    const { error } = await db.rpc("set_campaign_archived", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    refreshCampaignViews();
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "活动归档参数无效。" };
    return actionError(error);
  }
}
