import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

const admin = "81000000-0000-0000-0000-000000000001";
const editor = "81000000-0000-0000-0000-000000000002";
const channelId = "82000000-0000-0000-0000-000000000001";

function rpc(name, payload) {
  const encoded = JSON.stringify(payload).replaceAll("'", "''");
  return `select edm.${name}('${encoded}'::jsonb) as result`;
}

async function asServiceRole(db, sql) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return tx.query(sql);
  });
}

async function createDelivery(db, workspace, template, name, key) {
  const campaign = (
    await asUser(
      db,
      admin,
      rpc("save_campaign", {
        workspace_id: workspace,
        name,
        template_id: template,
        audience_type: "all",
        variables: {
          store_name: "测试店铺",
          sender_name: "测试发件人",
          discount: "八折",
          product: "测试商品",
          order_number: "ORDER-001",
        },
      }),
    )
  ).rows[0].result;
  const preview = (
    await asUser(
      db,
      admin,
      rpc("get_campaign_preview", { workspace_id: workspace, id: campaign }),
    )
  ).rows[0].result;
  const confirmation = (
    await asUser(
      db,
      admin,
      rpc("confirm_campaign", {
        workspace_id: workspace,
        id: campaign,
        expected_campaign_version: preview.campaign.version,
        expected_template_version: preview.template.version,
      }),
    )
  ).rows[0].result;
  const run = (
    await asUser(
      db,
      admin,
      rpc("start_campaign_delivery", {
        workspace_id: workspace,
        campaign_id: campaign,
        expected_version: confirmation.campaign_version,
        idempotency_key: key,
        confirmation_name: name,
      }),
    )
  ).rows[0].result;
  return { campaign, runId: run.run_id };
}

