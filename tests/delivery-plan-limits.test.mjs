import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

const admin = "29000000-0000-0000-0000-000000000001";

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

test("P10 套餐发信额度（无支付）", async (t) => {
  const db = await createDatabase();
  try {
    await db.exec(`insert into auth.users(id) values('${admin}')`);
    const workspace = (
      await asUser(db, admin, "select edm.initialize_member() as id")
    ).rows[0].id;
    await db.query(
      "update edm.workspaces set mailing_address='上海市测试路 1 号' where id=$1",
      [workspace],
    );

    await t.test("成员可读套餐用量 RPC，不暴露 ESP 默认", async () => {
      const result = (
        await asUser(
          db,
          admin,
          rpc("get_workspace_delivery_plan", { workspace_id: workspace }),
        )
      ).rows[0].result;
      assert.equal(result.plan, "free");
      assert.equal(result.plan_display_name, "Free");
      assert.equal(result.max_billable_contacts, 500);
      assert.equal(result.billable_contacts, 0);
      assert.equal(result.remaining_billable_contacts, 500);
      assert.equal(result.max_active_members, 1);
      assert.equal(result.active_members, 1);
      assert.equal(result.remaining_member_slots, 0);
      assert.equal(result.daily_send_quota, 1000);
      assert.equal(result.usage_today, 0);
      assert.equal(result.remaining_today, 1000);
      assert.equal(result.max_recipients_per_campaign, 500);
      assert.doesNotMatch(JSON.stringify(result), /max_rate_per_second/);
    });

    await t.test("free 档不可新增协作成员", async () => {
      await assert.rejects(
        asUser(
          db,
          admin,
          rpc("create_workspace_invitation", {
            workspace_id: workspace,
            email: "collab@example.test",
            role: "editor",
            token_hash: "a".repeat(64),
            token_hint: "a123",
          }),
        ),
        /当前套餐最多 1 位工作区成员/,
      );
    });

    await t.test("free 档限制有效客户数", async () => {
      await db.query(
        "update edm.delivery_plan_limits set max_billable_contacts=1 where plan='free'",
      );
      try {
        await asUser(
          db,
          admin,
          rpc("save_contact", {
            workspace_id: workspace,
            email: "limit-a@example.test",
            name: "A",
            tags: [],
          }),
        );
        await assert.rejects(
          asUser(
            db,
            admin,
            rpc("save_contact", {
              workspace_id: workspace,
              email: "limit-b@example.test",
              name: "B",
              tags: [],
            }),
          ),
          /当前套餐最多 1 位有效客户/,
        );
      } finally {
        await db.query(
          "update edm.delivery_plan_limits set max_billable_contacts=500 where plan='free'",
        );
      }
    });

    await t.test("pro 套餐提高确认上限与入队日额度校验", async () => {
      await db.query("update edm.workspaces set plan='pro' where id=$1", [
        workspace,
      ]);
      const plan = (
        await asUser(
          db,
          admin,
          rpc("get_workspace_delivery_plan", { workspace_id: workspace }),
        )
      ).rows[0].result;
      assert.equal(plan.max_billable_contacts, 5000);
      assert.equal(plan.daily_send_quota, 10000);
      assert.equal(plan.max_recipients_per_campaign, 5000);

      await assert.rejects(
        db.query(
          `select edm_private.assert_campaign_recipient_limit('${workspace}'::uuid, 5001)`,
        ),
        /当前套餐下单个活动最多 5000 位收件人/,
      );
    });

    await t.test("start_campaign_delivery 校验今日套餐额度", async () => {
      await db.query("update edm.workspaces set plan='free' where id=$1", [
        workspace,
      ]);
      await db.query(
        "update edm.delivery_plan_limits set daily_send_quota=1 where plan='free'",
      );
      try {
        await db.query(
          `insert into edm.contacts(workspace_id,email,name,subscription_status,created_by)
         values($1,'quota-a@example.test','A','subscribed',$2),
                ($1,'quota-b@example.test','B','subscribed',$2)`,
          [workspace, admin],
        );
        const channelId = "29100000-0000-0000-0000-000000000001";
        await asUser(
          db,
          admin,
          rpc("save_delivery_channel", {
            workspace_id: workspace,
            id: channelId,
            region: "cn-hangzhou",
            sender_domain: "send.example.test",
            sender_address: "hello@send.example.test",
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
          "update edm.delivery_channels set status='verified' where id=$1",
          [channelId],
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
            admin,
            rpc("save_campaign", {
              workspace_id: workspace,
              name: "额度测试",
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
            admin,
            rpc("get_campaign_preview", {
              workspace_id: workspace,
              id: campaign,
            }),
          )
        ).rows[0].result;
        const confirmed = (
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
        await assert.rejects(
          asUser(
            db,
            admin,
            rpc("start_campaign_delivery", {
              workspace_id: workspace,
              campaign_id: campaign,
              expected_version: confirmed.campaign_version,
              idempotency_key: "29200000-0000-0000-0000-000000000001",
              confirmation_name: "额度测试",
            }),
          ),
          /今日套餐发信额度不足/,
        );
      } finally {
        await db.query(
          "update edm.delivery_plan_limits set daily_send_quota=1000 where plan='free'",
        );
      }
    });

    await t.test("claim 速率受套餐 max_rate_per_second 约束", async () => {
      await db.query("update edm.workspaces set plan='free' where id=$1", [
        workspace,
      ]);
      await db.query(
        "update edm.delivery_plan_limits set max_rate_per_second=1 where plan='free'",
      );
      try {
        await db.query(
          "delete from edm.campaign_delivery_attempts where workspace_id=$1",
          [workspace],
        );
        await db.query(
          "update edm.delivery_channels set status='verified',rate_per_second=50,daily_quota=50000 where workspace_id=$1",
          [workspace],
        );
        await db.query(
          `insert into edm.contacts(workspace_id,email,name,subscription_status,created_by)
         select $1,'rate-limit-'||g||'@example.test','测试','subscribed',$2
         from generate_series(1,3) g`,
          [workspace, admin],
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
            admin,
            rpc("save_campaign", {
              workspace_id: workspace,
              name: "速率测试",
              template_id: template,
              audience_type: "all",
              variables: {
                store_name: "店",
                sender_name: "发",
                discount: "折",
                product: "品",
                order_number: "2",
              },
            }),
          )
        ).rows[0].result;
        const preview = (
          await asUser(
            db,
            admin,
            rpc("get_campaign_preview", {
              workspace_id: workspace,
              id: campaign,
            }),
          )
        ).rows[0].result;
        const confirmed = (
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
        await asUser(
          db,
          admin,
          rpc("start_campaign_delivery", {
            workspace_id: workspace,
            campaign_id: campaign,
            expected_version: confirmed.campaign_version,
            idempotency_key: "29200000-0000-0000-0000-000000000002",
            confirmation_name: "速率测试",
          }),
        );
        const batch = (
          await asServiceRole(
            db,
            rpc("worker_claim_delivery_batch", { limit: 10 }),
          )
        ).rows[0].result;
        assert.equal(batch.length, 1);
      } finally {
        await db.query(
          "update edm.delivery_plan_limits set max_rate_per_second=2 where plan='free'",
        );
      }
    });
  } finally {
    await db.close();
  }
});
