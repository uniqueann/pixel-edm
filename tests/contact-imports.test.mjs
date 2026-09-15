import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

test("名单导入、订阅证据与抑制保护", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const owner = "30000000-0000-0000-0000-000000000001";
  const viewer = "30000000-0000-0000-0000-000000000002";
  await db.exec(`insert into auth.users(id) values('${owner}'),('${viewer}')`);
  const workspace = (
    await asUser(db, owner, "select edm.initialize_member() id")
  ).rows[0].id;
  await asUser(db, viewer, "select edm.initialize_member() id");
  await db.exec(
    `insert into edm.workspace_members(workspace_id,user_id,role) values('${workspace}','${viewer}','viewer')`,
  );
  const rpc = async (fn, payload, user = owner) =>
    (
      await asUser(
        db,
        user,
        `select edm.${fn}('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb) result`,
      )
    ).rows[0].result;

  const existing = await rpc("save_contact", {
    workspace_id: workspace,
    email: "existing@example.com",
    name: "",
    tags: ["老客"],
  });
  const archived = await rpc("save_contact", {
    workspace_id: workspace,
    email: "archived@example.com",
    name: "归档客户",
    tags: [],
  });
  await rpc("archive_contact", {
    workspace_id: workspace,
    id: archived,
    expected_version: 1,
    archived: true,
  });

  const rows = [
    {
      source_rows: [2, 3],
      email: "existing@example.com",
      name: "补全姓名",
      tags: ["老客", "VIP"],
      requested_status: "unconfirmed",
      consent_source: "",
      consent_note: "",
      consent_at: "",
      validation_error: "",
    },
    {
      source_rows: [4],
      email: "consented@example.com",
      name: "同意客户",
      tags: [],
      requested_status: "subscribed",
      consent_source: "线下签名",
      consent_note: "纸质表单编号 42",
      consent_at: "2026-09-01T10:00:00+08:00",
      validation_error: "",
    },
    {
      source_rows: [5],
      email: "blocked@example.com",
      name: "退订客户",
      tags: [],
      requested_status: "unsubscribed",
      consent_source: "",
      consent_note: "历史退订名单",
      consent_at: "",
      validation_error: "",
    },
    {
      source_rows: [6],
      email: "archived@example.com",
      name: "不能覆盖",
      tags: ["新标签"],
      requested_status: "unconfirmed",
      consent_source: "",
      consent_note: "",
      consent_at: "",
      validation_error: "",
    },
    {
      source_rows: [7],
      email: "bad",
      name: "",
      tags: [],
      requested_status: "unconfirmed",
      consent_source: "",
      consent_note: "",
      consent_at: "",
      validation_error: "邮箱格式无效",
    },
  ];

  const prepared = await rpc("prepare_contact_import", {
    workspace_id: workspace,
    source_type: "csv",
    source_name: "首批名单.csv",
    consent_declared: false,
    consent_source: "",
    consent_note: "",
    consent_at: "",
    total_source_rows: 6,
    rows,
  });
  assert.equal(prepared.job.status, "prepared");
  assert.equal(prepared.job.total_groups, 5);
  assert.equal(prepared.job.summary.error, 1);
  assert.equal(prepared.job.summary.archived_skipped, 1);

  await t.test("查看者不能预检或读取导入任务", async () => {
    await assert.rejects(
      rpc(
        "get_contact_import",
        {
          workspace_id: workspace,
          id: prepared.job.id,
        },
        viewer,
      ),
      /权限/,
    );
  });

  await t.test("客户端不能直接写表或调用内部辅助函数", async () => {
    await assert.rejects(
      asUser(
        db,
        owner,
        `update edm.contact_imports set status='completed' where id='${prepared.job.id}'`,
      ),
      /permission/,
    );
    await assert.rejects(
      asUser(
        db,
        owner,
        `select edm_private.add_contact_tags('${workspace}','${existing}',array['越权标签'],false)`,
      ),
      /permission/,
    );
  });

  await rpc("confirm_contact_import", {
    workspace_id: workspace,
    id: prepared.job.id,
  });
  const completed = await rpc("process_contact_import_batch", {
    workspace_id: workspace,
    id: prepared.job.id,
  });
  assert.equal(completed.job.status, "completed");
  assert.equal(completed.job.processed_groups, 5);

  await t.test("导入只补空姓名、合并标签并保留归档", async () => {
    const contact = (
      await db.query(
        "select name,subscription_status from edm.contacts where id=$1",
        [existing],
      )
    ).rows[0];
    assert.deepEqual(contact, {
      name: "补全姓名",
      subscription_status: "unconfirmed",
    });
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.contact_tags where contact_id=$1",
          [existing],
        )
      ).rows[0].n,
      2,
    );
    const archivedRow = (
      await db.query("select name,archived_at from edm.contacts where id=$1", [
        archived,
      ])
    ).rows[0];
    assert.equal(archivedRow.name, "归档客户");
    assert.ok(archivedRow.archived_at);
  });

  await t.test("显式同意产生证据，退订产生独立抑制", async () => {
    assert.equal(
      (
        await db.query(
          "select subscription_status from edm.contacts where email='consented@example.com'",
        )
      ).rows[0].subscription_status,
      "subscribed",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.subscription_events where email='consented@example.com' and event_type='consented'",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select reason from edm.suppressions where email='blocked@example.com'",
        )
      ).rows[0].reason,
      "unsubscribed",
    );
  });

  await t.test("重新导入不会覆盖退订", async () => {
    const second = await rpc("prepare_contact_import", {
      workspace_id: workspace,
      source_type: "paste",
      source_name: "重新导入",
      consent_declared: true,
      consent_source: "会员注册",
      consent_note: "注册页勾选记录",
      consent_at: "2026-09-01T10:00:00+08:00",
      total_source_rows: 1,
      rows: [
        {
          ...rows[2],
          requested_status: "subscribed",
          consent_source: "会员注册",
          consent_note: "注册页勾选记录",
        },
      ],
    });
    assert.equal(second.rows[0].preview_result, "suppressed_protected");
    await rpc("confirm_contact_import", {
      workspace_id: workspace,
      id: second.job.id,
    });
    const result = await rpc("process_contact_import_batch", {
      workspace_id: workspace,
      id: second.job.id,
    });
    assert.equal(result.rows[0].result, "suppressed_protected");
    assert.equal(
      (
        await db.query(
          "select subscription_status from edm.contacts where email='blocked@example.com'",
        )
      ).rows[0].subscription_status,
      "unsubscribed",
    );
    await assert.rejects(
      rpc("process_contact_import_batch", {
        workspace_id: workspace,
        id: second.job.id,
      }),
      /结束/,
    );
  });

  await t.test("手动退订同样不能被后续导入恢复", async () => {
    const consented = (
      await db.query(
        "select id,version from edm.contacts where email='consented@example.com'",
      )
    ).rows[0];
    await rpc("unsubscribe_contact", {
      workspace_id: workspace,
      id: consented.id,
      expected_version: consented.version,
      reason: "客户来信要求退订",
    });
    assert.equal(
      (
        await db.query(
          "select subscription_status from edm.contacts where id=$1",
          [consented.id],
        )
      ).rows[0].subscription_status,
      "unsubscribed",
    );
  });
});
