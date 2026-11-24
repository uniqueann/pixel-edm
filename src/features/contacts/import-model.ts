import { z } from "zod";

export const subscriptionStatuses = [
  "unconfirmed",
  "subscribed",
  "unsubscribed",
  "bounced",
  "complained",
] as const;

export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const subscriptionLabels: Record<SubscriptionStatus, string> = {
  unconfirmed: "未确认",
  subscribed: "已订阅",
  unsubscribed: "已退订",
  bounced: "硬退信",
  complained: "已投诉",
};

export type ImportSourceRow = {
  source_row: number;
  email: string;
  name?: string;
  tags?: string;
  subscription_status?: string;
  consent_source?: string;
  consent_note?: string;
  consent_at?: string;
  parse_error?: string;
};

export type NormalizedImportRow = {
  source_rows: number[];
  email: string;
  name: string;
  tags: string[];
  requested_status: SubscriptionStatus;
  consent_source: string;
  consent_note: string;
  consent_at: string;
  validation_error: string;
};

export type ContactImportJob = {
  id: string;
  source_type: "paste" | "csv";
  source_name: string;
  status: "prepared" | "processing" | "completed" | "failed";
  total_source_rows: number;
  total_groups: number;
  processed_groups: number;
  summary: Record<string, number>;
  created_at: string;
  updated_at: string;
};

export type ContactImportRow = NormalizedImportRow & {
  item_no: number;
  preview_result: string;
  result: string;
  message: string;
  contact_id: string | null;
};

export type ContactImportDetail = {
  job: ContactImportJob;
  rows: ContactImportRow[];
  row_total: number;
  page: number;
};

export type ContactImportHistory = Pick<
  ContactImportJob,
  | "id"
  | "source_type"
  | "source_name"
  | "status"
  | "total_source_rows"
  | "total_groups"
  | "processed_groups"
  | "summary"
  | "created_at"
  | "updated_at"
>[];

export const importRequestSchema = z.object({
  workspace_id: z.string().uuid(),
  source_type: z.enum(["paste", "csv"]),
  source_name: z
    .string()
    .trim()
    .min(1, "validation.importSourceNameRequired")
    .max(200),
  consent_declared: z.boolean(),
  consent_source: z.string().trim().max(100).default(""),
  consent_note: z.string().trim().max(500).default(""),
  consent_at: z.string().trim().max(40).default(""),
  rows: z
    .array(
      z.object({
        source_row: z.number().int().positive(),
        email: z.string().max(1000),
        name: z.string().max(1000).optional(),
        tags: z.string().max(3000).optional(),
        subscription_status: z.string().max(100).optional(),
        consent_source: z.string().max(1000).optional(),
        consent_note: z.string().max(2000).optional(),
        consent_at: z.string().max(100).optional(),
        parse_error: z.string().max(500).optional(),
      }),
    )
    .min(1, "validation.importEmpty")
    .max(1000, "validation.importTooManyRows"),
});

const statusAliases: Record<string, SubscriptionStatus> = {
  unconfirmed: "unconfirmed",
  未确认: "unconfirmed",
  subscribed: "subscribed",
  已订阅: "subscribed",
  unsubscribed: "unsubscribed",
  已退订: "unsubscribed",
  bounced: "bounced",
  硬退信: "bounced",
  complained: "complained",
  已投诉: "complained",
  投诉: "complained",
};

const statusWeight: Record<SubscriptionStatus, number> = {
  unconfirmed: 0,
  subscribed: 1,
  unsubscribed: 2,
  bounced: 3,
  complained: 4,
};

function validConsentTime(value: string) {
  if (!value) return true;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.now();
}

export type ImportMessagePart = {
  code: string;
  text: string;
};

const importMessageCodeMap: Record<string, string> = {
  邮箱格式无效: "errors.import.invalidEmail",
  "errors.import.invalidEmail": "errors.import.invalidEmail",
  "姓名最多 100 字": "errors.import.nameTooLong",
  订阅状态无法识别: "errors.import.invalidStatus",
  已订阅记录必须提供同意来源和证据说明: "errors.import.consentRequired",
  同意时间格式无效或晚于当前时间: "errors.import.invalidConsentTime",
  "标签最多 20 个，每个最多 30 字": "errors.import.tagsTooManyOrLong",
  "同意来源最多 100 字": "errors.import.consentSourceTooLong",
  "同意证据说明最多 500 字": "errors.import.consentNoteTooLong",
};

/** 将导入行说明解析为结构化条目并按 code/text 去重（兼容中文分号与英文分号）。 */
export function parseImportMessageParts(message: string): ImportMessagePart[] {
  const seen = new Set<string>();
  const parts: ImportMessagePart[] = [];
  for (const raw of message.split(/[；;]/)) {
    const text = raw.trim();
    if (!text) continue;
    const code = importMessageCodeMap[text] ?? "errors.import.raw";
    const dedupeKey = code === "errors.import.raw" ? `raw:${text}` : code;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    parts.push({ code, text });
  }
  return parts;
}

