import "server-only";
import { serverClient } from "@/lib/supabase/server";
import { resolveWorkspaceId } from "@/lib/workspace";
import type { EdmBilledPlan } from "./metadata";

export function normalizeCheckoutPlan(
  value: FormDataEntryValue | null,
): EdmBilledPlan {
  return value === "team" ? "team" : "pro";
}

export function normalizeCheckoutInterval(
  value: FormDataEntryValue | null,
): "monthly" | "yearly" {
  return value === "yearly" ? "yearly" : "monthly";
}

/** 当前登录管理员与工作区；Checkout 路由专用。 */
export async function requireEdmBillingCheckout(
  formWorkspaceId?: string | null,
) {
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, error: "请先登录。" };
  }

  const { data: workspaces, error: wsError } = await db
    .from("workspaces")
    .select("id, bootstrap_owner_id")
    .order("created_at");
  if (wsError || !workspaces?.length) {
    return { ok: false as const, status: 400, error: "没有可用的工作区。" };
  }

  const resolved = await resolveWorkspaceId(user.id, workspaces);
  const workspaceId =
    formWorkspaceId && workspaces.some((w) => w.id === formWorkspaceId)
      ? formWorkspaceId
      : resolved;
  if (!workspaceId) {
    return { ok: false as const, status: 400, error: "请先选择工作区。" };
  }

  const { data: membership, error } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error || !membership) {
    return { ok: false as const, status: 403, error: "无法访问该工作区。" };
  }
  if (membership.role !== "admin") {
    return { ok: false as const, status: 403, error: "仅管理员可升级套餐。" };
  }

  return {
    ok: true as const,
    user,
    workspaceId,
  };
}
