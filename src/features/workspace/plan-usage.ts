import type { WorkspaceDeliveryPlan } from "./delivery-plan";

/** 单项套餐用量；max 为 null 表示当前套餐不限。 */
export type PlanQuota = { used: number; max: number | null };

export type PlanUsage = {
  customTemplates: PlanQuota;
  confirmedCampaignsThisMonth: PlanQuota;
  billableContacts: PlanQuota;
};

/** 仅复用 get_workspace_delivery_plan 已返回的数据，不新增计费规则。 */
export function planUsageFromDeliveryPlan(
  plan: WorkspaceDeliveryPlan | null,
): PlanUsage | null {
  if (!plan) return null;
  return {
    customTemplates: {
      used: plan.custom_templates,
      max: plan.max_custom_templates,
    },
    confirmedCampaignsThisMonth: {
      used: plan.confirmed_campaigns_this_month,
      max: plan.max_confirmed_campaigns_per_month,
    },
    billableContacts: {
      used: plan.billable_contacts,
      max: plan.max_billable_contacts,
    },
  };
}

export function isQuotaLimited(quota: PlanQuota | null | undefined) {
  return Boolean(quota) && quota!.max !== null;
}

export function isQuotaExhausted(quota: PlanQuota | null | undefined) {
  return isQuotaLimited(quota) && quota!.used >= (quota!.max as number);
}

/** 例如“已用 2 / 3”。不限额的套餐返回 null，界面不展示用量。 */
export function quotaUsageText(quota: PlanQuota | null | undefined) {
  if (!quota || quota.max === null) return null;
  return `已用 ${quota.used} / ${quota.max}`;
}

/** 确认操作将占用的额度序号，例如「将占用本月第 2 / 3 次」。 */
export function nextQuotaSlotText(quota: PlanQuota | null | undefined) {
  if (!quota || quota.max === null) return null;
  const next = Math.min(quota.used + 1, quota.max);
  return `将占用本月第 ${next} / ${quota.max} 次`;
}
