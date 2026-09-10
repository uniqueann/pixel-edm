import Papa from "papaparse";
import type { ImportSourceRow } from "./import-model";

const aliases = {
  email: ["email", "邮箱"],
  name: ["name", "姓名"],
  tags: ["tags", "标签"],
  subscription_status: ["subscription_status", "订阅状态"],
  consent_source: ["consent_source", "同意来源"],
  consent_note: ["consent_note", "同意证据说明"],
  consent_at: ["consent_at", "同意时间"],
} as const;

type ImportField = keyof typeof aliases;

function fieldFor(value: string): ImportField | undefined {
  const normalized = value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
  return (Object.keys(aliases) as ImportField[]).find((field) =>
    aliases[field].some((alias) => alias === normalized),
  );
}

export function parseImportText(
  text: string,
  options: { sourceType: "paste" | "csv"; delimiter: "" | "," | "\t" },
) {
  if (new Blob([text]).size > 2 * 1024 * 1024)
    throw new Error("文件或粘贴内容不能超过 2 MiB");
  if (text.includes("�"))
    throw new Error("文件编码无法识别，请另存为 UTF-8 CSV");
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    delimiter: options.delimiter,
    skipEmptyLines: "greedy",
  });
  if (!parsed.data.length) throw new Error("名单中没有数据");
  if (parsed.data.length > 1001) throw new Error("每次最多导入 1000 行");

  const first = parsed.data[0].map((value) => fieldFor(String(value ?? "")));
  const hasHeader = first.includes("email");
  if (options.sourceType === "csv" && !hasHeader)
    throw new Error("CSV 必须包含 email 或 邮箱 表头");
  const fields: (ImportField | undefined)[] = hasHeader
    ? first
    : ["email", "name", "tags"];
  const warnings = hasHeader
    ? parsed.data[0]
        .filter((_, index) => !fields[index])
        .map((header) => `已忽略未知列：${header}`)
    : [];
  const start = hasHeader ? 1 : 0;
  const sourceRows = parsed.data.slice(start);
  if (sourceRows.length > 1000) throw new Error("每次最多导入 1000 行");
  const rows: ImportSourceRow[] = sourceRows.map((values, index) => {
    const row: ImportSourceRow = {
      source_row: index + start + 1,
      email: "",
    };
    values.forEach((value, column) => {
      const field = fields[column];
      if (field) row[field] = String(value ?? "");
    });
    const errors = parsed.errors
      .filter((error) => error.row === index + start)
      .map((error) => error.message);
    if (errors.length) row.parse_error = errors.join("；");
    return row;
  });
  if (!rows.length) throw new Error("名单中没有数据行");
  return { rows, warnings };
}

export function csvCell(value: unknown) {
  let text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
