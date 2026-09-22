"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import {
  campaignInput,
  type CampaignConfirmation,
  type CampaignDetail,
  type CampaignDeliverySummary,
  type CampaignDeliveryStatistics,
  type CampaignDeliveryTaskList,
  type CampaignEditorOptions,
  type CampaignList,
  type CampaignPreview,
  type WorkspaceCampaignStatistics,
  deliveryResultFilters,
} from "./model";

async function authorizedWorkspace(workspaceId: string, write = false) {
  const context = await getContext();
  if (context.workspace.id !== workspaceId)
    throw new Error("工作区已切换，请刷新后重试。");
  if (write && !["admin", "editor"].includes(context.role))
    throw new Error("没有活动管理权限。");
  return serverClient();
}

async function adminWorkspace(workspaceId: string) {
  const context = await getContext();
  if (context.workspace.id !== workspaceId)
    throw new Error("工作区已切换，请刷新后重试。");
  if (context.role !== "admin") throw new Error("只有管理员可以管理正式发送。");
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

export async function listCampaigns(input: {
  status?: string;
  q?: string;
  campaign_status?: string;
  page?: string;
}) {
  const { workspace } = await getContext();
  const db = await authorizedWorkspace(workspace.id);
  const { data, error } = await db.rpc("list_campaigns", {
    payload: {
      workspace_id: workspace.id,
      archived: input.status === "archived",
      q: (input.q ?? "").slice(0, 200),
      campaign_status: input.campaign_status ?? "",
      page: Math.min(
        1000000,
        Math.max(1, Number.parseInt(input.page ?? "1") || 1),
      ),
    },
  });
  if (error) throw new Error("活动加载失败，请重试。");
  const result = data as unknown as CampaignList;
  if (!result.items.length) return result;
  const { data: deliveries, error: deliveryError } = await db.rpc(
    "get_campaign_delivery_summaries",
    {
      payload: {
        workspace_id: workspace.id,
        campaign_ids: result.items.map((item) => item.id),
      },
    },
  );
  if (deliveryError) throw new Error("正式发送进度加载失败，请重试。");
  const byCampaign = new Map(
    (deliveries as unknown as CampaignDeliverySummary[]).map((item) => [
      item.campaign_id,
      item,
    ]),
  );
  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      delivery: byCampaign.get(item.id) ?? null,
    })),
  };
}

export async function getCampaignEditorOptions() {
  const { workspace } = await getContext();
  const db = await authorizedWorkspace(workspace.id, true);
  const { data, error } = await db.rpc("get_campaign_editor_options", {
    payload: { workspace_id: workspace.id },
  });
  if (error) throw new Error("活动编辑选项加载失败，请重试。");
  return data as unknown as CampaignEditorOptions;
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

export async function getCampaignPreview(input: unknown) {
  try {
    const parsed = campaignReference.parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id, true);
    const { data, error } = await db.rpc("get_campaign_preview", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    return { data: data as unknown as CampaignPreview };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "活动标识无效。" };
    return actionError(error);
  }
}

export async function confirmCampaign(input: unknown) {
  try {
    const parsed = campaignReference
      .extend({
        expected_campaign_version: z.number().int().positive(),
        expected_template_version: z.number().int().positive(),
      })
      .parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id, true);
    const { data, error } = await db.rpc("confirm_campaign", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    refreshCampaignViews();
    return { data: data as unknown as CampaignConfirmation };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "活动确认参数无效。" };
    return actionError(error);
  }
}

export async function duplicateConfirmedCampaign(input: unknown) {
  try {
    const parsed = campaignReference
      .extend({ template_id: z.string().uuid().optional() })
      .parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id, true);
    const { data, error } = await db.rpc("duplicate_confirmed_campaign", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    refreshCampaignViews();
    return { success: true, id: data };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "活动复制参数无效。" };
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

const deliveryReference = z.object({
  workspace_id: z.string().uuid(),
  run_id: z.string().uuid(),
});

export async function startCampaignDelivery(input: unknown) {
  try {
    const parsed = z
      .object({
        workspace_id: z.string().uuid(),
        campaign_id: z.string().uuid(),
        expected_version: z.number().int().positive(),
        idempotency_key: z.string().uuid(),
        confirmation_name: z.string().min(1).max(100),
      })
      .parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc("start_campaign_delivery", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    refreshCampaignViews();
    return { data: data as unknown as { run_id: string; status: string } };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "正式发送参数无效。" };
    return actionError(error);
  }
}

export async function setCampaignDeliveryPaused(input: unknown) {
  try {
    const parsed = deliveryReference
      .extend({
        expected_version: z.number().int().positive(),
        paused: z.boolean(),
      })
      .parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc("set_campaign_delivery_paused", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    refreshCampaignViews();
    return { data };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "暂停状态参数无效。" };
    return actionError(error);
  }
}

export async function abortCampaignDelivery(input: unknown) {
  try {
    const parsed = deliveryReference
      .extend({
        expected_version: z.number().int().positive(),
        confirmation_name: z.string().min(1).max(100),
      })
      .parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc("abort_campaign_delivery", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    refreshCampaignViews();
    return { data };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "放弃剩余任务参数无效。" };
    return actionError(error);
  }
}

export async function listCampaignDeliveryTasks(input: unknown) {
  try {
    const parsed = deliveryReference
      .extend({
        result_filter: z.enum(deliveryResultFilters).optional(),
        page: z.number().int().positive().max(1000000).default(1),
      })
      .parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc("list_campaign_delivery_tasks", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    return { data: data as unknown as CampaignDeliveryTaskList };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "发送明细参数无效。" };
    return actionError(error);
  }
}

export async function getCampaignDeliveryStatistics(input: unknown) {
  try {
    const parsed = deliveryReference.parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc("get_campaign_delivery_statistics", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    return { data: data as unknown as CampaignDeliveryStatistics };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "统计参数无效。" };
    return actionError(error);
  }
}

export async function getWorkspaceCampaignStatistics() {
  const { workspace } = await getContext();
  const db = await authorizedWorkspace(workspace.id);
  const { data, error } = await db.rpc("get_workspace_campaign_statistics", {
    payload: { workspace_id: workspace.id },
  });
  if (error) throw new Error("工作区统计加载失败，请重试。");
  return data as unknown as WorkspaceCampaignStatistics;
}

export async function resolveDeliveryUnknown(input: unknown) {
  try {
    const parsed = z
      .object({
        workspace_id: z.string().uuid(),
        task_id: z.string().uuid(),
        resolution: z.enum(["accepted", "failed"]),
        note: z.string().trim().min(10, "核对说明至少 10 个字").max(500),
      })
      .parse(input);
    const db = await adminWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc("resolve_delivery_unknown", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    refreshCampaignViews();
    return { data };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "人工核对参数无效。" };
    return actionError(error);
  }
}
