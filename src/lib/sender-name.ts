import { z } from "zod";

// 数据库为 edm.members.display_name 设置的默认值；它不是真实署名。
export const DEFAULT_SENDER_NAME = "店主";

export function isDefaultSenderName(name: string | null | undefined) {
  return (name ?? "").trim() === DEFAULT_SENDER_NAME;
}

// 仅在已设置真实署名时用于 {{sender_name}} 预填；默认值返回空串，强制成员自行填写。
export function senderNameDefault(displayName: string) {
  return isDefaultSenderName(displayName) ? "" : displayName.trim();
}

export const memberProfile = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "请填写对外署名")
    .max(80, "署名不能超过 80 字")
    .refine(
      (value) => !isDefaultSenderName(value),
      "请填写真实姓名或品牌名，不能使用默认的“店主”",
    ),
});
