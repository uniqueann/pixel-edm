import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDatabase, asUser } from "./database-helper.mjs";
import { parseSendGridEvent } from "../supabase/functions/_shared/providers/sendgrid/event.ts";

const admin = "28000000-0000-0000-0000-000000000001";
const adminB = "28000000-0000-0000-0000-000000000002";
const sendgridChannelId = "28100000-0000-0000-0000-000000000001";
const sendgridChannelBId = "28100000-0000-0000-0000-000000000002";

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

function credential(version, hint = "SG01") {
  return {
    key_id: "test-v1",
    nonce: Buffer.alloc(12, version).toString("base64"),
    ciphertext: Buffer.alloc(32, version).toString("base64"),
    credential_version: version,
    access_key_hint: hint,
  };
}

function sendgridPayload(workspaceId, overrides = {}) {
  return {
    workspace_id: workspaceId,
    id: sendgridChannelId,
    provider: "sendgrid",
    region: "global",
    sender_domain: "send.example.test",
    sender_address: "hello@send.example.test",
    sender_alias: "SendGrid 测试",
    reply_to_address: "",
    credential: credential(1),
    ...overrides,
  };
}

function payloadSha256(rawBody) {
  return createHash("sha256").update(rawBody).digest("hex");
}

async function setupWorkspace(db, userId) {
  await db.exec(
    `insert into auth.users(id) values('${userId}') on conflict do nothing`,
  );
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

/** 将 SendGrid Event Webhook JSON 数组经 parseSendGridEvent 后写入 webhook_ingest。 */
async function ingestSendGridNotification(
  db,
  { channelId, tokenDigest, rawBody, onlyIndex = 0 },
) {
  const parsed = parseSendGridEvent({
    kind: "notification",
    payload: JSON.parse(rawBody),
  });
  const event = parsed[onlyIndex];
  assert.ok(event, "parseSendGridEvent 应至少产出一条可 ingest 事件");
  return (
    await asServiceRole(
      db,
      rpc("webhook_ingest_delivery_event", {
        channel_id: channelId,
        token_digest: tokenDigest,
        provider_event_id: event.provider_event_id,
        provider_event_type: event.provider_event_type,
        event_type: event.event_type,
        provider_message_id: event.provider_message_id,
        recipient_email: event.recipient_email,
        provider_status: event.provider_status,
        error_code: event.error_code,
        failure_type: event.failure_type,
        failure_class: event.failure_class,
        occurred_at: event.occurred_at,
        payload_sha256: payloadSha256(rawBody),
      }),
    )
  ).rows[0].result;
}

test("P9-4 SendGrid 多 ESP 自动化验收", async (t) => {
  const db = await createDatabase();
  try {
    await db.query(
      "update edm.delivery_providers set enabled=true where provider='sendgrid'",
    );
    await db.exec(
      `insert into auth.users(id) values('${admin}'),('${adminB}')`,
    );

    const workspace = await setupWorkspace(db, admin);
    const workspaceB = await setupWorkspace(db, adminB);

    await asUser(
      db,
      admin,
      rpc("save_delivery_channel", sendgridPayload(workspace)),
    );
    await verifyChannel(db, sendgridChannelId);
    await asUser(
      db,
      adminB,
      rpc(
        "save_delivery_channel",
        sendgridPayload(workspaceB, { id: sendgridChannelBId }),
      ),
    );
    await verifyChannel(db, sendgridChannelBId);

    await db.query(
      `insert into edm.contacts(workspace_id,email,name,subscription_status,created_by)
       values($1,'delivered@example.test','送达','subscribed',$2),
              ($1,'soft@example.test','软退','subscribed',$2),
              ($1,'resub@example.test','重订阅','subscribed',$2),
              ($3,'cross@example.test','跨通道','subscribed',$4)`,
      [workspace, admin, workspaceB, adminB],
    );

    const template = (
      await db.query(
        "select id from edm.templates where workspace_id=$1 and archived_at is null order by id limit 1",
        [workspace],
      )
    ).rows[0].id;

    const digestA = "d".repeat(64);
    const digestB = "e".repeat(64);
    await asUser(
      db,
      admin,
      rpc("configure_delivery_webhook", {
        workspace_id: workspace,
        channel_id: sendgridChannelId,
        token_digest: digestA,
        token_hint: "dddd",
      }),
    );
    await asUser(
      db,
      adminB,
      rpc("configure_delivery_webhook", {
        workspace_id: workspaceB,
        channel_id: sendgridChannelBId,
        token_digest: digestB,
        token_hint: "eeee",
      }),
    );

    await t.test(
      "ingest 路径：parseSendGridEvent → webhook_ingest，仅凭 sg_message_id 命中任务",
      async () => {
        const campaign = (
          await asUser(
            db,
            admin,
            rpc("save_campaign", {
              workspace_id: workspace,
              name: "P9-4 SendGrid 送达",
              template_id: template,
              audience_type: "all",
              variables: {
                store_name: "测试店铺",
                sender_name: "测试发件人",
                discount: "八折",
                product: "测试商品",
                order_number: "ORDER-SG-1",
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
        await asUser(
          db,
          admin,
          rpc("start_campaign_delivery", {
            workspace_id: workspace,
            campaign_id: campaign,
            expected_version: confirmation.campaign_version,
            idempotency_key: "28200000-0000-0000-0000-000000000001",
            confirmation_name: "P9-4 SendGrid 送达",
          }),
        );

        const claim = (
          await asServiceRole(
            db,
            rpc("worker_claim_delivery_batch", { limit: 1 }),
          )
        ).rows[0].result[0];
        assert.equal(claim.channel.provider, "sendgrid");
        const recipientEmail = (
          await db.query(
            `select recipient.email
             from edm.campaign_delivery_tasks task
             join edm.campaign_recipient_snapshots recipient on recipient.id=task.recipient_snapshot_id
             where task.id=$1`,
            [claim.task_id],
          )
        ).rows[0].email;
        const sgMessageId = "sg-msg-delivered.filterd.001";
        await asServiceRole(
          db,
          rpc("worker_complete_delivery_task", {
            task_id: claim.task_id,
            attempt_id: claim.attempt_id,
            lease_token: claim.lease_token,
            status: "accepted",
            provider_request_id: "sg-request-1",
            provider_message_id: sgMessageId,
            provider_env_id: "",
          }),
        );

        const deliveredAtSec = Math.floor(Date.now() / 1000) + 60;
        const rawBody = JSON.stringify([
          {
            event: "delivered",
            email: recipientEmail,
            timestamp: deliveredAtSec,
            sg_message_id: sgMessageId,
            sg_event_id: "evt-sg-delivered",
          },
        ]);
        const result = await ingestSendGridNotification(db, {
          channelId: sendgridChannelId,
          tokenDigest: digestA,
          rawBody,
        });
        assert.equal(result.matched, true);
        assert.equal(result.status, "applied");

        const taskRow = (
          await db.query(
            `select delivery_status,provider_message_id
             from edm.campaign_delivery_tasks
             where id=$1`,
            [claim.task_id],
          )
        ).rows[0];
        assert.equal(taskRow.delivery_status, "delivered");
        assert.equal(taskRow.provider_message_id, sgMessageId);
      },
    );

    await t.test(
      "跨通道隔离：错误 token 与错通道 message_id 不得错配",
      async () => {
        await assert.rejects(
          asServiceRole(
            db,
            rpc("webhook_ingest_delivery_event", {
              channel_id: sendgridChannelBId,
              token_digest: digestA,
              provider_event_id: "sg-wrong-token",
              provider_event_type: "sendgrid:delivered",
              event_type: "delivery_succeeded",
              recipient_email: "cross@example.test",
              occurred_at: new Date().toISOString(),
              payload_sha256: "1".repeat(64),
            }),
          ),
          /WEBHOOK_UNAUTHORIZED/,
        );

        const templateB = (
          await db.query(
            "select id from edm.templates where workspace_id=$1 and archived_at is null order by id limit 1",
            [workspaceB],
          )
        ).rows[0].id;
        const campaignB = (
          await asUser(
            db,
            adminB,
            rpc("save_campaign", {
              workspace_id: workspaceB,
              name: "P9-4 跨通道 B",
              template_id: templateB,
              audience_type: "all",
              variables: {
                store_name: "B",
                sender_name: "B",
                discount: "九折",
                product: "B",
                order_number: "B-1",
              },
            }),
          )
        ).rows[0].result;
        const previewB = (
          await asUser(
            db,
            adminB,
            rpc("get_campaign_preview", {
              workspace_id: workspaceB,
              id: campaignB,
            }),
          )
        ).rows[0].result;
        const confirmB = (
          await asUser(
            db,
            adminB,
            rpc("confirm_campaign", {
              workspace_id: workspaceB,
              id: campaignB,
              expected_campaign_version: previewB.campaign.version,
              expected_template_version: previewB.template.version,
            }),
          )
        ).rows[0].result;
        await asUser(
          db,
          adminB,
          rpc("start_campaign_delivery", {
            workspace_id: workspaceB,
            campaign_id: campaignB,
            expected_version: confirmB.campaign_version,
            idempotency_key: "28200000-0000-0000-0000-000000000002",
            confirmation_name: "P9-4 跨通道 B",
          }),
        );
        const claimB = (
          await asServiceRole(
            db,
            rpc("worker_claim_delivery_batch", { limit: 1 }),
          )
        ).rows[0].result[0];
        const sharedMessageId = "sg-shared-cross-channel";
        await asServiceRole(
          db,
          rpc("worker_complete_delivery_task", {
            task_id: claimB.task_id,
            attempt_id: claimB.attempt_id,
            lease_token: claimB.lease_token,
            status: "accepted",
            provider_request_id: "sg-b",
            provider_message_id: sharedMessageId,
            provider_env_id: "",
          }),
        );

        const crossRaw = JSON.stringify([
          {
            event: "bounce",
            email: "cross@example.test",
            timestamp: 1_700_000_200,
            sg_message_id: sharedMessageId,
            sg_event_id: "evt-cross-a",
            type: "blocked",
            reason: "550 invalid",
          },
        ]);
        const crossResult = await ingestSendGridNotification(db, {
          channelId: sendgridChannelId,
          tokenDigest: digestA,
          rawBody: crossRaw,
        });
        assert.equal(crossResult.matched, false);
        assert.equal(crossResult.status, "pending");
      },
    );

    await t.test("软退：SendGrid bounce(expired) 不写入永久抑制", async () => {
      const rawBody = JSON.stringify([
        {
          event: "bounce",
          email: "soft@example.test",
          timestamp: 1_700_000_300,
          sg_message_id: "sg-soft-only",
          sg_event_id: "evt-sg-soft",
          type: "expired",
          reason: "421 try again",
        },
      ]);
      await ingestSendGridNotification(db, {
        channelId: sendgridChannelId,
        tokenDigest: digestA,
        rawBody,
      });
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
          "select failure_class from edm.campaign_delivery_events where provider_event_id='evt-sg-soft'",
        )
      ).rows[0];
      assert.equal(event.failure_class, "soft_bounce");
    });

    await t.test(
      "group_resubscribe → provider_resubscribed 为 ignored，不解除抑制",
      async () => {
        const hardRaw = JSON.stringify([
          {
            event: "bounce",
            email: "resub@example.test",
            timestamp: 1_700_000_400,
            sg_message_id: "sg-hard-resub",
            sg_event_id: "evt-sg-hard",
            type: "blocked",
            reason: "550 user unknown",
          },
        ]);
        await ingestSendGridNotification(db, {
          channelId: sendgridChannelId,
          tokenDigest: digestA,
          rawBody: hardRaw,
        });
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from edm.suppressions where workspace_id=$1 and email='resub@example.test'",
              [workspace],
            )
          ).rows[0].n,
          1,
        );

        const resubRaw = JSON.stringify([
          {
            event: "group_resubscribe",
            email: "resub@example.test",
            timestamp: 1_700_000_401,
            sg_message_id: "sg-resub",
            sg_event_id: "evt-sg-resub",
          },
        ]);
        const ignored = await ingestSendGridNotification(db, {
          channelId: sendgridChannelId,
          tokenDigest: digestA,
          rawBody: resubRaw,
        });
        assert.equal(ignored.status, "ignored");

        assert.deepEqual(
          (
            await db.query(
              "select count(*)::int n, min(reason) reason from edm.suppressions where workspace_id=$1 and email='resub@example.test'",
              [workspace],
            )
          ).rows[0],
          { n: 1, reason: "bounced" },
        );
      },
    );
  } finally {
    await db.close();
  }
});
