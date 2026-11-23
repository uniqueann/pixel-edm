"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import { buildActionError, mapDatabaseError } from "@/lib/errors";
import { resolveValidationMessage } from "@/lib/validation-messages";
import { contactInput, type ContactList } from "./model";
export async function listContacts(input: {
  q?: string;
  tag?: string;
  status?: string;
  subscription?: string;
  page?: string;
  page_size?: string;
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
      page_size: Math.min(
        100,
        Math.max(1, Number.parseInt(input.page_size ?? "20") || 20),
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
  if (!parsed.success)
    return buildActionError(
      parsed.error.issues[0].message,
      resolveValidationMessage(parsed.error.issues[0].message),
    );
  const { workspace, role } = await getContext();
  if (workspace.id !== parsed.data.workspace_id)
    return buildActionError("errors.common.workspaceSwitched");
  if (!["admin", "editor"].includes(role))
    return buildActionError("errors.contacts.permissionDenied");
  const db = await serverClient();
  const { error } = await db.rpc(archive ? "archive_contact" : "save_contact", {
    payload: parsed.data,
  });
  if (error) {
    const mapped = mapDatabaseError(error, "errors.common.saveFailed", {
      uniqueViolationCode: "errors.contacts.duplicateEmail",
    });
    return buildActionError(mapped.code, mapped.message, mapped.params);
  }
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { success: true as const, error: undefined, errorCode: undefined };
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
    reason: z
      .string()
      .trim()
      .min(1, "validation.unsubscribeReasonRequired")
      .max(500),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return buildActionError(
      parsed.error.issues[0].message,
      resolveValidationMessage(parsed.error.issues[0].message),
    );
  const { workspace, role } = await getContext();
  if (workspace.id !== parsed.data.workspace_id)
    return buildActionError("errors.common.workspaceSwitched");
  if (!["admin", "editor"].includes(role))
    return buildActionError("errors.contacts.permissionDenied");
  const db = await serverClient();
  const { error } = await db.rpc("unsubscribe_contact", {
    payload: parsed.data,
  });
  if (error) {
    const mapped = mapDatabaseError(error, "errors.contacts.unsubscribeFailed");
    return buildActionError(mapped.code, mapped.message, mapped.params);
  }
  revalidatePath("/contacts");
  return { success: true as const, error: undefined, errorCode: undefined };
}
