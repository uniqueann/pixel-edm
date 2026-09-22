/** 把支付渠道拒绝结账的原文收成设置页能展示的短句，不把 JSON 直接给用户。 */
const DISCOUNT_MESSAGE =
  "优惠码无效或不能用于当前套餐。请检查后再试，也可以留空直接结账。";

export function describeCheckoutProviderFailure(input: {
  provider: "creem" | "dodo";
  detail: string;
  hadDiscountCode: boolean;
}): { reason: "discount" | "provider"; message: string } {
  const detail = input.detail.replace(/\s+/g, " ").trim();
  if (input.hadDiscountCode && isDiscountRejection(detail)) {
    return { reason: "discount", message: DISCOUNT_MESSAGE };
  }
  const name = input.provider === "creem" ? "Creem" : "Dodo Payments";
  return {
    reason: "provider",
    message: `${name} 暂时无法创建结账，请稍后重试。`,
  };
}

function isDiscountRejection(detail: string) {
  // 商品 ID 不存在时原文也可能带 product，不能当成优惠码错误。
  if (/product not found|product\b.{0,80}does not exist/i.test(detail)) {
    return false;
  }
  return /discount|coupon|优惠码|invalid_discount_code/i.test(detail);
}
