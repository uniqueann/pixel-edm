import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

test("模板初始化、变量校验、权限与 P2 业务审计", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const admin = "40000000-0000-0000-0000-000000000001";
  const editor = "40000000-0000-0000-0000-000000000002";
  const viewer = "40000000-0000-0000-0000-000000000003";
  await db.exec(
    `insert into auth.users(id) values('${admin}'),('${editor}'),('${viewer}')`,
  );
  const workspace = (
    await asUser(db, admin, "select edm.initialize_member() id")
  ).rows[0].id;
  await asUser(db, editor, "select edm.initialize_member()");
  await asUser(db, viewer, "select edm.initialize_member()");
  await db.exec(`
    insert into edm.workspace_members(workspace_id,user_id,role)
    values('${workspace}','${editor}','editor'),('${workspace}','${viewer}','viewer')
  `);
  // 操作日志用例需专业版及以上（免费版不可查看日志）
  await db.query("update edm.workspaces set plan='pro' where id=$1", [workspace]);
  const rpc = async (name, payload, user = admin) =>
    (
      await asUser(
        db,
        user,
        `select edm.${name}('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb) result`,
      )
    ).rows[0].result;

  await t.test("六套原型模板只初始化一次", async () => {
    const defaults = await rpc("list_templates", { workspace_id: workspace });
    assert.equal(defaults.total, 6);
    assert.deepEqual(defaults.items.map((item) => item.default_key).sort(), [
      "abandoned_cart",
      "promotion",
      "review_request",
      "shipping",
      "welcome",
      "winback",
    ]);
    assert.equal(
      defaults.items.find((item) => item.default_key === "welcome").subject,
      "Welcome to {{store_name}} — here's 10% off",
    );
    await asUser(db, admin, "select edm.initialize_member()");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.templates where workspace_id=$1",
          [workspace],
        )
      ).rows[0].n,
      6,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.activity_logs where workspace_id=$1 and action='template.defaults_initialized'",
          [workspace],
        )
      ).rows[0].n,
      1,
    );
  });

  let created;
  await t.test(
    "编辑者可管理模板，查看者只读，变量由数据库兜底校验",
    async () => {
      assert.equal(
        (await rpc("list_templates", { workspace_id: workspace }, viewer))
          .total,
        6,
      );
      await assert.rejects(
        rpc(
          "save_template",
          {
            workspace_id: workspace,
            name: "越权模板",
            category: "自定义",
            subject: "Hello",
            body: "Body",
          },
          viewer,
        ),
        /权限/,
      );
      await assert.rejects(
        rpc("save_template", {
          workspace_id: workspace,
          name: "错误变量",
          category: "自定义",
          subject: "Hi {{unknown}}",
          body: "Hello {{name}}",
        }),
        /未知变量/,
      );
      await assert.rejects(
        rpc("save_template", {
          workspace_id: workspace,
          name: "换行主题",
          category: "自定义",
          subject: "第一行\n第二行",
          body: "正文",
        }),
        /不能换行/,
      );
      created = await rpc(
        "save_template",
        {
          workspace_id: workspace,
          name: "运营模板",
          category: "自定义",
          subject: "Hi {{ name }}",
          body: "Contact {{email}} from {{store_name}}",
        },
        editor,
      );
      const duplicate = await rpc(
        "duplicate_template",
        { workspace_id: workspace, id: created },
        editor,
      );
      const duplicateRow = (
        await db.query(
          "select name,source_template_id from edm.templates where id=$1",
          [duplicate],
        )
      ).rows[0];
      assert.equal(duplicateRow.name, "运营模板 副本");
      assert.equal(duplicateRow.source_template_id, created);
      await rpc(
        "set_template_archived",
        {
          workspace_id: workspace,
          id: created,
          expected_version: 1,
          archived: true,
        },
        editor,
      );
      await assert.rejects(
        rpc(
          "save_template",
          {
            workspace_id: workspace,
            id: created,
            expected_version: 1,
            name: "冲突",
            category: "自定义",
            subject: "主题",
            body: "正文",
          },
          editor,
        ),
        /重新加载|先恢复/,
      );
      await rpc(
        "set_template_archived",
        {
          workspace_id: workspace,
          id: created,
          expected_version: 2,
          archived: false,
        },
        editor,
      );
    },
  );

  await t.test("归档全部默认模板后不会自动重建", async () => {
    const defaults = (
      await db.query(
        "select id,version from edm.templates where workspace_id=$1 and default_key is not null",
        [workspace],
      )
    ).rows;
    for (const item of defaults) {
      await rpc("set_template_archived", {
        workspace_id: workspace,
        id: item.id,
        expected_version: item.version,
        archived: true,
      });
    }
    await asUser(db, admin, "select edm.initialize_member()");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.templates where workspace_id=$1 and default_key is not null",
          [workspace],
        )
      ).rows[0].n,
      6,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.templates where workspace_id=$1 and default_key is not null and archived_at is null",
          [workspace],
        )
      ).rows[0].n,
      0,
    );
  });

  await t.test("客户与名单导入写入单条业务审计", async () => {
    const contact = await rpc("save_contact", {
      workspace_id: workspace,
      email: "audit@example.com",
      name: "审计客户",
      tags: ["审计"],
    });
    await rpc("save_contact", {
      workspace_id: workspace,
      id: contact,
      expected_version: 1,
      email: "audit@example.com",
      name: "审计客户更新",
      tags: ["审计"],
    });
    await rpc("archive_contact", {
      workspace_id: workspace,
      id: contact,
      expected_version: 2,
      archived: true,
    });
    await rpc("archive_contact", {
      workspace_id: workspace,
      id: contact,
      expected_version: 3,
      archived: false,
    });
    await rpc("unsubscribe_contact", {
      workspace_id: workspace,
      id: contact,
      expected_version: 4,
      reason: "审计测试",
    });
    for (const action of [
      "contact.created",
      "contact.updated",
      "contact.archived",
      "contact.restored",
      "contact.unsubscribed",
    ]) {
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from edm.activity_logs where workspace_id=$1 and target_id=$2 and action=$3",
            [workspace, contact, action],
          )
        ).rows[0].n,
        1,
      );
    }

    const prepared = await rpc("prepare_contact_import", {
      workspace_id: workspace,
      source_type: "paste",
      source_name: "全错误名单",
      consent_declared: false,
      consent_source: "",
      consent_note: "",
      consent_at: "",
      total_source_rows: 1,
      rows: [
        {
          source_rows: [1],
          email: "bad",
          name: "",
          tags: [],
          requested_status: "unconfirmed",
          consent_source: "",
          consent_note: "",
          consent_at: "",
          validation_error: "邮箱格式无效",
        },
      ],
    });
    await rpc("confirm_contact_import", {
      workspace_id: workspace,
      id: prepared.job.id,
    });
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.activity_logs where workspace_id=$1 and target_id=$2 and action='contact_import.completed'",
          [workspace, prepared.job.id],
        )
      ).rows[0].n,
      1,
    );
  });

  await t.test("日志只允许管理员读取且保留操作者快照", async () => {
    const beforeRename = await rpc("list_activity_logs", {
      workspace_id: workspace,
      actor: editor,
    });
    assert.ok(beforeRename.items.length >= 3);
    assert.ok(beforeRename.items.every((item) => item.actor_name === "店主"));
    await asUser(
      db,
      editor,
      "update edm.members set display_name='新运营名' where user_id=auth.uid()",
    );
    const afterRename = await rpc("list_activity_logs", {
      workspace_id: workspace,
      actor: editor,
    });
    assert.ok(afterRename.items.every((item) => item.actor_name === "店主"));
    await assert.rejects(
      rpc("list_activity_logs", { workspace_id: workspace }, editor),
      /权限/,
    );
    await assert.rejects(
      asUser(
        db,
        admin,
        `insert into edm.activity_logs(workspace_id,actor_name,actor_role,action,target_type) values('${workspace}','伪造','admin','fake.action','fake')`,
      ),
      /permission/,
    );
    await assert.rejects(
      asUser(
        db,
        admin,
        `select edm_private.log_activity('${workspace}','fake.action','fake',null,'伪造')`,
      ),
      /permission/,
    );
    await assert.rejects(
      asUser(db, admin, "select * from edm.activity_logs", "aigc_api"),
      /permission/,
    );
  });
});
