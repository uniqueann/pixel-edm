import test from "node:test";
import assert from "node:assert/strict";
import { checkoutErrorToast } from "../src/lib/billing/checkout-toast-copy.ts";

test("checkoutErrorToast 只按 reason 映射，忽略 msg", () => {
  const discount = checkoutErrorToast({ reason: "discount", plan: null });
  assert.equal(discount.title, "优惠码无效");
  assert.match(discount.description, /留空直接结账/);

  const auth = checkoutErrorToast({ reason: "auth", plan: null });
  assert.match(auth.description, /登录/);

  const plan = checkoutErrorToast({ reason: "plan", plan: "pro" });
  assert.match(plan.description, /专业版/);

  const unknown = checkoutErrorToast({ reason: "crafted", plan: null });
  assert.equal(unknown.title, "结账未完成");
});
