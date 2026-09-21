import type { EdmBilledPlan } from "./metadata";

/** 对外展示用定价（与 Creem/Dodo Dashboard 商品价保持一致） */
export const EDM_PLAN_PRICING: Record<
  EdmBilledPlan,
  { monthlyUsd: number; yearlyUsd: number }
> = {
  pro: { monthlyUsd: 9.9, yearlyUsd: 99.9 },
  team: { monthlyUsd: 29.9, yearlyUsd: 299.9 },
};

export function formatUsd(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function edmPlanCheckoutDescription(
  plan: EdmBilledPlan,
  interval: "monthly" | "yearly",
) {
  const cycle = interval === "yearly" ? "年付" : "月付";
  if (plan === "team") {
    return `团队版（${cycle}）：最多 25,000 位有效客户、20 个团队席位、完整操作日志与成员邀请；含专业版发信与打开/点击统计。`;
  }
  return `专业版（${cycle}）：最多 5,000 位有效客户、不限自定义模板与活动确认、打开/点击统计与 7 日操作日志；单人使用。`;
}

export function edmPlanShortLabel(plan: EdmBilledPlan) {
  return plan === "team" ? "团队版" : "专业版";
}
