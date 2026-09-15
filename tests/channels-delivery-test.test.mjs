import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

const admin = "22000000-0000-0000-0000-000000000001";
const viewer = "22000000-0000-0000-0000-000000000002";
const outsider = "22000000-0000-0000-0000-000000000003";
const channelId = "23000000-0000-0000-0000-000000000001";
const attemptId = "24000000-0000-0000-0000-000000000001";

function rpc(name, payload, schema = "edm") {
  const encoded = JSON.stringify(payload).replaceAll("'", "''");
  return `select ${schema}.${name}('${encoded}'::jsonb) as result`;
}

function credential(version = 1) {
  return {
    key_id: "test-v1",
    nonce: Buffer.alloc(12, version).toString("base64"),
    ciphertext: Buffer.alloc(32, version).toString("base64"),
    credential_version: version,
    access_key_hint: "1234",
  };
}

async function asServiceRole(db, sql) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return tx.query(sql);
  });
}

test("P4-2 测试发送幂等、权限、验证回写与审计隔离", async (t) => {
  const db = await createDatabase();
  try {
    await db.exec(
      `insert into auth.users(id) values('${admin}'),('${viewer}'),('${outsider}'); insert into aigc.members(user_id) values('${outsider}');`,
    );
    const workspaceId = (
      await asUser(db, admin, "select edm.initialize_member() as id")
    ).rows[0].id;
    const otherWorkspace = (
      await asUser(db, outsider, "select edm.initialize_member() as id")
    ).rows[0].id;
    await asUser(db, viewer, "select edm.initialize_member() as id");
    await db.query(
      "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",
      [workspaceId, viewer],
    );
    await asUser(
      db,
      admin,
      rpc("save_delivery_channel", {
        workspace_id: workspaceId,
        id: channelId,
        region: "cn-hangzhou",
        sender_domain: "send.contentup.cc",
        sender_address: "edm@send.contentup.cc",
        sender_alias: "卖家邮局",
        reply_to_address: "",
        credential: credential(),
      }),
    );

    await t.test("管理员准备任务且重复键只生成一条记录", async () => {
      const payload = {
        workspace_id: workspaceId,
        channel_id: channelId,
        attempt_id: attemptId,
        idempotency_key: attemptId,
        expected_version: 1,
      };
      const first = (
        await asUser(db, admin, rpc("prepare_delivery_test", payload))
      ).rows[0].result;
      const repeated = (
        await asUser(db, admin, rpc("prepare_delivery_test", payload))
      ).rows[0].result;
      assert.equal(first.is_new, true);
      assert.equal(first.attempt.status, "pending");
      assert.equal(repeated.is_new, false);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from edm.delivery_test_attempts where workspace_id=$1",
            [workspaceId],
          )
        ).rows[0].count,
        1,
      );
    });

    await t.test("查看者、跨工作区和 AIGC 角色不能准备或领取", async () => {
      const payload = {
        workspace_id: workspaceId,
        channel_id: channelId,
        attempt_id: "24000000-0000-0000-0000-000000000002",
        idempotency_key: "24000000-0000-0000-0000-000000000002",
        expected_version: 1,
      };
      await assert.rejects(
        asUser(db, viewer, rpc("prepare_delivery_test", payload)),
        /只有管理员/,
      );
      await assert.rejects(
        asUser(
          db,
          outsider,
          rpc("prepare_delivery_test", {
            ...payload,
            workspace_id: otherWorkspace,
          }),
          "aigc_api",
        ),
        /permission denied/,
      );
      await assert.rejects(
        asUser(
          db,
          admin,
          rpc("worker_claim_delivery_test", {
            workspace_id: workspaceId,
            attempt_id: attemptId,
            recipient_email: "owner@example.test",
          }),
        ),
        /permission denied/,
      );
    });

    await t.test(
      "service_role 只能进入 EDM schema 并执行 worker RPC",
      async () => {
        const privileges = (
          await db.query(`select
          has_schema_privilege('service_role','edm','usage') as edm_usage,
          has_schema_privilege('service_role','edm_private','usage') as private_usage,
          has_table_privilege('service_role','edm.delivery_test_attempts','select') as table_select,
          has_function_privilege('service_role','edm.worker_claim_delivery_test(jsonb)','execute') as claim_execute,
          has_function_privilege('service_role','edm.worker_complete_delivery_test(jsonb)','execute') as complete_execute`)
        ).rows[0];
        assert.equal(privileges.edm_usage, true);
        assert.equal(privileges.private_usage, false);
        assert.equal(privileges.table_select, false);
        assert.equal(privileges.claim_execute, true);
        assert.equal(privileges.complete_execute, true);
      },
    );

    await t.test("服务端领取一次并以 DirectMail 回执完成验证", async () => {
      const claimPayload = {
        workspace_id: workspaceId,
        attempt_id: attemptId,
        recipient_email: "owner@example.test",
      };
      const claim = (
        await asServiceRole(db, rpc("worker_claim_delivery_test", claimPayload))
      ).rows[0].result;
      assert.equal(claim.claim_acquired, true);
      assert.equal(claim.recipient_email, "owner@example.test");
      assert.equal(claim.attempt.recipient_hint, "o***@example.test");
      assert.equal(claim.credential.key_id, "test-v1");

      const duplicateClaim = (
        await asServiceRole(db, rpc("worker_claim_delivery_test", claimPayload))
      ).rows[0].result;
      assert.equal(duplicateClaim.claim_acquired, false);
      assert.equal(duplicateClaim.attempt.status, "processing");
      assert.equal("credential" in duplicateClaim, false);

      const completed = (
        await asServiceRole(
          db,
          rpc("worker_complete_delivery_test", {
            workspace_id: workspaceId,
            attempt_id: attemptId,
            status: "accepted",
            provider_request_id: "request-sensitive-123456",
            provider_event_id: "env-sensitive-654321",
          }),
        )
      ).rows[0].result;
      assert.equal(completed.status, "accepted");
      assert.equal(completed.provider_request_hint, "••••123456");
      assert.equal(completed.provider_event_hint, "••••654321");
      assert.equal("provider_request_id" in completed, false);

      const repeated = (
        await asServiceRole(
          db,
          rpc("worker_complete_delivery_test", {
            workspace_id: workspaceId,
            attempt_id: attemptId,
            status: "accepted",
            provider_request_id: "different-request",
            provider_event_id: "different-env",
          }),
        )
      ).rows[0].result;
      assert.deepEqual(repeated, completed);
      const channel = (
        await asUser(
          db,
          admin,
          rpc("get_delivery_channel", { workspace_id: workspaceId }),
        )
      ).rows[0].result;
      assert.equal(channel.status, "verified");
      assert.equal(channel.version, 2);
      assert.ok(channel.last_verified_at);
    });

    await t.test("配置在准备后变化会安全失败且不会泄露凭据", async () => {
      const secondAttempt = "24000000-0000-0000-0000-000000000003";
      await asUser(
        db,
        admin,
        rpc("prepare_delivery_test", {
          workspace_id: workspaceId,
          channel_id: channelId,
          attempt_id: secondAttempt,
          idempotency_key: secondAttempt,
          expected_version: 2,
        }),
      );
      await asUser(
        db,
        admin,
        rpc("save_delivery_channel", {
          workspace_id: workspaceId,
          id: channelId,
          expected_version: 2,
          region: "cn-hangzhou",
          sender_domain: "send.contentup.cc",
          sender_address: "edm@send.contentup.cc",
          sender_alias: "内容邮局",
          reply_to_address: "",
        }),
      );
      const claim = (
        await asServiceRole(
          db,
          rpc("worker_claim_delivery_test", {
            workspace_id: workspaceId,
            attempt_id: secondAttempt,
            recipient_email: "owner@example.test",
          }),
        )
      ).rows[0].result;
      assert.equal(claim.claim_acquired, false);
      assert.equal(claim.attempt.status, "failed");
      assert.equal(claim.attempt.error_code, "CHANNEL_CONFIGURATION_CHANGED");
      assert.equal("credential" in claim, false);
    });

    await t.test("公共摘要与审计不含完整邮箱、回执或凭据", async () => {
      const summary = (
        await asUser(
          db,
          admin,
          rpc("get_delivery_test_summary", {
            workspace_id: workspaceId,
            channel_id: channelId,
            attempt_id: attemptId,
          }),
        )
      ).rows[0].result;
      assert.equal(summary.recipient_hint, "o***@example.test");
      assert.equal("recipient_email" in summary, false);
      const logs = await db.query(
        "select action,metadata::text as metadata from edm.activity_logs where workspace_id=$1 and action like 'delivery_channel.test_%' order by created_at",
        [workspaceId],
      );
      assert.equal(
        logs.rows.filter(
          (row) => row.action === "delivery_channel.test_started",
        ).length,
        2,
      );
      assert.equal(
        logs.rows.filter(
          (row) => row.action === "delivery_channel.test_accepted",
        ).length,
        1,
      );
      for (const row of logs.rows)
        assert.doesNotMatch(
          row.metadata,
          /owner@example|request-sensitive|event-sensitive|ciphertext|nonce|secret|access_key/i,
        );
      assert.equal(
        (
          await db.query("select status from aigc.members where user_id=$1", [
            outsider,
          ])
        ).rows[0].status,
        "active",
      );
    });
  } finally {
    await db.close();
  }
});
