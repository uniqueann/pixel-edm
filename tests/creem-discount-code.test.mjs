import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCheckoutDiscountCode } from "../src/lib/billing/discount-code.ts";

test("共享支付渠道优惠码规范化", () => {
  assert.equal(normalizeCheckoutDiscountCode("  welcome10 "), "WELCOME10");
  assert.equal(normalizeCheckoutDiscountCode(""), "");
  assert.equal(normalizeCheckoutDiscountCode(null), "");
  assert.throws(
    () => normalizeCheckoutDiscountCode("WELCOME-10"),
    /仅支持 1-14 位大写字母或数字/,
  );
  assert.throws(
    () => normalizeCheckoutDiscountCode("123456789012345"),
    /仅支持 1-14 位大写字母或数字/,
  );
});
