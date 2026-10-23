/** settings?checkout=error 时 toast 文案；仅认 reason，不读 URL 中的 msg。 */

export type CheckoutErrorReason =
  | "missing_product"
  | "config"
  | "provider"
  | "discount"
  | "auth"
  | "forbidden"
  | "plan";

function planLabel(planParam: string | null) {
  if (planParam === "team") return "团队版";
  if (planParam === "pro") return "专业版";
  return "该档位";
}

export function checkoutErrorToast(input: {
  reason: string | null;
  plan: string | null;
}): { title: string; description: string } {
  const { reason, plan } = input;
  switch (reason as CheckoutErrorReason) {
    case "missing_product":
      return {
        title: "暂时无法跳转支付",
        description: "支付服务暂未就绪，请稍后重试或联系客服。",
      };
    case "discount":
      return {
        title: "优惠码无效",
        description:
          "优惠码无效或不能用于当前套餐。请检查后再试，也可以留空直接结账。",
      };
    case "auth":
      return {
        title: "请先登录",
        description: "登录后再继续结账或管理订阅。",
      };
    case "forbidden":
      return {
        title: "暂无权限",
        description: "仅工作区管理员可升级套餐或取消续费。",
      };
    case "plan":
      return {
        title: "套餐已变化",
        description: `当前工作区已不符合购买${planLabel(plan)}的条件，请刷新设置页后重试。`,
      };
    case "provider":
      return {
        title: "支付平台暂时不可用",
        description:
          "请稍后重试；若持续失败，可通过付款收据邮件中的「管理订阅」处理。",
      };
    case "config":
      return {
        title: "暂时无法完成操作",
        description: "请稍后重试，或联系管理员检查订阅与支付配置。",
      };
    default:
      return {
        title: "结账未完成",
        description: "请稍后重试，或联系管理员检查支付配置。",
      };
  }
}
