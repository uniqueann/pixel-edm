import test from "node:test";
import assert from "node:assert/strict";
import {
  assessDodoDiscount,
  summarizeDiscountChannels,
} from "../src/lib/billing/discount-availability.ts";

const now = new Date("2026-09-22T00:00:00Z");

test("Dodo 百分比折扣按基点换算，并限制商品", () => {
  const ok = assessDodoDiscount(
    {
      type: "percentage",
      amount: 1000,
      times_used: 0,
      restricted_to: ["pdt_team"],
    },
    "pdt_team",
    now,
  );
  assert.equal(ok.available, true);
  assert.equal(ok.percentOff, 10);
  assert.equal(ok.message, "太棒了！你节省了 10%！");

  const blocked = assessDodoDiscount(
    {
      type: "percentage",
      amount: 1000,
      times_used: 0,
      restricted_to: ["pdt_other"],
    },
    "pdt_team",
    now,
  );
  assert.equal(blocked.available, false);
  assert.match(blocked.message, /不能用于当前套餐/);
});

test("Dodo 过期、未生效和用完都会拒绝", () => {
  assert.match(
    assessDodoDiscount(
      {
        type: "percentage",
        amount: 1000,
        times_used: 0,
        expires_at: "2026-09-01T00:00:00Z",
      },
      "pdt",
      now,
    ).message,
    /已过期/,
  );
  assert.match(
    assessDodoDiscount(
      {
        type: "percentage",
        amount: 1000,
        times_used: 0,
        starts_at: "2026-10-01T00:00:00Z",
      },
      "pdt",
      now,
    ).message,
    /尚未生效/,
  );
  assert.match(
    assessDodoDiscount(
      {
        type: "flat",
        amount: 100,
        times_used: 2,
        usage_limit: 2,
      },
      "pdt",
      now,
    ).message,
    /已用完/,
  );
});

test("两个渠道都可用且折扣相同", () => {
  const channel = {
    available: true,
    message: "太棒了！你节省了 10%！",
    percentOff: 10,
  };
  const summary = summarizeDiscountChannels({ creem: channel, dodo: channel });
  assert.equal(summary.available, true);
  assert.equal(summary.creem, true);
  assert.equal(summary.dodo, true);
  assert.equal(summary.message, "太棒了！你节省了 10%！");
});

test("只有一个渠道可用时说明适用渠道", () => {
  const summary = summarizeDiscountChannels({
    creem: { available: false, message: "折扣代码不存在" },
    dodo: {
      available: true,
      message: "太棒了！你节省了 10%！",
      percentOff: 10,
    },
  });
  assert.equal(summary.creem, false);
  assert.equal(summary.dodo, true);
  assert.match(summary.message, /节省了 10%/);
  assert.match(summary.message, /Dodo Payments/);
});

test("两边都不存在时给出同一句拒绝", () => {
  const summary = summarizeDiscountChannels({
    creem: { available: false, message: "折扣代码不存在" },
    dodo: { available: false, message: "折扣代码不存在" },
  });
  assert.equal(summary.available, false);
  assert.equal(summary.message, "折扣代码不存在");
});

test("Creem 接受优惠码但未返回折扣金额时，不误报百分比", () => {
  const summary = summarizeDiscountChannels({
    creem: { available: true, message: "Creem 已接受优惠码" },
    dodo: {
      available: true,
      message: "太棒了！你节省了 10%！",
      percentOff: 10,
    },
  });
  assert.equal(summary.creem, true);
  assert.equal(summary.dodo, true);
  assert.match(summary.message, /两个支付渠道/);
  assert.doesNotMatch(summary.message, /节省了 10%/);
});
