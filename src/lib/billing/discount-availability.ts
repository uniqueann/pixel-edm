export type DiscountMessageParams = Record<string, string | number>;

export type DiscountChannelCheck = {
  available: boolean;
  message: string;
  messageCode?: string;
  messageParams?: DiscountMessageParams;
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

const CODE_MISSING = "errors.billing.discountMissing";
const CODE_UNAVAILABLE_ENV = "errors.billing.configMissing";
const CODE_RETRY = "errors.billing.discountRetry";

const MISSING = "折扣代码不存在";
const UNAVAILABLE_ENV = "当前环境还不能验证这个折扣代码。";
const RETRY = "暂时无法验证这个折扣代码，请稍后重试。";

function formatPercentLabel(percentOff: number) {
  const rounded = Math.round(percentOff * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function discountSavingsMessage(percentOff: number) {
  return `太棒了！你节省了 ${formatPercentLabel(percentOff)}%！`;
}

export function isBillingConfigMissingError(error: unknown) {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === CODE_UNAVAILABLE_ENV
  );
}

/** 依据结构化错误码判断环境配置缺失；兼容字符串调用方。 */
export function configBlockedDiscountCheck(
  errorOrCode: unknown,
): DiscountChannelCheck {
  const isConfigMissing =
    isBillingConfigMissingError(errorOrCode) ||
    errorOrCode === CODE_UNAVAILABLE_ENV;
  if (isConfigMissing) {
    return {
      available: false,
      messageCode: CODE_UNAVAILABLE_ENV,
      message: UNAVAILABLE_ENV,
    };
  }
  return {
    available: false,
    messageCode: CODE_RETRY,
    message: RETRY,
  };
}

export function missingDiscountCheck(): DiscountChannelCheck {
  return {
    available: false,
    messageCode: CODE_MISSING,
    message: MISSING,
  };
}

export function retryDiscountCheck(): DiscountChannelCheck {
  return {
    available: false,
    messageCode: CODE_RETRY,
    message: RETRY,
  };
}

/** 根据 Dodo 折扣记录判断当前商品能不能用。 */
export function assessDodoDiscount(
  discount: DodoDiscountSnapshot,
  productId: string,
  now = new Date(),
): DiscountChannelCheck {
  const starts = discount.starts_at ? new Date(discount.starts_at) : null;
  if (starts && !Number.isNaN(starts.getTime()) && starts > now) {
    return {
      available: false,
      messageCode: "errors.billing.discountNotStarted",
      message: "这个折扣代码尚未生效",
    };
  }
  const expires = discount.expires_at ? new Date(discount.expires_at) : null;
  if (expires && !Number.isNaN(expires.getTime()) && expires <= now) {
    return {
      available: false,
      messageCode: "errors.billing.discountExpired",
      message: "这个折扣代码已过期",
    };
  }
  if (
    discount.usage_limit != null &&
    discount.times_used >= discount.usage_limit
  ) {
    return {
      available: false,
      messageCode: "errors.billing.discountDepleted",
      message: "这个折扣代码已用完",
    };
  }
  const restricted = discount.restricted_to ?? [];
  if (restricted.length > 0 && !restricted.includes(productId)) {
    return {
      available: false,
      messageCode: "errors.billing.discountPlanMismatch",
      message: "这个折扣代码不能用于当前套餐",
    };
  }
  if (discount.type === "percentage") {
    const percentOff = discount.amount / 100;
    const percent = formatPercentLabel(percentOff);
    return {
      available: true,
      messageCode: "errors.billing.discountSavings",
      messageParams: { percent },
      message: discountSavingsMessage(percentOff),
      percentOff,
    };
  }
  return {
    available: true,
    messageCode: "errors.billing.discountAvailable",
    message: "太棒了！这个折扣代码可用。",
  };
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
    if (samePercent) {
      const percent = formatPercentLabel(input.creem.percentOff!);
      return {
        available: true,
        creem,
        dodo,
        messageCode: "errors.billing.discountSavings",
        messageParams: { percent },
        message: discountSavingsMessage(input.creem.percentOff!),
      };
    }
    return {
      available: true,
      creem,
      dodo,
      messageCode: "errors.billing.discountBothChannels",
      message: "这个折扣代码可用于两种支付方式，最终优惠以结账页为准。",
    };
  }
  if (creem || dodo) {
    const hit = creem ? input.creem : input.dodo;
    if (hit.percentOff != null) {
      const percent = formatPercentLabel(hit.percentOff);
      return {
        available: true,
        creem,
        dodo,
        messageCode: "errors.billing.discountSingleChannelSavings",
        messageParams: { percent },
        message: `${discountSavingsMessage(hit.percentOff)}仅适用于其中一种支付方式。`,
      };
    }
    return {
      available: true,
      creem,
      dodo,
      messageCode: "errors.billing.discountSingleChannelAvailable",
      message: "太棒了！这个折扣代码可用。仅适用于其中一种支付方式。",
    };
  }
  const rejection = pickRejection(input.creem, input.dodo);
  return {
    available: false,
    creem: false,
    dodo: false,
    messageCode: rejection.messageCode,
    ...(rejection.messageParams
      ? { messageParams: rejection.messageParams }
      : {}),
    message: rejection.message,
  };
}

function isGenericRejection(item: DiscountChannelCheck) {
  if (item.messageCode) {
    return (
      item.messageCode === CODE_MISSING ||
      item.messageCode === CODE_UNAVAILABLE_ENV ||
      item.messageCode === CODE_RETRY
    );
  }
  return (
    item.message === MISSING ||
    item.message === UNAVAILABLE_ENV ||
    item.message === RETRY
  );
}

function pickRejection(
  creem: DiscountChannelCheck,
  dodo: DiscountChannelCheck,
) {
  if (creem.message === dodo.message) {
    return {
      messageCode:
        creem.messageCode ??
        dodo.messageCode ??
        (creem.message === MISSING
          ? CODE_MISSING
          : creem.message === UNAVAILABLE_ENV
            ? CODE_UNAVAILABLE_ENV
            : CODE_RETRY),
      messageParams: creem.messageParams ?? dodo.messageParams,
      message: creem.message,
    };
  }
  const specific = [creem, dodo].find((item) => !isGenericRejection(item));
  if (specific) {
    return {
      messageCode: specific.messageCode ?? CODE_RETRY,
      messageParams: specific.messageParams,
      message: specific.message,
    };
  }
  if (
    creem.messageCode === CODE_MISSING ||
    dodo.messageCode === CODE_MISSING ||
    creem.message === MISSING ||
    dodo.message === MISSING
  ) {
    return { messageCode: CODE_MISSING, message: MISSING };
  }
  return { messageCode: CODE_RETRY, message: RETRY };
}
