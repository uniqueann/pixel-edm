import { z } from "zod";
export const workspaceSettings = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请填写工作区名称")
    .max(80, "名称不能超过 80 字"),
  mailing_address: z.string().trim().max(500, "地址不能超过 500 字"),
});
export const credentials = z.object({
  email: z.string().email("请输入有效邮箱"),
  password: z.string().min(8, "密码至少 8 位").max(128, "密码过长"),
});
