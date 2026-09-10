import { z } from "zod";

export const templateVariables = [
  { key: "name", label: "客户姓名" },
  { key: "email", label: "客户邮箱" },
  { key: "store_name", label: "店铺名称" },
  { key: "sender_name", label: "发件人" },
  { key: "discount", label: "优惠信息" },
  { key: "product", label: "商品名称" },
  { key: "order_number", label: "订单号" },
] as const;

export type TemplateVariable = (typeof templateVariables)[number]["key"];
export type TemplateValues = Record<TemplateVariable, string>;

const allowedVariables = new Set<string>(
  templateVariables.map((variable) => variable.key),
);
const tokenPattern = /{{([\s\S]*?)}}/g;

export type TemplateValidationError = {
  field: "subject" | "body";
  message: string;
};

function validateField(value: string, field: TemplateValidationError["field"]) {
  const errors: TemplateValidationError[] = [];
  const stripped = value.replace(tokenPattern, (_match, raw: string) => {
    const key = raw.trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      errors.push({ field, message: `变量“${raw}”语法无效` });
    } else if (!allowedVariables.has(key)) {
      errors.push({ field, message: `未知变量 {{${key}}}` });
    }
    return "";
  });
  if (stripped.includes("{{") || stripped.includes("}}")) {
    errors.push({ field, message: "存在未闭合的双花括号" });
  }
  return errors;
}

export function validateTemplateText(subject: string, body: string) {
  return [...validateField(subject, "subject"), ...validateField(body, "body")];
}

function renderField(value: string, values: TemplateValues) {
  const missing = new Set<TemplateVariable>();
  const rendered = value.replace(tokenPattern, (_match, raw: string) => {
    const key = raw.trim() as TemplateVariable;
    let replacement = values[key]?.trim() ?? "";
    if (!replacement && key === "name") {
      replacement = values.email.split("@")[0]?.trim() ?? "";
    }
    if (!replacement) {
      missing.add(key);
      return `【缺少：${key}】`;
    }
    return replacement;
  });
  return { rendered, missing };
}

export function renderTemplate(
  subject: string,
  body: string,
  values: TemplateValues,
) {
  const renderedSubject = renderField(subject, values);
  const renderedBody = renderField(body, values);
  return {
    subject: renderedSubject.rendered,
    body: renderedBody.rendered,
    missing: [
      ...new Set([...renderedSubject.missing, ...renderedBody.missing]),
    ],
  };
}

export const templateInput = z
  .object({
    workspace_id: z.string().uuid(),
    id: z.string().uuid().optional(),
    expected_version: z.number().int().positive().optional(),
    name: z.string().trim().min(1, "请输入模板名称").max(80),
    category: z.string().trim().min(1, "请输入分类").max(50),
    subject: z
      .string()
      .trim()
      .min(1, "请输入邮件主题")
      .max(200)
      .refine((value) => !/[\r\n]/.test(value), "邮件主题不能换行"),
    body: z
      .string()
      .refine((value) => value.trim().length > 0, "请输入邮件正文")
      .refine((value) => value.length <= 20000, "邮件正文最多 20000 字"),
  })
  .superRefine((value, context) => {
    for (const error of validateTemplateText(value.subject, value.body)) {
      context.addIssue({
        code: "custom",
        path: [error.field],
        message: error.message,
      });
    }
  });

export type Template = {
  id: string;
  workspace_id: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  default_key: string | null;
  source_template_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export type TemplateList = {
  items: Template[];
  total: number;
  page: number;
  active_count: number;
};
