import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSendReadiness } from "../src/features/campaigns/send-readiness.ts";
import {
  isQuotaExhausted,
  nextQuotaSlotText,
  planUsageFromDeliveryPlan,
  quotaUsageText,
} from "../src/features/workspace/plan-usage.ts";

const verifiedChannel = {
  display_name: "阿里云 DirectMail",
  status: "verified",
  sender_address: "shop@mail.example.test",
  credential_configured: true,
};

function context(overrides = {}) {
  return {
    primaryChannel: verifiedChannel,
    mailingAddress: "上海市测试路 1 号",
    quota: {
      daily_send_quota: 200,
      usage_today: 50,
      quota_timezone: "Asia/Shanghai",
    },
    maxRecipientsPerCampaign: 500,
    ...overrides,
  };
}

function failedKeys(readiness) {
  return readiness.items.filter((item) => !item.ok).map((item) => item.key);
}

test("P1-1 发送前检查：全部满足时可提交，且包含五项", () => {
  const readiness = evaluateSendReadiness(context(), 100);
  assert.equal(readiness.ready, true);
  assert.deepEqual(
    readiness.items.map((item) => item.key),
    ["channel", "sender", "footer", "quota", "recipients"],
  );
  const quota = readiness.items.find((item) => item.key === "quota");
  assert.match(quota.detail, /今日已用 50 \/ 200 封，剩余 150 封/);
});

test("P1-1 发送前检查：没有主通道或通道未验证时阻止并指向设置页", () => {
  const none = evaluateSendReadiness(context({ primaryChannel: null }), 10);
  assert.equal(none.ready, false);
  assert.deepEqual(failedKeys(none), ["channel", "sender"]);
  assert.equal(none.items[0].href, "/settings#settings-channels");

  const configured = evaluateSendReadiness(
    context({
      primaryChannel: { ...verifiedChannel, status: "configured" },
    }),
    10,
  );
  assert.deepEqual(failedKeys(configured), ["channel"]);
  assert.match(configured.items[0].detail, /尚未验证/);

  const noCredential = evaluateSendReadiness(
    context({
      primaryChannel: { ...verifiedChannel, credential_configured: false },
    }),
    10,
  );
  assert.deepEqual(failedKeys(noCredential), ["channel"]);
});

test("P1-1 发送前检查：页脚地址为空白、发件地址为空时阻止", () => {
  const footer = evaluateSendReadiness(context({ mailingAddress: "  " }), 10);
  assert.deepEqual(failedKeys(footer), ["footer"]);
  assert.equal(footer.items[2].linkLabel, "前往店铺信息");

  const sender = evaluateSendReadiness(
    context({ primaryChannel: { ...verifiedChannel, sender_address: " " } }),
    10,
  );
  assert.deepEqual(failedKeys(sender), ["sender"]);
});

test("P1-1 发送前检查：今日额度与数据库一致（已用 + 收件人 > 上限才阻止）", () => {
  assert.equal(evaluateSendReadiness(context(), 150).ready, true);
  const over = evaluateSendReadiness(context(), 151);
  assert.deepEqual(failedKeys(over), ["quota"]);
  assert.match(over.items[3].detail, /本次需要 151 封/);
  assert.equal(over.items[3].href, "/settings#settings-billing");
});

test("P1-1 发送前检查：额度读取失败时不阻止，由提交时校验", () => {
  const readiness = evaluateSendReadiness(context({ quota: null }), 10);
  assert.equal(readiness.ready, true);
  assert.match(readiness.items[3].detail, /提交时将由系统校验/);
});

test("P1-1 发送前检查：收件人数超过套餐单活动上限时阻止", () => {
  const over = evaluateSendReadiness(
    context({ maxRecipientsPerCampaign: 100 }),
    101,
  );
  assert.deepEqual(failedKeys(over), ["recipients"]);
  assert.equal(
    evaluateSendReadiness(context({ maxRecipientsPerCampaign: 100 }), 100)
      .ready,
    true,
  );
});

test("P1-12 套餐用量：复用 get_workspace_delivery_plan 字段，不限额时不展示", () => {
  const usage = planUsageFromDeliveryPlan({
    custom_templates: 3,
    max_custom_templates: 3,
    confirmed_campaigns_this_month: 1,
    max_confirmed_campaigns_per_month: 3,
    billable_contacts: 120,
    max_billable_contacts: 500,
  });
  assert.equal(quotaUsageText(usage.customTemplates), "已用 3 / 3");
  assert.equal(isQuotaExhausted(usage.customTemplates), true);
  assert.equal(quotaUsageText(usage.confirmedCampaignsThisMonth), "已用 1 / 3");
  assert.equal(
    nextQuotaSlotText(usage.confirmedCampaignsThisMonth),
    "将占用本月第 2 / 3 次",
  );
  assert.equal(isQuotaExhausted(usage.confirmedCampaignsThisMonth), false);
  assert.equal(quotaUsageText(usage.billableContacts), "已用 120 / 500");

  const unlimited = planUsageFromDeliveryPlan({
    custom_templates: 40,
    max_custom_templates: null,
    confirmed_campaigns_this_month: 9,
    max_confirmed_campaigns_per_month: null,
    billable_contacts: 1,
    max_billable_contacts: 5000,
  });
  assert.equal(quotaUsageText(unlimited.customTemplates), null);
  assert.equal(isQuotaExhausted(unlimited.customTemplates), false);
  assert.equal(isQuotaExhausted(unlimited.confirmedCampaignsThisMonth), false);

  assert.equal(planUsageFromDeliveryPlan(null), null);
  assert.equal(isQuotaExhausted(null), false);
});
