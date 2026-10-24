"use server";

import { z } from "zod";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import type { ActivityLogList } from "./model";

export async function listActivityLogs(input: {
  actor?: string;
  action?: string;
  page?: string;
  pageSize?: number | string;
  page_size?: string;
}) {
  const { workspace, role } = await getContext();
  if (role !== "admin") throw new Error("没有日志查看权限。");
  const actor = input.actor ?? "";
  if (
    actor &&
    actor !== "system" &&
    !z.string().uuid().safeParse(actor).success
  )
    throw new Error("操作者筛选无效。");
  const requestedPageSize = input.pageSize ?? input.page_size;
  const db = await serverClient();
  const { data, error } = await db.rpc("list_activity_logs", {
    payload: {
      workspace_id: workspace.id,
      actor: actor || null,
      action: input.action || null,
      page: Math.min(
        1000000,
        Math.max(1, Number.parseInt(input.page ?? "1") || 1),
      ),
      page_size: Math.min(
        100,
        Math.max(1, Number.parseInt(String(requestedPageSize ?? "20")) || 20),
      ),
    },
  });
  if (error) throw new Error("操作记录加载失败，请重试。");
  return data as unknown as ActivityLogList;
}