/** 预检说明去重拼接；客户端校验与数据库追加同一项时仅保留一条。 */
export function dedupeImportMessages(message: string, separator = "；") {
  return parseImportMessageParts(message)
    .map((part) => part.text)
    .join(separator);
}

export function isInvalidEmailImportMessage(message: string) {
  return parseImportMessageParts(message).some(
    (part) => part.code === "errors.import.invalidEmail",
  );
}

/** 展示用的不同邮箱数：排除格式无效地址，字段错误记录也按邮箱去重。 */
export function countDedupedValidEmails(
  rows: { email: string; message?: string; validation_error?: string }[],
) {
  return new Set(
    rows
      .filter(
        (row) =>
          !isInvalidEmailImportMessage(
            row.message ?? row.validation_error ?? "",
          ),
      )
      .map((row) => row.email.trim().toLowerCase()),
  ).size;
}

function splitTags(value = "") {
  const result: string[] = [];
  for (const item of value.split(/[|;；，、]/)) {
    const tag = item.trim();
    if (
      tag &&
      !result.some((current) => current.toLowerCase() === tag.toLowerCase())
    )
      result.push(tag);
  }
  return result;
}

export function normalizeImportRows(
  rows: ImportSourceRow[],
  batch: {
    consent_declared: boolean;
    consent_source: string;
    consent_note: string;
    consent_at: string;
  },
) {
  const emailSchema = z.string().trim().toLowerCase().email().max(254);
  const valid = new Map<string, NormalizedImportRow>();
  const invalid: NormalizedImportRow[] = [];

  for (const source of rows) {
    const emailResult = emailSchema.safeParse(source.email);
    const explicitStatus = (source.subscription_status ?? "")
      .trim()
      .toLowerCase();
    const parsedStatus = statusAliases[explicitStatus];
    const requestedStatus =
      parsedStatus ?? (batch.consent_declared ? "subscribed" : "unconfirmed");
    const consentSource = (
      source.consent_source ?? batch.consent_source
    ).trim();
    const consentNote = (source.consent_note ?? batch.consent_note).trim();
    const consentAt = (source.consent_at ?? batch.consent_at).trim();
    const tags = splitTags(source.tags);
    const errors = source.parse_error
      ? dedupeImportMessages(source.parse_error).split("；")
      : [];
    if (!emailResult.success && !errors.includes("邮箱格式无效"))
      errors.push("邮箱格式无效");
    if ((source.name?.trim().length ?? 0) > 100) errors.push("姓名最多 100 字");
    if (!parsedStatus && explicitStatus) errors.push("订阅状态无法识别");
    if (tags.some((tag) => tag.length > 30)) errors.push("标签最多 30 字");
    if (tags.length > 20) errors.push("每位客户最多 20 个标签");
    if (consentSource.length > 100) errors.push("同意来源最多 100 字");
    if (consentNote.length > 500) errors.push("证据说明最多 500 字");
    if (!validConsentTime(consentAt))
      errors.push("同意时间须含时区且不能晚于当前时间");
    if (requestedStatus === "subscribed" && (!consentSource || !consentNote))
      errors.push("已订阅记录必须提供同意来源和证据说明");

    const row: NormalizedImportRow = {
      source_rows: [source.source_row],
      email: emailResult.success
        ? emailResult.data
        : source.email.trim().toLowerCase(),
      name: (source.name ?? "").trim(),
      tags,
      requested_status: requestedStatus,
      consent_source: consentSource,
      consent_note: consentNote,
      consent_at: consentAt,
      validation_error: dedupeImportMessages(errors.join("；")),
    };
    if (!emailResult.success || errors.length) {
      invalid.push(row);
      continue;
    }

    const current = valid.get(row.email);
    if (!current) {
      valid.set(row.email, row);
      continue;
    }
    current.source_rows.push(source.source_row);
    if (!current.name && row.name) current.name = row.name;
    for (const tag of row.tags)
      if (
        !current.tags.some((item) => item.toLowerCase() === tag.toLowerCase())
      )
        current.tags.push(tag);
    if (
      statusWeight[row.requested_status] >
      statusWeight[current.requested_status]
    ) {
      current.requested_status = row.requested_status;
      current.consent_source = row.consent_source;
      current.consent_note = row.consent_note;
      current.consent_at = row.consent_at;
    }
    if (current.tags.length > 20)
      current.validation_error = "同邮箱合并后标签超过 20 个";
  }
  return [...valid.values(), ...invalid];
}
