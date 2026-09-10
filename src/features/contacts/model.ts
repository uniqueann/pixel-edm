import { z } from "zod";
import type { SubscriptionStatus } from "./import-model";
export const contactInput = z.object({
  workspace_id: z.string().uuid(),
  id: z.string().uuid().optional(),
  expected_version: z.number().int().positive().optional(),
  email: z.string().trim().toLowerCase().email("请输入有效邮箱").max(254),
  name: z.string().trim().max(100, "姓名最多 100 字"),
  tags: z
    .array(z.string().trim().min(1).max(30, "标签最多 30 字"))
    .max(20, "每位客户最多 20 个标签"),
});
export type Tag = { id: string; name: string };
export type Contact = {
  id: string;
  email: string;
  name: string;
  version: number;
  archived_at: string | null;
  subscription_status: SubscriptionStatus;
  consent_source: string | null;
  consent_note: string | null;
  consent_at: string | null;
  tags: Tag[];
};
export type ContactList = {
  items: Contact[];
  tags: Tag[];
  total: number;
  page: number;
  active_count: number;
};
