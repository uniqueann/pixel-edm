/** 套餐与订阅展示文案（客户端/服务端共用）。 */

export function deliveryPlanLabel(planKey: string, displayName?: string) {
  const localized: Record<string, string> = {
    free: "免费版",
    pro: "专业版",
    team: "团队版",
  };
  return localized[planKey] ?? displayName ?? planKey;
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
