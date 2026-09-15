"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext, workspaceCookie } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/config";
import { teamRoles, type InvitationPreview, type TeamData } from "./model";

const workspaceId = z.string().uuid();
const role = z.enum(teamRoles);
const teamReference = z.object({ workspace_id: workspaceId });
const memberReference = teamReference.extend({
  user_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
});

function tokenPayload(token: string) {
  return {
    token_hash: createHash("sha256").update(token).digest("hex"),
    token_hint: token.slice(-4),
  };
}

function pickInvitationResult(data: unknown) {
  if (!data || typeof data !== "object") return {};
  const value = data as Record<string, unknown>;
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
    expires_at:
      typeof value.expires_at === "string" ? value.expires_at : undefined,
    version: typeof value.version === "number" ? value.version : undefined,
  };
}

function actionError(error: unknown, fallback = "团队操作失败，请重试。") {
  const message = error instanceof Error ? error.message : "";
  const safeMessages = [
    "工作区已切换",
    "只有管理员",
    "该邮箱已是工作区成员",
    "该邮箱已有待处理邀请",
    "邮箱格式无效",
    "邀请已过期",
    "该邀请已无法",
    "邀请不存在",
    "成员不存在",
    "成员已被修改",
    "所有者必须",
    "不能移除工作区所有者",
    "工作区至少保留一名管理员",
    "新的所有者必须",
    "只有当前所有者",
    "新的所有者",
  ];
  return {
    error: safeMessages.some((item) => message.startsWith(item))
      ? message
      : fallback,
  };
}

async function currentAdmin(workspaceIdValue: string) {
  const context = await getContext();
  if (context.workspace.id !== workspaceIdValue)
    throw new Error("工作区已切换，请刷新后重试。");
  if (context.role !== "admin") throw new Error("只有管理员可以管理团队。");
  return { context, db: await serverClient() };
}

export async function listTeam(workspaceIdValue: string) {
  const parsed = workspaceId.safeParse(workspaceIdValue);
  if (!parsed.success) throw new Error("工作区无效。");
  const context = await getContext();
  if (context.workspace.id !== parsed.data)
    throw new Error("工作区已切换，请刷新后重试。");
  const db = await serverClient();
  const { data, error } = await db.rpc("list_workspace_team", {
    payload: { workspace_id: parsed.data },
  });
  if (error) throw new Error("成员信息加载失败，请重试。");
  return data as unknown as TeamData;
}

export async function createWorkspaceInvitation(input: unknown) {
  try {
    const parsed = teamReference
      .extend({
        email: z.string().trim().email("请输入有效邮箱").max(254),
        role,
      })
      .parse(input);
    const { db } = await currentAdmin(parsed.workspace_id);
    const token = randomBytes(32).toString("base64url");
    const { data, error } = await db.rpc("create_workspace_invitation", {
      payload: { ...parsed, ...tokenPayload(token) },
    });
    if (error) throw new Error(error.message);
    revalidatePath("/team");
    revalidatePath("/dashboard");
    revalidatePath("/logs");
    return {
      data: pickInvitationResult(data),
      inviteUrl: `${siteUrl().replace(/\/$/, "")}/invite/${token}`,
    };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "邀请信息无效。" };
    return actionError(error);
  }
}

export async function resendWorkspaceInvitation(input: unknown) {
  try {
    const parsed = teamReference.extend({ id: z.string().uuid() }).parse(input);
    const { db } = await currentAdmin(parsed.workspace_id);
    const token = randomBytes(32).toString("base64url");
    const { data, error } = await db.rpc("resend_workspace_invitation", {
      payload: { ...parsed, ...tokenPayload(token) },
    });
    if (error) throw new Error(error.message);
    revalidatePath("/team");
    revalidatePath("/logs");
    return {
      data: pickInvitationResult(data),
      inviteUrl: `${siteUrl().replace(/\/$/, "")}/invite/${token}`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function revokeWorkspaceInvitation(input: unknown) {
  try {
    const parsed = teamReference.extend({ id: z.string().uuid() }).parse(input);
    const { db } = await currentAdmin(parsed.workspace_id);
    const { error } = await db.rpc("revoke_workspace_invitation", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/team");
    revalidatePath("/logs");
    return { success: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function changeWorkspaceMemberRole(input: unknown) {
  try {
    const parsed = memberReference.extend({ role }).parse(input);
    const { db } = await currentAdmin(parsed.workspace_id);
    const { error } = await db.rpc("change_workspace_member_role", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/team");
    revalidatePath("/dashboard");
    revalidatePath("/logs");
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError)
      return { error: error.issues[0]?.message ?? "角色信息无效。" };
    return actionError(error);
  }
}

export async function removeWorkspaceMember(input: unknown) {
  try {
    const parsed = memberReference.parse(input);
    const { db } = await currentAdmin(parsed.workspace_id);
    const { error } = await db.rpc("remove_workspace_member", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/team");
    revalidatePath("/dashboard");
    revalidatePath("/logs");
    return { success: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function transferWorkspaceOwnership(input: unknown) {
  try {
    const parsed = teamReference
      .extend({
        new_owner_id: z.string().uuid(),
      })
      .parse(input);
    const { db } = await currentAdmin(parsed.workspace_id);
    const { error } = await db.rpc("transfer_workspace_ownership", {
      payload: parsed,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/team");
    revalidatePath("/dashboard");
    revalidatePath("/logs");
    return { success: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function getInvitationPreview(token: string) {
  const db = await serverClient();
  const { data: user } = await db.auth.getUser();
  if (!user.user) return { status: "invalid" } satisfies InvitationPreview;
  const { data, error } = await db.rpc("get_workspace_invitation_preview", {
    payload: tokenPayload(token),
  });
  if (error) return { status: "invalid" } satisfies InvitationPreview;
  return data as unknown as InvitationPreview;
}

export async function acceptWorkspaceInvitation(token: string) {
  try {
    if (!token || token.length > 128) return { error: "邀请链接无效。" };
    const db = await serverClient();
    const { data, error } = await db.rpc("accept_workspace_invitation", {
      payload: tokenPayload(token),
    });
    if (error) {
      return { error: "邀请无法接受，请使用邀请邮箱的已验证账号登录。" };
    }
    const result = data as unknown as {
      status?: string;
      workspace_id?: string;
    };
    if (result.status !== "accepted" || !result.workspace_id)
      return { error: "邀请无法接受，请使用邀请邮箱的已验证账号登录。" };
    const jar = await cookies();
    jar.set(workspaceCookie, result.workspace_id, {
      httpOnly: true,
      sameSite: "lax",
      secure: siteUrl().startsWith("https://"),
      path: "/",
    });
    revalidatePath("/team");
    revalidatePath("/dashboard");
    return { success: true };
  } catch {
    return { error: "邀请无法接受，请使用邀请邮箱的已验证账号登录。" };
  }
}
