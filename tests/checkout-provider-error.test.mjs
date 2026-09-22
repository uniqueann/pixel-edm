import test from "node:test";
import assert from "node:assert/strict";
import { describeCheckoutProviderFailure } from "../src/lib/billing/checkout-provider-error.ts";

test("支付渠道拒绝优惠码时给出可读提示", () => {
  const dodo = describeCheckoutProviderFailure({
    provider: "dodo",
    detail:
      "422 Invalid Discount Code / Discount Code cannot be applied to any product in the cart",
    hadDiscountCode: true,
  });
  assert.equal(dodo.reason, "discount");
  assert.match(dodo.message, /优惠码无效/);
  assert.doesNotMatch(dodo.message, /422|INVALID_DISCOUNT/);

  const creem = describeCheckoutProviderFailure({
    provider: "creem",
    detail:
      '{"status":404,"error":"Bad Request","message":["Discount code not found"]}',
    hadDiscountCode: true,
  });
  assert.equal(creem.reason, "discount");
  assert.match(creem.message, /留空直接结账/);
});

test("商品不存在不误报成优惠码错误", () => {
  const failure = describeCheckoutProviderFailure({
    provider: "dodo",
    detail:
      "422 Product pdt_example does not exist. Discount code was also sent",
    hadDiscountCode: true,
  });
  assert.equal(failure.reason, "provider");
  assert.match(failure.message, /暂时无法创建结账/);
  assert.doesNotMatch(failure.message, /pdt_example|Discount/);
});

test("没有填写优惠码时不把其他失败说成优惠码问题", () => {
  const failure = describeCheckoutProviderFailure({
    provider: "creem",
    detail: "Discount code not found",
    hadDiscountCode: false,
  });
  assert.equal(failure.reason, "provider");
});
