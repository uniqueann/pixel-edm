import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

const admin = "27000000-0000-0000-0000-000000000001";
const adminB = "27000000-0000-0000-0000-000000000002";
const directMailChannelId = "27100000-0000-0000-0000-000000000001";
const sesChannelId = "27100000-0000-0000-0000-000000000002";
const sesChannelBId = "27100000-0000-0000-0000-000000000003";

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

function credential(version, hint = "ABCD") {
  return {
    key_id: "test-v1",
    nonce: Buffer.alloc(12, version).toString("base64"),
    ciphertext: Buffer.alloc(32, version).toString("base64"),
    credential_version: version,
    access_key_hint: hint,
  };
}

function directMailPayload(workspaceId, overrides = {}) {
  return {
    workspace_id: workspaceId,
    id: directMailChannelId,
    region: "ap-southeast-1",
    sender_domain: "send.example.test",
    sender_address: "edm@send.example.test",
    sender_alias: "DirectMail",
    reply_to_address: "",
    credential: credential(1, "DM01"),
    ...overrides,
  };
}

function sesPayload(workspaceId, overrides = {}) {
  return {
    workspace_id: workspaceId,
    id: sesChannelId,
    provider: "amazon_ses",
    region: "us-east-1",
    sender_address: "hello@example.test",
    sender_alias: "SES",
    reply_to_address: "",
    configuration_set_name: "pixel-edm",
    credential: credential(1, "SE01"),
    ...overrides,
  };
}

async function setupWorkspace(db, userId) {
  await db.exec(`insert into auth.users(id) values('${userId}') on conflict do nothing`);
  const workspace = (
    await asUser(db, userId, "select edm.initialize_member() as id")
  ).rows[0].id;
  await db.query(
    "update edm.workspaces set mailing_address='上海市测试路 1 号' where id=$1",
    [workspace],
  );
  return workspace;
}

async function verifyChannel(db, channelId) {
  await db.query(
    "update edm.delivery_channels set status='verified',last_verified_at=now() where id=$1",
    [channelId],
  );
}

