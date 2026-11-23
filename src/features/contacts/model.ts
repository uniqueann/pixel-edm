import { z } from "zod";
import type { SubscriptionStatus } from "./import-model";
export const contactInput = z
  .object({
    workspace_id: z.string().uuid(),
    id: z.string().uuid().optional(),
    expected_version: z.number().int().positive().optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("validation.emailInvalid")
      .max(254),
    name: z.string().trim().max(100, "validation.contactNameTooLong"),
    tags: z
      .array(z.string().trim().min(1).max(30, "validation.contactTagTooLong"))
      .max(20, "validation.contactTagsTooMany"),
    consent_declared: z.boolean().optional(),
    consent_source: z
      .string()
      .trim()
      .max(100, "validation.consentSourceTooLong")
      .optional(),
    consent_note: z
      .string()
      .trim()
      .max(500, "validation.consentNoteTooLong")
      .optional(),
    consent_at: z.string().datetime().optional(),
  })
  .refine(
    (value) =>
      !value.consent_declared ||
      (Boolean(value.consent_source) && Boolean(value.consent_note)),
    {
      message: "validation.consentRequired",
      path: ["consent_note"],
    },
  );
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
  page_size?: number;
  active_count: number;
};
