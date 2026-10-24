import { roleNames, teamRoles, type TeamRole } from "./model";

/** 各角色能力说明（不含角色名前缀），须与页面门禁、Server Action 权限一致。 */
export const roleDescriptions: Record<TeamRole, string> = {
  admin:
    "工作区设置、发信通道、行为追踪与 Webhook、团队成员与套餐、正式发送、操作记录（视套餐）。",
  editor:
    "客户与模板管理、活动草稿/预览/确认名单、导出 CSV；不可改工作区设置、发信通道、正式发送或查看操作记录。",
  viewer:
    "只读查看客户、模板、活动与投递统计；不可修改数据或设置，也不能开始正式发送或查看操作记录。",
};

/** 帮助页「角色与权限」列表项。 */
export const roleHelpBullets = teamRoles.map(
  (role) => `${roleNames[role]}：${roleDescriptions[role]}`,
);

/** 邀请弹窗中选中角色时的单行说明。 */
export function inviteRoleBlurb(role: TeamRole): string {
  return `${roleNames[role]}：${roleDescriptions[role]}`;
}
