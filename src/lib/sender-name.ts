import { z } from "zod";

// 数据库为 edm.members.display_name 设置的历史默认值；新逻辑优先依据 display_name_customized 标志位判断。
export const DEFAULT_SENDER_NAME = "店主";

export type MemberSenderNameLike = {
  display_name?: string | null;
  display_name_customized?: boolean | null;
};

export function isDefaultSenderName(name: string | null | undefined) {
  return (name ?? "").trim() === DEFAULT_SENDER_NAME;
}

/** 优先使用数据库 display_name_customized 标志位判断是否已设置真实署名，消除对中文字面量的强耦合。 */
export function isMemberSenderNameCustomized(member: MemberSenderNameLike) {
  if (typeof member.display_name_customized === "boolean") {
    return member.display_name_customized;
  }
  const trimmed = (member.display_name ?? "").trim();
  return trimmed.length > 0 && !isDefaultSenderName(trimmed);
}

// 仅在已设置真实署名时用于 {{sender_name}} 预填；未自定义时返回空串，强制成员自行填写。
export function senderNameDefault(
  displayName: string,
  customized?: boolean | null,
) {
  if (typeof customized === "boolean") {
    return customized ? displayName.trim() : "";
  }
  return isDefaultSenderName(displayName) ? "" : displayName.trim();
}

export const memberProfile = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "validation.senderNameRequired")
    .max(80, "validation.senderNameTooLong")
    .refine(
      (value) => !isDefaultSenderName(value),
      "validation.senderNameDefaultForbidden",
    ),
});
