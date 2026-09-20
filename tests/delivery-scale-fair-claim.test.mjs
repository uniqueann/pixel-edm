import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

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

/** 创建已入队正式发送的工作区（含 channel 与 pending 任务）。 */
async function seedQueuedCampaign(db, adminId, channelId, contactCount, label) {
  await db.exec(`insert into auth.users(id) values('${adminId}') on conflict do nothing`);
  const workspace = (
    await asUser(db, adminId, "select edm.initialize_member() as id")
  ).rows[0].id;
  await db.query(
    "update edm.workspaces set mailing_address='上海市测试路 1 号', plan='pro' where id=$1",
    [workspace],
  );
  await asUser(
    db,
    adminId,
    rpc("save_delivery_channel", {
      workspace_id: workspace,
      id: channelId,
      region: "cn-hangzhou",
      sender_domain: "send.example.test",
      sender_address: `hello+${label}@send.example.test`,
      sender_alias: "测试",
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
    `update edm.delivery_channels set status='verified', rate_per_second=50, daily_quota=50000
     where id=$1`,
    [channelId],
  );
  await db.query(
    `insert into edm.contacts(workspace_id,email,name,subscription_status,created_by)
     select $1,$2||'-'||g||'@example.test','测试','subscribed',$3
     from generate_series(1,$4) g`,
    [workspace, label, adminId, contactCount],
  );
  const template = (
    await db.query(
      "select id from edm.templates where workspace_id=$1 limit 1",
      [workspace],
    )
  ).rows[0].id;
  const campaign = (
    await asUser(
      db,
      adminId,
      rpc("save_campaign", {
        workspace_id: workspace,
        name: `规模-${label}`,
        template_id: template,
        audience_type: "all",
        variables: {
          store_name: "店",
          sender_name: "发",
          discount: "折",
          product: "品",
          order_number: "1",
        },
      }),
    )
  ).rows[0].result;
  const preview = (
    await asUser(
      db,
      adminId,
      rpc("get_campaign_preview", {
        workspace_id: workspace,
        id: campaign,
      }),
    )
  ).rows[0].result;
  const confirmed = (
    await asUser(
      db,
      adminId,
      rpc("confirm_campaign", {
        workspace_id: workspace,
        id: campaign,
        expected_campaign_version: preview.campaign.version,
        expected_template_version: preview.template.version,
      }),
    )
  ).rows[0].result;
  await asUser(
    db,
    adminId,
    rpc("start_campaign_delivery", {
      workspace_id: workspace,
      campaign_id: campaign,
      expected_version: confirmed.campaign_version,
      idempotency_key: channelId,
      confirmation_name: `规模-${label}`,
    }),
  );
  return workspace;
}

test("P10 扛量：两户长队列公平 claim", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  try {
    await t.test("单批 12 封在两户间均分", async () => {
      const adminA = "3a100000-0000-0000-0000-000000000001";
      const adminB = "3a100000-0000-0000-0000-000000000002";
      const channelA = "3a110000-0000-0000-0000-000000000001";
      const channelB = "3a110000-0000-0000-0000-000000000002";
      const wsA = await seedQueuedCampaign(db, adminA, channelA, 8, "a");
      const wsB = await seedQueuedCampaign(db, adminB, channelB, 8, "b");
      await db.query(
        "update edm.campaign_delivery_runs set started_at=clock_timestamp()-interval '1 hour' where workspace_id=$1",
        [wsA],
      );
      await db.query(
        "update edm.campaign_delivery_runs set started_at=clock_timestamp() where workspace_id=$1",
        [wsB],
      );

      const batch = (
        await asServiceRole(
          db,
          rpc("worker_claim_delivery_batch", { limit: 12 }),
        )
      ).rows[0].result;
      assert.equal(batch.length, 12);
      const byWorkspace = batch.reduce((acc, row) => {
        acc[row.workspace_id] = (acc[row.workspace_id] ?? 0) + 1;
        return acc;
      }, {});
      assert.equal(byWorkspace[wsA], 6);
      assert.equal(byWorkspace[wsB], 6);
    });
  } catch (error) {
    await db.close();
    throw error;
  }
});

test("P10 扛量：四户公平 claim", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  try {
    await t.test("各 8 封 pending，单批 16 封每户 4 封", async () => {
      const specs = [
        ["3a200001-0000-0000-0000-000000000001", "3a210001-0000-0000-0000-000000000001", "w1"],
        ["3a200002-0000-0000-0000-000000000002", "3a210002-0000-0000-0000-000000000002", "w2"],
        ["3a200003-0000-0000-0000-000000000003", "3a210003-0000-0000-0000-000000000003", "w3"],
        ["3a200004-0000-0000-0000-000000000004", "3a210004-0000-0000-0000-000000000004", "w4"],
      ];
      const workspaces = [];
      for (const [admin, channel, label] of specs) {
        workspaces.push(await seedQueuedCampaign(db, admin, channel, 8, label));
      }

      const batch = (
        await asServiceRole(
          db,
          rpc("worker_claim_delivery_batch", { limit: 16 }),
        )
      ).rows[0].result;
      assert.equal(batch.length, 16);
      for (const ws of workspaces) {
        const count = batch.filter((row) => row.workspace_id === ws).length;
        assert.equal(count, 4, `工作区 ${ws} 应领取 4 封`);
      }
    });
  } catch (error) {
    await db.close();
    throw error;
  }
});

test("P10 扛量：十户同时入队", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  try {
    await t.test("各 2 封 pending，单批 20 封覆盖 10 工作区", async () => {
      const workspaces = [];
      for (let i = 1; i <= 10; i += 1) {
        const hex = i.toString(16).padStart(2, "0");
        const admin = `3a3000${hex}-0000-0000-0000-000000000001`;
        const channel = `3a3100${hex}-0000-0000-0000-000000000001`;
        workspaces.push(
          await seedQueuedCampaign(db, admin, channel, 2, `t${i}`),
        );
      }

      const batch = (
        await asServiceRole(
          db,
          rpc("worker_claim_delivery_batch", { limit: 20 }),
        )
      ).rows[0].result;
      assert.equal(batch.length, 20);
      const touched = new Set(batch.map((row) => row.workspace_id));
      assert.equal(touched.size, 10);
      for (const ws of workspaces) {
        const count = batch.filter((row) => row.workspace_id === ws).length;
        assert.equal(count, 2, `工作区 ${ws} 应各领 2 封`);
      }
    });
  } catch (error) {
    await db.close();
    throw error;
  }
});
