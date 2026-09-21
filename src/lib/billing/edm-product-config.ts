import type { EdmBilledPlan } from "./metadata";
import { getCreemEdmProductId } from "./creem";
import { getDodoEdmProductId } from "./dodo";

function tryProductId(
  provider: "creem" | "dodo",
  plan: EdmBilledPlan,
  interval: "monthly" | "yearly",
) {
  try {
    const id =
      provider === "creem"
        ? getCreemEdmProductId(plan, interval)
        : getDodoEdmProductId(plan, interval);
    return id.length > 0;
  } catch {
    return false;
  }
}

/** 某档位是否至少有一个支付通道已配置商品 ID（月付即可代表该档可售）。 */
export function isEdmPlanCheckoutConfigured(plan: EdmBilledPlan) {
  return (
    tryProductId("creem", plan, "monthly") ||
    tryProductId("dodo", plan, "monthly")
  );
}

export function edmCheckoutAvailability() {
  return {
    pro: isEdmPlanCheckoutConfigured("pro"),
    team: isEdmPlanCheckoutConfigured("team"),
  };
}
