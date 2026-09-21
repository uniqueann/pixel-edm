import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCreemDiscountCode } from "../src/lib/billing/creem.ts";

test("Creem 优惠码规范化", () => {
  assert.equal(normalizeCreemDiscountCode("  welcome10 "), "WELCOME10");
  assert.equal(normalizeCreemDiscountCode(""), "");
  assert.equal(normalizeCreemDiscountCode(null), "");
  assert.throws(
    () => normalizeCreemDiscountCode("WELCOME-10"),
    /仅支持 1-14 位大写字母或数字/,
  );
  assert.throws(
    () => normalizeCreemDiscountCode("123456789012345"),
    /仅支持 1-14 位大写字母或数字/,
  );
});