async function createAndStartCampaign(
  db,
  userId,
  workspace,
  templateId,
  name,
  idempotencyKey,
) {
  const campaign = (
    await asUser(
      db,
      userId,
      rpc("save_campaign", {
        workspace_id: workspace,
        name,
        template_id: templateId,
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
      userId,
      rpc("get_campaign_preview", { workspace_id: workspace, id: campaign }),
    )
  ).rows[0].result;
  const confirmation = (
    await asUser(
      db,
      userId,
      rpc("confirm_campaign", {
        workspace_id: workspace,
        id: campaign,
        expected_campaign_version: preview.campaign.version,
        expected_template_version: preview.template.version,
      }),
    )
  ).rows[0].result;
  const started = (
    await asUser(
      db,
      userId,
      rpc("start_campaign_delivery", {
        workspace_id: workspace,
        campaign_id: campaign,
        expected_version: confirmation.campaign_version,
        idempotency_key: idempotencyKey,
        confirmation_name: name,
      }),
    )
  ).rows[0].result;
  return { campaign, started };
}

test("P8-4 多 ESP 自动化验收", async (t) => {
  const db = await createDatabase();
  try {
    await db.query(
      "update edm.delivery_providers set enabled=true where provider='amazon_ses'",
    );
    await db.exec(`insert into auth.users(id) values('${admin}'),('${adminB}')`);

    const workspace = await setupWorkspace(db, admin);
    const workspaceB = await setupWorkspace(db, adminB);

    await asUser(
      db,
      admin,
      rpc("save_delivery_channel", directMailPayload(workspace)),
    );
    await verifyChannel(db, directMailChannelId);
    await asUser(db, admin, rpc("save_delivery_channel", sesPayload(workspace)));
    await verifyChannel(db, sesChannelId);

    await asUser(
      db,
      adminB,
      rpc(
        "save_delivery_channel",
        sesPayload(workspaceB, { id: sesChannelBId }),
      ),
    );
    await verifyChannel(db, sesChannelBId);

    await db.query(
      `insert into edm.contacts(workspace_id,email,name,subscription_status,created_by)
       values($1,'freeze@example.test','冻结测试','subscribed',$2),
              ($1,'soft@example.test','软退测试','subscribed',$2),
              ($1,'resub@example.test','重订阅测试','subscribed',$2),
              ($3,'cross@example.test','跨厂商','subscribed',$4)`,
      [workspace, admin, workspaceB, adminB],
    );

    const template = (
      await db.query(
        "select id from edm.templates where workspace_id=$1 and archived_at is null order by id limit 1",
        [workspace],
      )
    ).rows[0].id;

    await t.test("在途冻结：切换主通道后在途仍用原通道，新活动用新通道", async () => {
      const { started: firstRun } = await createAndStartCampaign(
        db,
        admin,
        workspace,
        template,
        "P8-4 在途冻结 DirectMail",
        "27200000-0000-0000-0000-000000000001",
      );
      const frozen = (
        await db.query(
          "select channel_id,provider from edm.campaign_delivery_runs where id=$1",
          [firstRun.run_id],
        )
      ).rows[0];
      assert.equal(frozen.channel_id, directMailChannelId);
      assert.equal(frozen.provider, "aliyun_directmail");

      const listed = (
        await asUser(
          db,
          admin,
          rpc("list_delivery_channels", { workspace_id: workspace }),
        )
      ).rows[0].result;
      const ses = listed.find((row) => row.provider === "amazon_ses");
      await asUser(
        db,
        admin,
        rpc("set_primary_delivery_channel", {
          workspace_id: workspace,
          channel_id: ses.id,
          expected_version: ses.version,
        }),
      );

      const claim = (
        await asServiceRole(db, rpc("worker_claim_delivery_batch", { limit: 1 }))
      ).rows[0].result[0];
      assert.equal(claim.channel.id, directMailChannelId);
      assert.equal(claim.channel.provider, "aliyun_directmail");
      assert.equal(claim.channel.region, "ap-southeast-1");

      const { started: secondRun } = await createAndStartCampaign(
        db,
        admin,
        workspace,
        template,
        "P8-4 在途冻结 SES",
        "27200000-0000-0000-0000-000000000002",
      );
      const newRun = (
        await db.query(
          "select channel_id,provider from edm.campaign_delivery_runs where id=$1",
          [secondRun.run_id],
        )
      ).rows[0];
      assert.equal(newRun.channel_id, sesChannelId);
      assert.equal(newRun.provider, "amazon_ses");
    });

    await t.test("跨厂商隔离：错误令牌拒绝，回执不得跨通道错配", async () => {
      const digestA = "a".repeat(64);
      const digestB = "b".repeat(64);
      await asUser(
        db,
        admin,
        rpc("configure_delivery_webhook", {
          workspace_id: workspace,
          channel_id: directMailChannelId,
          token_digest: digestA,
          token_hint: "aaaa",
        }),
      );
      await asUser(
        db,
        adminB,
        rpc("configure_delivery_webhook", {
          workspace_id: workspaceB,
          channel_id: sesChannelBId,
          token_digest: digestB,
          token_hint: "bbbb",
        }),
      );

      await assert.rejects(
        asServiceRole(
          db,
          rpc("webhook_ingest_delivery_event", {
            channel_id: sesChannelBId,
            token_digest: digestA,
            provider_event_id: "wrong-token",
            provider_event_type: "ses:test",
            event_type: "delivery_succeeded",
            recipient_email: "cross@example.test",
            occurred_at: new Date().toISOString(),
            payload_sha256: "1".repeat(64),
          }),
        ),
        /WEBHOOK_UNAUTHORIZED/,
      );

      await createAndStartCampaign(
        db,
        adminB,
        workspaceB,
        (
          await db.query(
            "select id from edm.templates where workspace_id=$1 and archived_at is null order by id limit 1",
            [workspaceB],
          )
        ).rows[0].id,
        "P8-4 跨厂商隔离",
        "27200000-0000-0000-0000-000000000003",
      );
      const claim = (
        await asServiceRole(db, rpc("worker_claim_delivery_batch", { limit: 1 }))
      ).rows[0].result[0];
      await asServiceRole(
        db,
        rpc("worker_complete_delivery_task", {
          task_id: claim.task_id,
          attempt_id: claim.attempt_id,
          lease_token: claim.lease_token,
          status: "accepted",
          provider_request_id: "request-cross-b",
          provider_message_id: "shared-message-id",
          provider_env_id: "env-cross-b",
        }),
      );

      const crossChannel = (
        await asServiceRole(
          db,
          rpc("webhook_ingest_delivery_event", {
            channel_id: directMailChannelId,
            token_digest: digestA,
            provider_event_id: "cross-channel-bounce",
            provider_event_type: "dm:test",
            event_type: "delivery_failed",
            provider_message_id: "shared-message-id",
            provider_env_id: "env-cross-b",
            recipient_email: "cross@example.test",
            failure_class: "hard_bounce",
            occurred_at: new Date().toISOString(),
            payload_sha256: "2".repeat(64),
          }),
        )
      ).rows[0].result;
      assert.equal(crossChannel.status, "pending");
      assert.equal(crossChannel.matched, false);

      const credentialRows = (
        await db.query(
          `select channel_id,credential_version
           from edm_private.delivery_channel_credentials
           where workspace_id in ($1,$2)
           order by channel_id`,
          [workspace, workspaceB],
        )
      ).rows;
      assert.equal(credentialRows.length, 3);
      assert.equal(
        new Set(credentialRows.map((row) => row.channel_id)).size,
        3,
      );
    });

    await t.test("退信分级：SES 软退不写入永久抑制", async () => {
      const digest = "c".repeat(64);
      await asUser(
        db,
        admin,
        rpc("configure_delivery_webhook", {
          workspace_id: workspace,
          channel_id: sesChannelId,
          token_digest: digest,
          token_hint: "cccc",
        }),
      );
      await asServiceRole(
        db,
        rpc("webhook_ingest_delivery_event", {
          channel_id: sesChannelId,
          token_digest: digest,
          provider_event_id: "ses-soft-bounce",
          provider_event_type: "ses:Bounce",
          event_type: "delivery_failed",
          recipient_email: "soft@example.test",
          failure_class: "soft_bounce",
          failure_type: "Transient",
          occurred_at: new Date().toISOString(),
          payload_sha256: "3".repeat(64),
        }),
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from edm.suppressions where workspace_id=$1 and email='soft@example.test'",
            [workspace],
          )
        ).rows[0].n,
        0,
      );
      const event = (
        await db.query(
          "select failure_class from edm.campaign_delivery_events where provider_event_id='ses-soft-bounce'",
        )
      ).rows[0];
      assert.equal(event.failure_class, "soft_bounce");
    });

    await t.test("厂商重订阅不解除工作区抑制（DirectMail 与 SES）", async () => {
      const digestDm = "a".repeat(64);
      const digestSes = "c".repeat(64);

      await asServiceRole(
        db,
        rpc("webhook_ingest_delivery_event", {
          channel_id: directMailChannelId,
          token_digest: digestDm,
          provider_event_id: "dm-hard-resub",
          provider_event_type: "dm:Failed",
          event_type: "delivery_failed",
          recipient_email: "resub@example.test",
          provider_status: "2",
          occurred_at: new Date().toISOString(),
          payload_sha256: "4".repeat(64),
        }),
      );
      const before = (
        await db.query(
          "select count(*)::int n from edm.suppressions where workspace_id=$1 and email='resub@example.test'",
          [workspace],
        )
      ).rows[0].n;
      assert.equal(before, 1);

      for (const [eventId, channelId, digest, providerType] of [
        [
          "dm-resubscribe",
          directMailChannelId,
          digestDm,
          "dm:Subscribe",
        ],
        ["ses-resubscribe", sesChannelId, digestSes, "ses:Subscribe"],
      ]) {
        const result = (
          await asServiceRole(
            db,
            rpc("webhook_ingest_delivery_event", {
              channel_id: channelId,
              token_digest: digest,
              provider_event_id: eventId,
              provider_event_type: providerType,
              event_type: "provider_resubscribed",
              recipient_email: "resub@example.test",
              occurred_at: new Date().toISOString(),
              payload_sha256: Buffer.from(eventId)
                .toString("hex")
                .padEnd(64, "0")
                .slice(0, 64),
            }),
          )
        ).rows[0].result;
        assert.equal(result.status, "ignored");
      }

      assert.deepEqual(
        (
          await db.query(
            "select count(*)::int n, min(reason) reason from edm.suppressions where workspace_id=$1 and email='resub@example.test'",
            [workspace],
          )
        ).rows[0],
        { n: 1, reason: "bounced" },
      );
    });

    await t.test("能力降级：注册表关闭追踪时服务端拒绝配置", async () => {
      await db.query(
        `update edm.delivery_providers
         set supports_open_tracking=false,supports_click_tracking=false
         where provider='aliyun_directmail'`,
      );
      await assert.rejects(
        asUser(
          db,
          admin,
          rpc("configure_delivery_tracking", {
            workspace_id: workspace,
            channel_id: directMailChannelId,
            expected_version: (
              await db.query(
                "select version from edm.delivery_channels where id=$1",
                [directMailChannelId],
              )
            ).rows[0].version,
            tracking_enabled: true,
            tracking_tag_name: "pixel_edm_tracking",
          }),
        ),
        /不支持行为追踪/,
      );
      await db.query(
        `update edm.delivery_providers
         set supports_open_tracking=true,supports_click_tracking=true
         where provider='aliyun_directmail'`,
      );
    });

    await t.test("审计脱敏：通道与 Webhook 操作不记录凭据或完整邮箱", async () => {
      const logs = (
        await db.query(
          `select action,metadata::text as metadata
           from edm.activity_logs
           where workspace_id=$1
             and action in (
               'delivery_channel.configured',
               'delivery_channel.primary_set',
               'delivery_webhook.configured',
               'delivery_tracking.configured'
             )
           order by created_at`,
          [workspace],
        )
      ).rows;
      assert.ok(logs.length >= 3);
      for (const row of logs) {
        assert.doesNotMatch(
          row.metadata,
          /ciphertext|nonce|secret|access_key|token_digest|@[^"]+\.(com|test)/i,
        );
      }
    });

    await t.test("AIGC 隔离：共享 schema 未被 EDM 迁移改写", async () => {
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from information_schema.tables where table_schema='aigc'",
          )
        ).rows[0].n,
        1,
      );
      await assert.rejects(
        asUser(db, admin, "select * from aigc.members"),
        /permission denied/,
      );
    });
  } finally {
    await db.close();
  }
});
