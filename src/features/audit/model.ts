export const activityLabels: Record<string, string> = {
  "contact.created": "添加客户",
  "contact.updated": "编辑客户",
  "contact.archived": "归档客户",
  "contact.restored": "恢复客户",
  "contact.unsubscribed": "客户退订",
  "contact_import.completed": "完成名单导入",
  "template.created": "新建模板",
  "template.updated": "编辑模板",
  "template.duplicated": "复制模板",
  "template.archived": "归档模板",
  "template.restored": "恢复模板",
  "template.defaults_initialized": "初始化默认模板",
};

export type ActivityLog = {
  id: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: "system" | "admin" | "editor" | "viewer";
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ActivityLogList = {
  items: ActivityLog[];
  total: number;
  page: number;
  page_size: number;
  actors: { id: string; name: string }[];
};
