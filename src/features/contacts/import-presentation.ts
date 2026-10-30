import type { ContactImportRow } from "./import-model";

export const importJobStatusLabels: Record<string, string> = {
  completed: "已完成",
  prepared: "待确认",
  processing: "待继续",
  failed: "处理失败",
};

export const importResultLabels: Record<string, string> = {
  new: "将新增",
  update: "将更新",
  unchanged: "无变化",
  archived_skipped: "已归档（跳过）",
  suppressed_protected: "保留防打扰状态",
  suppressed: "加入防打扰名单",
  error: "错误",
  pending: "待处理",
  created: "已新增",
  updated: "已更新",
};

export function displayedImportResult(row: ContactImportRow) {
  return row.result === "pending" ? row.preview_result : row.result;
}

export function importRowExplanation(row: ContactImportRow) {
  const result = displayedImportResult(row);
  if (result === "archived_skipped") return "客户已归档，不会自动恢复。";
  if (result === "suppressed_protected")
    return "保留已有退订、投诉或硬退信保护，不会恢复订阅；资料仍按现有规则补全。";
  if (result === "suppressed")
    return "按名单中的退订、投诉或硬退信状态保护，不会发信。";
  if (result === "unchanged") return "现有资料无须更新，订阅状态保持不变。";
  return "";
}

export function formatImportTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
