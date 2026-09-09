import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
export const workspaceCookie = "pixel-edm-workspace";
export const getContext = cache(async () => {
  if (!isConfigured()) redirect("/setup");
  const db = await serverClient();
  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();
  if (authError || !user) redirect("/login");
  const { data: member, error } = await db
    .from("members")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error("暂时无法加载邮局，请重试或检查数据库连接。");
  if (member?.status === "disabled") redirect("/disabled");
  if (!member) redirect("/onboarding");
  const [
    { data: workspaces, error: wsError },
    { data: memberships, error: msError },
  ] = await Promise.all([
    db.from("workspaces").select("*").order("created_at"),
    db
      .from("workspace_members")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active"),
  ]);
  if (wsError || msError) throw new Error("工作区加载失败，请重试。");
  const selected = (await cookies()).get(workspaceCookie)?.value;
  const workspace =
    workspaces?.find((w) => w.id === selected) ??
    workspaces?.find((w) => w.bootstrap_owner_id === user.id) ??
    workspaces?.[0];
  if (!workspace) redirect("/onboarding");
  const role = memberships?.find((m) => m.workspace_id === workspace.id)?.role;
  if (!role) throw new Error("当前工作区成员资格已失效。");
  return { user, member, workspace, workspaces: workspaces ?? [], role };
});
