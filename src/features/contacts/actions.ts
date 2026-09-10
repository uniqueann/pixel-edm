"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import { contactInput, type ContactList } from "./model";
export async function listContacts(input: {
  q?: string;
  tag?: string;
  status?: string;
  subscription?: string;
  page?: string;
}) {
  const { workspace } = await getContext();
  const db = await serverClient();
  const { data, error } = await db.rpc("list_contacts", {
    payload: {
      workspace_id: workspace.id,
      q: (input.q ?? "").slice(0, 254),
      tag_id: z.string().uuid().safeParse(input.tag).success ? input.tag : null,
      archived: input.status === "archived",
      subscription_status: [
        "unconfirmed",
        "subscribed",
        "unsubscribed",
        "bounced",
        "complained",
      ].includes(input.subscription ?? "")
        ? input.subscription
        : null,
      page: Math.min(
        1000000,
        Math.max(1, Number.parseInt(input.page ?? "1") || 1),
      ),
    },
  });
  if (error) throw new Error("客户加载失败，请重试。");
  return data as unknown as ContactList;
}
async function mutate(input: unknown, archive: boolean) {
  const schema = archive
    ? z.object({
        workspace_id: z.string().uuid(),
        id: z.string().uuid(),
        expected_version: z.number().int().positive(),
        archived: z.boolean(),
      })
    : contactInput;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspace, role } = await getContext();
  if (workspace.id !== parsed.data.workspace_id)
    return { error: "工作区已切换，请刷新后重试。" };
  if (!["admin", "editor"].includes(role))
    return { error: "没有客户管理权限。" };
  const db = await serverClient();
  const { error } = await db.rpc(archive ? "archive_contact" : "save_contact", {
    payload: parsed.data,
  });
  if (error)
    return {
      error:
        error.code === "23505"
          ? "该邮箱已存在；如已归档，请到已归档列表恢复。"
          : error.code === "P0001"
            ? error.message
            : "保存失败，请确认权限后重试。",
    };
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { success: true };
}
export async function saveContact(input: unknown) {
  return mutate(input, false);
}
export async function setContactArchived(input: unknown) {
  return mutate(input, true);
}

export async function unsubscribeContact(input: unknown) {
  const schema = z.object({
    workspace_id: z.string().uuid(),
    id: z.string().uuid(),
    expected_version: z.number().int().positive(),
    reason: z.string().trim().min(1, "请填写退订原因").max(500),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { workspace, role } = await getContext();
  if (workspace.id !== parsed.data.workspace_id)
    return { error: "工作区已切换，请刷新后重试。" };
  if (!["admin", "editor"].includes(role))
    return { error: "没有客户管理权限。" };
  const db = await serverClient();
  const { error } = await db.rpc("unsubscribe_contact", {
    payload: parsed.data,
  });
  if (error)
    return {
      error: error.code === "P0001" ? error.message : "退订失败，请重试。",
    };
  revalidatePath("/contacts");
  return { success: true };
}
