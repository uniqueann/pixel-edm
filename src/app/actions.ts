"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase/server";
import { getContext, workspaceCookie } from "@/lib/workspace";
import { workspaceSettings } from "@/lib/validation";
export async function initialize() {
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await db.rpc("initialize_member");
  if (error) redirect("/onboarding?error=1");
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
export async function signOut() {
  const db = await serverClient();
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error) throw new Error("退出失败，请重试。");
  (await cookies()).delete(workspaceCookie);
  revalidatePath("/", "layout");
  redirect("/login");
}
export async function switchWorkspace(id: string) {
  const { workspaces } = await getContext();
  if (!workspaces.some((w) => w.id === id))
    throw new Error("不能访问此工作区。");
  (await cookies()).set(workspaceCookie, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  revalidatePath("/", "layout");
}
export async function saveWorkspace(input: unknown) {
  const { workspace, role } = await getContext();
  if (role !== "admin") return { error: "仅管理员可以修改工作区。" };
  const result = workspaceSettings.safeParse(input);
  if (!result.success) return { error: result.error.issues[0].message };
  const db = await serverClient();
  const { data, error } = await db
    .from("workspaces")
    .update(result.data)
    .eq("id", workspace.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "保存失败，请确认权限后重试。" };
  revalidatePath("/", "layout");
  return { success: true };
}
