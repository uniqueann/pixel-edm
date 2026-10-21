export const activityLabels: Record<string, string> = {
  "contact.created": "添加客户",
  "contact.updated": "编辑客户",
  "contact.archived": "归档客户",
  "contact.restored": "恢复客户",
  "contact.unsubscribed": "客户退订",
  "contact.unsubscribed_public": "通过退订链接退订",
  "contact_import.completed": "完成名单导入",
  "template.created": "新建模板",
  "template.updated": "编辑模板",
  "template.duplicated": "复制模板",
  "template.archived": "归档模板",
  "template.restored": "恢复模板",
  "template.defaults_initialized": "初始化默认模板",
  "campaign.created": "新建活动草稿",
  "campaign.updated": "编辑活动草稿",
  "campaign.archived": "归档活动",
  "campaign.restored": "恢复活动",
  "campaign.confirmed": "确认活动名单",
  "campaign.csv_exported": "导出活动 CSV",
  "campaign.duplicated": "复制活动草稿",
  "campaign.delivery_started": "开始正式发送",
  "campaign.delivery_completed": "正式发送完成",
  "campaign.delivery_paused": "暂停正式发送",
  "campaign.delivery_resumed": "继续正式发送",
  "campaign.delivery_aborted": "放弃剩余发送",
  "campaign.delivery_unknown_resolved": "核对未知发送结果",
  "delivery_channel.configured": "连接发信通道",
  "delivery_channel.updated": "更新发信通道",
  "delivery_channel.credentials_rotated": "更换发信密钥",
  "delivery_channel.disconnected": "断开发信通道",
  "delivery_channel.primary_set": "设为主发信通道",
  "delivery_channel.test_started": "开始测试发信",
  "delivery_channel.test_accepted": "测试发信已接收",
  "delivery_channel.test_failed": "测试发信失败",
  "delivery_channel.test_unknown": "测试发信结果未知",
  "delivery_tracking.configured": "更新行为追踪",
  "delivery_webhook.configured": "配置投递回执",
  "delivery_webhook.revoked": "停用投递回执",
  "team.invitation_created": "创建团队邀请",
  "team.invitation_resent": "重发团队邀请",
  "team.invitation_revoked": "撤销团队邀请",
  "team.invitation_accepted": "接受团队邀请",
  "team.invitation_expired": "团队邀请过期",
  "team.member_role_changed": "调整成员角色",
  "team.member_removed": "移除团队成员",
  "team.owner_transferred": "转移工作区所有权",
  "workspace.converted_to_team": "升级为团队工作区",
};

/** 已知操作显示中文标题；未登记的 key 不把原始标识直接给用户。 */
export function activityLabel(action: string) {
  const known = activityLabels[action];
  if (known) return known;
  if (action.startsWith("contact")) return "客户相关操作";
  if (action.startsWith("campaign")) return "活动相关操作";
  if (action.startsWith("template")) return "模板相关操作";
  if (action.startsWith("delivery_")) return "发信相关操作";
  if (action.startsWith("team.") || action.startsWith("workspace."))
    return "团队相关操作";
  return "其他操作";
}

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
  retention_days?: number | null;
};
