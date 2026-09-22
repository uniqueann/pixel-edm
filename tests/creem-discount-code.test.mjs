import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCheckoutDiscountCode } from "../src/lib/billing/discount-code.ts";

test("共享支付渠道优惠码规范化", () => {
  assert.equal(normalizeCheckoutDiscountCode("  welcome10 "), "WELCOME10");
  assert.equal(normalizeCheckoutDiscountCode(""), "");
  assert.equal(normalizeCheckoutDiscountCode(null), "");
  assert.throws(
    () => normalizeCheckoutDiscountCode("WELCOME-10"),
    /折扣代码格式无效/,
  );
  assert.throws(
    () => normalizeCheckoutDiscountCode("123456789012345"),
    /折扣代码格式无效/,
  );
});
