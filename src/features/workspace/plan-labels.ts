/** 套餐与订阅展示文案（客户端/服务端共用）。 */

export function deliveryPlanLabel(planKey: string, displayName?: string) {
  const localized: Record<string, string> = {
    free: "免费版",
    pro: "专业版",
    team: "团队版",
  };
  return localized[planKey] ?? displayName ?? planKey;
}

/** 顶栏工作区徽标：优先展示套餐，团队版附带当前人数。 */
export function workspaceTopBadgeLabel(
  plan: {
    plan: string;
    plan_display_name: string;
    allows_team_collaboration: boolean;
    active_members: number;
  } | null,
  workspaceType: string,
) {
  if (!plan) {
    return workspaceType === "team" ? "团队工作区" : "个人工作区";
  }
  const label = deliveryPlanLabel(plan.plan, plan.plan_display_name);
  if (plan.allows_team_collaboration) {
    return `${label} · ${plan.active_members} 人`;
  }
  return label;
}

export function billingProviderLabel(provider: string | null) {
  if (provider === "creem") return "Creem";
  if (provider === "dodo") return "Dodo Payments";
  return null;
}

export function subscriptionStatusLabel(status: string) {
  const map: Record<string, string> = {
    none: "无订阅记录",
    inactive: "未激活",
    active: "生效中",
    trialing: "试用中",
    past_due: "待付款",
    canceled: "已取消",
    unpaid: "未付清",
    incomplete: "未完成",
  };
  return map[status] ?? status;
}
