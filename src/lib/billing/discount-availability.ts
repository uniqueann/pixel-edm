export type DiscountChannelCheck = {
  available: boolean;
  message: string;
  percentOff?: number;
};

export type DodoDiscountSnapshot = {
  type: "percentage" | "flat";
  /** 百分比折扣用基点，1000 表示 10%。 */
  amount: number;
  expires_at?: string | null;
  starts_at?: string | null;
  usage_limit?: number | null;
  times_used: number;
  restricted_to?: string[] | null;
};

const MISSING = "折扣代码不存在";
const UNAVAILABLE_ENV = "当前环境还不能验证这个折扣代码。";
const RETRY = "暂时无法验证这个折扣代码，请稍后重试。";

export function discountSavingsMessage(percentOff: number) {
  const rounded = Math.round(percentOff * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `太棒了！你节省了 ${label}%！`;
}

export function configBlockedDiscountCheck(
  detail: string,
): DiscountChannelCheck {
  if (detail.includes("未配置")) {
    return { available: false, message: UNAVAILABLE_ENV };
  }
  return { available: false, message: RETRY };
}

export function missingDiscountCheck(): DiscountChannelCheck {
  return { available: false, message: MISSING };
}

/** 根据 Dodo 折扣记录判断当前商品能不能用。 */
export function assessDodoDiscount(
  discount: DodoDiscountSnapshot,
  productId: string,
  now = new Date(),
): DiscountChannelCheck {
  const starts = discount.starts_at ? new Date(discount.starts_at) : null;
  if (starts && !Number.isNaN(starts.getTime()) && starts > now) {
    return { available: false, message: "这个折扣代码尚未生效" };
  }
  const expires = discount.expires_at ? new Date(discount.expires_at) : null;
  if (expires && !Number.isNaN(expires.getTime()) && expires <= now) {
    return { available: false, message: "这个折扣代码已过期" };
  }
  if (
    discount.usage_limit != null &&
    discount.times_used >= discount.usage_limit
  ) {
    return { available: false, message: "这个折扣代码已用完" };
  }
  const restricted = discount.restricted_to ?? [];
  if (restricted.length > 0 && !restricted.includes(productId)) {
    return { available: false, message: "这个折扣代码不能用于当前套餐" };
  }
  if (discount.type === "percentage") {
    const percentOff = discount.amount / 100;
    return {
      available: true,
      message: discountSavingsMessage(percentOff),
      percentOff,
    };
  }
  return { available: true, message: "太棒了！这个折扣代码可用。" };
}

/** Creem 结账响应里的 discount。percentage 的 amount 是百分数，10 表示 10%。 */
export function assessCreemCheckoutDiscount(
  discount: {
    type?: string | null;
    amount?: number | null;
  } | null,
): DiscountChannelCheck {
  if (!discount) return missingDiscountCheck();
  if (discount.type === "percentage" && typeof discount.amount === "number") {
    return {
      available: true,
      message: discountSavingsMessage(discount.amount),
      percentOff: discount.amount,
    };
  }
  return { available: true, message: "太棒了！这个折扣代码可用。" };
}

export function summarizeDiscountChannels(input: {
  creem: DiscountChannelCheck;
  dodo: DiscountChannelCheck;
}) {
  const creem = input.creem.available;
  const dodo = input.dodo.available;
  if (creem && dodo) {
    const samePercent =
      input.creem.percentOff != null &&
      input.creem.percentOff === input.dodo.percentOff;
    return {
      available: true,
      creem,
      dodo,
      message: samePercent
        ? discountSavingsMessage(input.creem.percentOff!)
        : "太棒了！这个折扣代码可用。",
    };
  }
  if (creem || dodo) {
    const hit = creem ? input.creem : input.dodo;
    const name = creem ? "Creem" : "Dodo Payments";
    const base =
      hit.percentOff != null
        ? discountSavingsMessage(hit.percentOff)
        : "太棒了！这个折扣代码可用。";
    return {
      available: true,
      creem,
      dodo,
      message: `${base}仅适用于 ${name}。`,
    };
  }
  return {
    available: false,
    creem: false,
    dodo: false,
    message: pickRejectionMessage(input.creem.message, input.dodo.message),
  };
}

function pickRejectionMessage(creem: string, dodo: string) {
  if (creem === dodo) return creem;
  const specific = [creem, dodo].find(
    (message) =>
      message !== MISSING && message !== UNAVAILABLE_ENV && message !== RETRY,
  );
  if (specific) return specific;
  if (creem === MISSING || dodo === MISSING) return MISSING;
  return RETRY;
}