test("P5-2 公开退订事务、幂等归因与发送前抑制闭环", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(`insert into auth.users(id) values('${admin}'),('${editor}')`);
  const workspace = (
    await asUser(db, admin, "select edm.initialize_member() id")
  ).rows[0].id;
  await asUser(db, editor, "select edm.initialize_member()");
  await db.query(
    "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')",
    [workspace, editor],
  );
  await db.query("update edm.workspaces set plan='team' where id=$1", [
    workspace,
  ]);
  await db.query(
    "update edm.workspaces set name='公开退订测试店铺',mailing_address='上海市测试路 1 号' where id=$1",
    [workspace],
  );
  await asUser(
    db,
    admin,
    rpc("save_delivery_channel", {
      workspace_id: workspace,
      id: channelId,
      region: "cn-hangzhou",
      sender_domain: "send.example.test",
      sender_address: "edm@send.example.test",
      sender_alias: "测试邮局",
      reply_to_address: "",
      credential: {
        key_id: "test-v1",
        nonce: Buffer.alloc(12, 1).toString("base64"),
        ciphertext: Buffer.alloc(32, 1).toString("base64"),
        credential_version: 1,
        access_key_hint: "1234",
      },
    }),
  );
  await db.query(
    "update edm.delivery_channels set status='verified',last_verified_at=now() where id=$1",
    [channelId],
  );
  const template = (
    await db.query(
      "select id from edm.templates where workspace_id=$1 and archived_at is null order by id limit 1",
      [workspace],
    )
  ).rows[0].id;
  const contact = (
    await db.query(
      `insert into edm.contacts(workspace_id,email,name,subscription_status,created_by)
       values($1,'public@example.test','公开客户','subscribed',$2) returning id`,
      [workspace, admin],
    )
  ).rows[0];

  await createDelivery(
    db,
    workspace,
    template,
    "公开退订来源活动",
    "83000000-0000-0000-0000-000000000001",
  );
  const firstClaim = (
    await asServiceRole(db, rpc("worker_claim_delivery_batch", { limit: 1 }))
  ).rows[0].result[0];
  await asServiceRole(
    db,
    rpc("worker_complete_delivery_task", {
      task_id: firstClaim.task_id,
      attempt_id: firstClaim.attempt_id,
      lease_token: firstClaim.lease_token,
      status: "accepted",
      provider_request_id: "request-public-1",
      provider_env_id: "env-public-1",
    }),
  );
  const queued = await createDelivery(
    db,
    workspace,
    template,
    "公开退订后续活动",
    "83000000-0000-0000-0000-000000000002",
  );

  await t.test("只有服务角色可以解析和提交公开退订", async () => {
    await assert.rejects(
      asUser(
        db,
        admin,
        rpc("resolve_public_unsubscribe", { task_id: firstClaim.task_id }),
      ),
      /permission denied/,
    );
    await assert.rejects(
      asUser(
        db,
        null,
        rpc("apply_public_unsubscribe", {
          task_id: firstClaim.task_id,
          entrypoint: "public_page",
          key_id: "u1",
        }),
        "anon",
      ),
      /permission denied/,
    );
    const preview = (
      await asServiceRole(
        db,
        rpc("resolve_public_unsubscribe", { task_id: firstClaim.task_id }),
      )
    ).rows[0].result;
    assert.equal(preview.status, "ready");
    assert.equal(preview.workspace_name, "公开退订测试店铺");
    assert.equal(preview.masked_email, "p***@example.test");
  });

  await t.test("首次与重复提交只保留一条事件并投影来源任务", async () => {
    const payload = {
      task_id: firstClaim.task_id,
      entrypoint: "public_page",
      key_id: "u1",
    };
    const firstResult = (
      await asServiceRole(db, rpc("apply_public_unsubscribe", payload))
    ).rows[0].result;
    const repeated = (
      await asServiceRole(
        db,
        rpc("apply_public_unsubscribe", {
          ...payload,
          entrypoint: "one_click",
        }),
      )
    ).rows[0].result;
    assert.equal(firstResult.already_applied, false);
    assert.equal(repeated.already_applied, true);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.subscription_events where delivery_task_id=$1 and source='public_link'",
          [firstClaim.task_id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select subscription_status from edm.contacts where id=$1",
          [contact.id],
        )
      ).rows[0].subscription_status,
      "unsubscribed",
    );
    assert.equal(
      (
        await db.query(
          "select feedback_status from edm.campaign_delivery_tasks where id=$1",
          [firstClaim.task_id],
        )
      ).rows[0].feedback_status,
      "unsubscribed",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.activity_logs where dedupe_key=$1",
          [`public-unsubscribe:${firstClaim.task_id}`],
        )
      ).rows[0].n,
      1,
    );
  });

  await t.test("排队后发生退订时，领取任务会跳过该收件人", async () => {
    const claims = (
      await asServiceRole(db, rpc("worker_claim_delivery_batch", { limit: 1 }))
    ).rows[0].result;
    assert.deepEqual(claims, []);
    assert.equal(
      (
        await db.query(
          "select status from edm.campaign_delivery_tasks where run_id=$1",
          [queued.runId],
        )
      ).rows[0].status,
      "skipped",
    );
  });

  await t.test("旧邮件只抑制发送时邮箱，且投诉状态不会被降级", async () => {
    await db.query(
      "delete from edm.suppressions where workspace_id=$1 and email='public@example.test'",
      [workspace],
    );
    await db.query(
      "update edm.contacts set subscription_status='subscribed' where id=$1",
      [contact.id],
    );
    const moved = await createDelivery(
      db,
      workspace,
      template,
      "邮箱变更前活动",
      "83000000-0000-0000-0000-000000000003",
    );
    const movedClaim = (
      await asServiceRole(db, rpc("worker_claim_delivery_batch", { limit: 1 }))
    ).rows[0].result[0];
    await asServiceRole(
      db,
      rpc("worker_complete_delivery_task", {
        task_id: movedClaim.task_id,
        attempt_id: movedClaim.attempt_id,
        lease_token: movedClaim.lease_token,
        status: "accepted",
        provider_request_id: "request-public-2",
        provider_env_id: "env-public-2",
      }),
    );
    const version = (
      await db.query("select version from edm.contacts where id=$1", [
        contact.id,
      ])
    ).rows[0].version;
    await asUser(
      db,
      admin,
      rpc("save_contact", {
        workspace_id: workspace,
        id: contact.id,
        expected_version: version,
        email: "new-public@example.test",
        name: "公开客户",
        tags: [],
      }),
    );
    await db.query(
      "update edm.campaign_delivery_tasks set feedback_status='complained',feedback_status_at=now() where id=$1",
      [movedClaim.task_id],
    );
    await asServiceRole(
      db,
      rpc("apply_public_unsubscribe", {
        task_id: movedClaim.task_id,
        entrypoint: "one_click",
        key_id: "u1",
      }),
    );
    assert.equal(
      (
        await db.query(
          "select subscription_status from edm.contacts where id=$1",
          [contact.id],
        )
      ).rows[0].subscription_status,
      "unconfirmed",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.suppressions where workspace_id=$1 and email='public@example.test' and reason='unsubscribed'",
          [workspace],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select feedback_status from edm.campaign_delivery_tasks where id=$1",
          [movedClaim.task_id],
        )
      ).rows[0].feedback_status,
      "complained",
    );
    assert.ok(moved.runId);
  });
});
