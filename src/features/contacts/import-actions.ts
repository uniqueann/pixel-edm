"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import {
  importRequestSchema,
  normalizeImportRows,
  type ContactImportDetail,
  type ContactImportHistory,
} from "./import-model";

async function authorizedWorkspace(workspaceId: string) {
  const context = await getContext();
  if (context.workspace.id !== workspaceId)
    throw new Error("工作区已切换，请刷新后重试。");
  if (!(["admin", "editor"] as string[]).includes(context.role))
    throw new Error("没有名单导入权限。");
  return serverClient();
}

function actionError(error: unknown) {
  return {
    error: error instanceof Error ? error.message : "操作失败，请重试。",
  };
}

export async function prepareContactImport(input: unknown) {
  try {
    const parsed = importRequestSchema.parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id);
    if (
      parsed.consent_declared &&
      (!parsed.consent_source || !parsed.consent_note)
    )
      throw new Error("声明订阅同意时必须填写来源和证据说明。");
    const normalizedRows = normalizeImportRows(parsed.rows, parsed);
    const { data, error } = await db.rpc("prepare_contact_import", {
      payload: {
        ...parsed,
        total_source_rows: parsed.rows.length,
        rows: normalizedRows,
      },
    });
    if (error) throw new Error(error.message);
    return { data: data as unknown as ContactImportDetail };
  } catch (error) {
    return actionError(error);
  }
}

const jobSchema = z.object({
  workspace_id: z.string().uuid(),
  id: z.string().uuid(),
  page: z.number().int().positive().max(100000).optional(),
});

async function jobRpc(
  name:
    | "confirm_contact_import"
    | "process_contact_import_batch"
    | "get_contact_import",
  input: unknown,
) {
  try {
    const parsed = jobSchema.parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc(name, { payload: parsed });
    if (error) throw new Error(error.message);
    if (name === "process_contact_import_batch") {
      revalidatePath("/contacts");
      revalidatePath("/dashboard");
    }
    return { data: data as unknown as ContactImportDetail };
  } catch (error) {
    return actionError(error);
  }
}

export async function confirmContactImport(input: unknown) {
  return jobRpc("confirm_contact_import", input);
}

export async function processContactImportBatch(input: unknown) {
  return jobRpc("process_contact_import_batch", input);
}

export async function getContactImport(input: unknown) {
  return jobRpc("get_contact_import", input);
}

export async function listContactImports(workspaceId: string) {
  const db = await authorizedWorkspace(workspaceId);
  const { data, error } = await db.rpc("list_contact_imports", {
    payload: { workspace_id: workspaceId },
  });
  if (error) throw new Error("导入历史加载失败，请重试。");
  return data as unknown as ContactImportHistory;
}

export async function exportContactImport(input: unknown) {
  try {
    const parsed = jobSchema
      .pick({ workspace_id: true, id: true })
      .parse(input);
    const db = await authorizedWorkspace(parsed.workspace_id);
    const { data, error } = await db.rpc("export_contact_import", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    return {
      data: data as unknown as {
        source_rows: number[];
        email: string;
        result: string;
        message: string;
      }[],
    };
  } catch (error) {
    return actionError(error);
  }
}
