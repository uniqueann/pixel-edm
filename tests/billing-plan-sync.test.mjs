import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

async function asServiceRole(db, sql) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return tx.query(sql);
  });
}

function syncPayload(overrides) {
  return {
    payment_provider: "creem",
    provider_event_id: "evt_test_001",
    event_type: "subscription.updated",
    workspace_id: overrides.workspace_id,
    provider_customer_id: "cus_test_001",
    provider_subscription_id: "sub_test_001",
    subscription_status: "active",
    billed_plan: "pro",
    current_period_end: new Date(Date.now() + 86400000).toISOString(),
    cancel_at_period_end: false,
    ...overrides,
  };
}

test("P11 账单：Creem/Dodo 同步 plan", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const adminId = "4a100000-0000-0000-0000-000000000001";
  await db.exec(
    `insert into auth.users(id) values('${adminId}') on conflict do nothing`,
  );
  const workspace = (
    await asUser(db, adminId, "select edm.initialize_member() as id")
  ).rows[0].id;

  await t.test("Creem active 订阅升为 pro", async () => {
    const payload = syncPayload({
      workspace_id: workspace,
      provider_event_id: "evt_active_pro",
    });
    const encoded = JSON.stringify(payload).replaceAll("'", "''");
    const result = (
      await asServiceRole(
        db,
        `select edm.sync_workspace_plan_from_payment('${encoded}'::jsonb) as result`,
      )
    ).rows[0].result;
    assert.equal(result.ok, true);
    assert.equal(result.duplicate, false);
    assert.equal(result.plan, "pro");
    assert.equal(result.payment_provider, "creem");

    const plan = (
      await db.query("select plan from edm.workspaces where id=$1", [workspace])
    ).rows[0].plan;
    assert.equal(plan, "pro");
  });

  await t.test("重复 event 幂等", async () => {
    const payload = syncPayload({
      workspace_id: workspace,
      provider_event_id: "evt_active_pro",
      billed_plan: "team",
    });
    const encoded = JSON.stringify(payload).replaceAll("'", "''");
    const result = (
      await asServiceRole(
        db,
        `select edm.sync_workspace_plan_from_payment('${encoded}'::jsonb) as result`,
      )
    ).rows[0].result;
    assert.equal(result.duplicate, true);
    const plan = (
      await db.query("select plan from edm.workspaces where id=$1", [workspace])
    ).rows[0].plan;
    assert.equal(plan, "pro");
  });

  await t.test("Dodo 取消订阅回到 free", async () => {
    const payload = syncPayload({
      payment_provider: "dodo",
      workspace_id: workspace,
      provider_event_id: "evt_dodo_canceled",
      provider_customer_id: "cus_dodo_1",
      provider_subscription_id: "sub_dodo_1",
      subscription_status: "canceled",
      billed_plan: "pro",
    });
    const encoded = JSON.stringify(payload).replaceAll("'", "''");
    await asServiceRole(
      db,
      `select edm.sync_workspace_plan_from_payment('${encoded}'::jsonb)`,
    );
    const plan = (
      await db.query("select plan from edm.workspaces where id=$1", [workspace])
    ).rows[0].plan;
    assert.equal(plan, "free");
  });

  await t.test("管理员可读 billing status", async () => {
    const encoded = JSON.stringify({ workspace_id: workspace }).replaceAll(
      "'",
      "''",
    );
    const status = (
      await asUser(
        db,
        adminId,
        `select edm.get_workspace_billing_status('${encoded}'::jsonb) as result`,
      )
    ).rows[0].result;
    assert.equal(status.plan, "free");
    assert.equal(status.payment_provider, "dodo");
    assert.equal(status.subscription_status, "canceled");
  });
});
