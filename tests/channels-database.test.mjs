import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

const admin = "20000000-0000-0000-0000-000000000001";
const viewer = "20000000-0000-0000-0000-000000000002";
const outsider = "20000000-0000-0000-0000-000000000003";
const channelId = "21000000-0000-0000-0000-000000000001";

function rpc(name, payload) {
  const encoded = JSON.stringify(payload).replaceAll("'", "''");
  return `select edm.${name}('${encoded}'::jsonb) as result`;
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

function channelPayload(workspaceId, overrides = {}) {
  return {
    workspace_id: workspaceId,
    id: channelId,
    region: "ap-southeast-1",
    sender_domain: "send.contentup.cc",
    sender_address: "hello@send.contentup.cc",
    sender_alias: "测试邮局",
    reply_to_address: "reply@contentup.cc",
    credential: credential(1),
    ...overrides,
  };
}

test("P4 DirectMail 通道、私密凭据、权限与审计隔离", async (t) => {
  const db = await createDatabase();
  try {
    await db.exec(
      `insert into auth.users(id) values('${admin}'),('${viewer}'),('${outsider}'); insert into aigc.members(user_id) values('${outsider}');`,
    );
    const adminWorkspace = (
      await asUser(db, admin, "select edm.initialize_member() as id")
    ).rows[0].id;
    const viewerWorkspace = (
      await asUser(db, viewer, "select edm.initialize_member() as id")
    ).rows[0].id;
    await asUser(db, outsider, "select edm.initialize_member() as id");
    await db.query(
      "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",
      [adminWorkspace, viewer],
    );

    await t.test("管理员创建通道且公共结果不包含密文", async () => {
      const result = (
        await asUser(
          db,
          admin,
          rpc("save_delivery_channel", channelPayload(adminWorkspace)),
        )
      ).rows[0].result;
      assert.equal(result.status, "configured");
      assert.equal(result.access_key_hint, "ABCD");
      assert.equal(result.credential_version, 1);
      assert.equal(result.credential_configured, true);
      assert.equal("ciphertext" in result, false);
      assert.equal("nonce" in result, false);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from edm_private.delivery_channel_credentials where workspace_id=$1",
            [adminWorkspace],
          )
        ).rows[0].count,
        1,
      );
    });

    await t.test("查看者仅得到安全摘要且不能配置", async () => {
      const summary = (
        await asUser(
          db,
          viewer,
          rpc("get_delivery_channel", { workspace_id: adminWorkspace }),
        )
      ).rows[0].result;
      assert.equal(summary.sender_domain, "send.contentup.cc");
      assert.equal("access_key_hint" in summary, false);
      assert.equal("credential_version" in summary, false);
      await assert.rejects(
        asUser(
          db,
          viewer,
          rpc("save_delivery_channel", {
            ...channelPayload(adminWorkspace),
            expected_version: 1,
          }),
        ),
        /只有管理员/,
      );
    });

    await t.test("跨工作区、直接表访问和 AIGC 角色均被拒绝", async () => {
      await assert.rejects(
        asUser(
          db,
          admin,
          rpc("get_delivery_channel", { workspace_id: viewerWorkspace }),
        ),
        /工作区不可访问/,
      );
      await assert.rejects(
        asUser(db, admin, "select * from edm.delivery_channels"),
        /permission denied/,
      );
      await assert.rejects(
        asUser(
          db,
          admin,
          "select * from edm_private.delivery_channel_credentials",
        ),
        /permission denied/,
      );
      await assert.rejects(
        asUser(
          db,
          outsider,
          rpc("get_delivery_channel", { workspace_id: adminWorkspace }),
          "aigc_api",
        ),
        /permission denied/,
      );
    });

    await t.test("元数据更新保留凭据，轮换凭据要求连续版本", async () => {
      let result = (
        await asUser(
          db,
          admin,
          rpc("save_delivery_channel", {
            ...channelPayload(adminWorkspace),
            expected_version: 1,
            sender_alias: "新发件人",
            credential: undefined,
          }),
        )
      ).rows[0].result;
      assert.equal(result.version, 2);
      assert.equal(result.credential_version, 1);
      await assert.rejects(
        asUser(
          db,
          admin,
          rpc("save_delivery_channel", {
            ...channelPayload(adminWorkspace),
            expected_version: 2,
            credential: credential(3),
          }),
        ),
        /凭据版本冲突/,
      );
      result = (
        await asUser(
          db,
          admin,
          rpc("save_delivery_channel", {
            ...channelPayload(adminWorkspace),
            expected_version: 2,
            credential: credential(2, "WXYZ"),
          }),
        )
      ).rows[0].result;
      assert.equal(result.version, 3);
      assert.equal(result.credential_version, 2);
      assert.equal(result.access_key_hint, "WXYZ");
    });

    await t.test("断开物理删除凭据且重复调用不重复审计", async () => {
      let result = (
        await asUser(
          db,
          admin,
          rpc("disconnect_delivery_channel", {
            workspace_id: adminWorkspace,
            id: channelId,
            expected_version: 3,
          }),
        )
      ).rows[0].result;
      assert.equal(result.status, "disconnected");
      assert.equal(result.credential_configured, false);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from edm_private.delivery_channel_credentials where workspace_id=$1",
            [adminWorkspace],
          )
        ).rows[0].count,
        0,
      );
      result = (
        await asUser(
          db,
          admin,
          rpc("disconnect_delivery_channel", {
            workspace_id: adminWorkspace,
            id: channelId,
            expected_version: 1,
          }),
        )
      ).rows[0].result;
      assert.equal(result.status, "disconnected");
      assert.equal(
        (
          await db.query(
            "select count(*)::int as count from edm.activity_logs where workspace_id=$1 and action='delivery_channel.disconnected'",
            [adminWorkspace],
          )
        ).rows[0].count,
        1,
      );
      await assert.rejects(
        asUser(
          db,
          admin,
          rpc("save_delivery_channel", {
            ...channelPayload(adminWorkspace),
            expected_version: result.version,
            credential: undefined,
          }),
        ),
        /重新连接必须/,
      );
    });

    await t.test("审计只保存安全元数据，AIGC 数据保持不变", async () => {
      const logs = await db.query(
        "select action,metadata::text as metadata from edm.activity_logs where workspace_id=$1 and action like 'delivery_channel.%' order by created_at",
        [adminWorkspace],
      );
      assert.deepEqual(
        logs.rows.map((row) => row.action),
        [
          "delivery_channel.configured",
          "delivery_channel.updated",
          "delivery_channel.credentials_rotated",
          "delivery_channel.disconnected",
        ],
      );
      for (const row of logs.rows) {
        assert.doesNotMatch(
          row.metadata,
          /ciphertext|nonce|secret|access_key/i,
        );
      }
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
