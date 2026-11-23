"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import { resolveValidationMessage } from "@/lib/validation-messages";
import { templateInput, type TemplateList } from "./model";
import { resolveStarterSearchAlias } from "./localization";

async function authorizedWorkspace(workspaceId: string, write = false) {
  const context = await getContext();
  if (context.workspace.id !== workspaceId)
    throw new Error("工作区已切换，请刷新后重试。");
  if (write && !["admin", "editor"].includes(context.role))
    throw new Error("没有模板管理权限。");
  return serverClient();
}

function actionError(error: unknown) {
  return {
    error: error instanceof Error ? error.message : "操作失败，请重试。",
  };
}

function refreshTemplateViews() {
  revalidatePath("/templates");
  revalidatePath("/logs");
  revalidatePath("/dashboard");
}

export async function listTemplates(input: {
  status?: string;
  q?: string;
  category?: string;
  page?: string;
  page_size?: string;
}) {
  const { workspace } = await getContext();
  const db = await authorizedWorkspace(workspace.id);
  const rawQuery = (input.q ?? "").slice(0, 200);
  const basePayload = {
    workspace_id: workspace.id,
    archived: input.status === "archived",
    category: (input.category ?? "").slice(0, 50),
    page: Math.min(
      1000000,
      Math.max(1, Number.parseInt(input.page ?? "1") || 1),
    ),
    page_size: Math.min(
      100,
      Math.max(1, Number.parseInt(input.page_size ?? "20") || 20),
    ),
  };
  const { data, error } = await db.rpc("list_templates", {
    payload: {
      ...basePayload,
      q: rawQuery,
    },
  });
  if (error) throw new Error("模板加载失败，请重试。");
  const list = data as unknown as TemplateList;
  if (list.total === 0 && rawQuery.trim()) {
    const starterAlias = resolveStarterSearchAlias(rawQuery);
    if (starterAlias) {
      const retry = await db.rpc("list_templates", {
        payload: {
          ...basePayload,
          q: starterAlias,
        },
      });
      if (!retry.error && retry.data) {
        return retry.data as unknown as TemplateList;
      }
    }
  }
  return list;
}

export async function saveTemplate(input: unknown) {
  try {
    const parsed = templateInput.parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id, true);
    const { error } = await db.rpc("save_template", { payload: parsed });
    if (error) throw new Error(error.message);
    refreshTemplateViews();
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issueKey = error.issues[0]?.message;
      return {
        error: resolveValidationMessage(issueKey, undefined, "模板内容无效。"),
        validationCode: issueKey,
      };
    }
    return actionError(error);
  }
}

const templateReference = z.object({
  workspace_id: z.string().uuid(),
  id: z.string().uuid(),
});

export async function duplicateTemplate(input: unknown) {
  try {
    const parsed = templateReference.parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id, true);
    const { error } = await db.rpc("duplicate_template", { payload: parsed });
    if (error) throw new Error(error.message);
    refreshTemplateViews();
    return { success: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function setTemplateArchived(input: unknown) {
  try {
    const parsed = templateReference
      .extend({
        expected_version: z.number().int().positive(),
        archived: z.boolean(),
      })
      .parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id, true);
    const { error } = await db.rpc("set_template_archived", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    refreshTemplateViews();
    return { success: true };
  } catch (error) {
    return actionError(error);
  }
}
