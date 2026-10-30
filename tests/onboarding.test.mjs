import test from "node:test";
import assert from "node:assert/strict";
import {
  preparationModel,
  preparationPreferenceKey,
} from "../src/features/onboarding/model.ts";

function facts(overrides = {}) {
  return {
    role: "admin",
    canWrite: true,
    storeReady: false,
    channel: { ready: false, detail: "尚未连接" },
    contacts: { active: 0, subscribed: 0 },
    templates: 6,
    campaigns: 0,
    signatureReady: false,
    ...overrides,
  };
}

test("首次使用推荐店铺信息，预置模板按现有数据计入准备", () => {
  const model = preparationModel(facts());
  assert.equal(model.recommended.key, "store");
  assert.equal(model.completed, 1);
  assert.equal(
    model.items.find((item) => item.key === "templates").status,
    "done",
  );
});

test("已有客户不替代订阅，归档模板不能计入可用准备", () => {
  const model = preparationModel(
    facts({ contacts: { active: 8, subscribed: 0 }, templates: 0 }),
  );
  assert.equal(
    model.items.find((item) => item.key === "contacts").status,
    "todo",
  );
  assert.equal(
    model.items.find((item) => item.key === "templates").status,
    "todo",
  );
  assert.equal(model.completed, 0);
});

test("读取失败保持待核对，不被解释为未配置或已完成", () => {
  const model = preparationModel(
    facts({ channel: null, contacts: null, templates: null, campaigns: null }),
  );
  assert.equal(model.unknown, true);
  assert.equal(model.hasCampaigns, null);
  assert.equal(model.completed, 0);
  assert.deepEqual(
    model.items.slice(1).map((item) => item.status),
    ["unknown", "unknown", "unknown"],
  );
});

test("默认个人署名不阻止基础准备完成，活动不推断预览与名单完成", () => {
  const model = preparationModel(
    facts({
      storeReady: true,
      channel: { ready: true, detail: "已验证" },
      contacts: { active: 2, subscribed: 1 },
      campaigns: 1,
    }),
  );
  assert.equal(model.foundationReady, true);
  assert.equal(model.completed, 4);
  assert.equal(model.hasCampaigns, true);
  assert.equal(model.recommended, null);
  assert.equal("previewed" in model, false);
  assert.equal("confirmed" in model, false);
});

test("配置失效后准备状态重新派生，不沿用历史完成标记", () => {
  const model = preparationModel(
    facts({
      storeReady: true,
      channel: { ready: false, detail: "通道已断开" },
      contacts: { active: 1, subscribed: 1 },
      campaigns: 3,
    }),
  );
  assert.equal(model.foundationReady, false);
  assert.equal(model.recommended.key, "channels");
});

test("运营可以先准备客户与模板，管理员负责地址与密钥", () => {
  const model = preparationModel(facts({ role: "editor" }));
  assert.equal(model.recommended.key, "contacts");
  assert.deepEqual(
    model.items.slice(0, 2).map((item) => item.canAct),
    [false, false],
  );
  assert.match(model.items[1].restriction, /管理员/);
});

test("查看者、席位受限和权限读取失败不会被引向写入操作", () => {
  for (const overrides of [
    { role: "viewer", canWrite: false },
    { role: "editor", canWrite: false },
    { role: "editor", canWrite: null },
  ]) {
    const model = preparationModel(facts(overrides));
    assert.equal(model.recommended, null);
    assert.equal(
      model.items.some((item) => item.canAct),
      false,
    );
  }
});

test("展示偏好按账号、工作区与角色隔离", () => {
  const base = preparationPreferenceKey("a", "w", "admin");
  for (const key of [
    preparationPreferenceKey("b", "w", "admin"),
    preparationPreferenceKey("a", "v", "admin"),
    preparationPreferenceKey("a", "w", "viewer"),
  ])
    assert.notEqual(base, key);
});
