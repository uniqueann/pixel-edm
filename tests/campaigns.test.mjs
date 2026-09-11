import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

test("P3 活动草稿、工作区权限、归档模板兼容与业务审计", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const admin = "50000000-0000-0000-0000-000000000001";
  const editor = "50000000-0000-0000-0000-000000000002";
  const viewer = "50000000-0000-0000-0000-000000000003";
  const outsider = "50000000-0000-0000-0000-000000000004";
  await db.exec(
    `insert into auth.users values('${admin}'),('${editor}'),('${viewer}'),('${outsider}')`,
  );
  const workspace = (
    await asUser(db, admin, "select edm.initialize_member() id")
  ).rows[0].id;
  await asUser(db, editor, "select edm.initialize_member()");
  await asUser(db, viewer, "select edm.initialize_member()");
  const otherWorkspace = (
    await asUser(db, outsider, "select edm.initialize_member() id")
  ).rows[0].id;
  await db.exec(`
    insert into edm.workspace_members(workspace_id,user_id,role)
    values('${workspace}','${editor}','editor'),('${workspace}','${viewer}','viewer')
  `);
  const template = (
    await db.query(
      "select id from edm.templates where workspace_id=$1 and archived_at is null order by created_at limit 1",
      [workspace],
    )
  ).rows[0].id;
  const secondTemplate = (
    await db.query(
      "select id from edm.templates where workspace_id=$1 and id<>$2 and archived_at is null order by id limit 1",
      [workspace, template],
    )
  ).rows[0].id;
  const otherTemplate = (
    await db.query(
      "select id from edm.templates where workspace_id=$1 and archived_at is null order by created_at limit 1",
      [otherWorkspace],
    )
  ).rows[0].id;
  await db.query("insert into edm.tags(workspace_id,name) values($1,'VIP')", [
    workspace,
  ]);
  await db.query(
    "insert into edm.tags(workspace_id,name) values($1,'其他工作区')",
    [otherWorkspace],
  );
  const tag = (
    await db.query("select id from edm.tags where workspace_id=$1", [workspace])
  ).rows[0].id;
  const otherTag = (
    await db.query("select id from edm.tags where workspace_id=$1", [
      otherWorkspace,
    ])
  ).rows[0].id;

  const rpc = async (name, payload, user = admin, role = "authenticated") =>
    (
      await asUser(
        db,
        user,
        `select edm.${name}('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb) result`,
        role,
      )
    ).rows[0].result;

  let campaign;
  await t.test("活动编辑选项按工作区、角色和模板变量收敛", async () => {
    const options = await rpc("get_campaign_editor_options", {
      workspace_id: workspace,
    });
    assert.equal(options.templates.length, 6);
    assert.equal(options.tags.length, 1);
    assert.equal(options.tags[0].name, "VIP");
    assert.ok(
      options.templates.every(
        (item) =>
          !item.variable_keys.includes("name") &&
          !item.variable_keys.includes("email"),
      ),
    );
    const welcome = options.templates.find(
      (item) => item.name === "欢迎新客户",
    );
    assert.deepEqual(welcome.variable_keys, [
      "store_name",
      "sender_name",
      "discount",
    ]);
    assert.equal(
      (
        await rpc(
          "get_campaign_editor_options",
          { workspace_id: workspace },
          editor,
        )
      ).templates.length,
      6,
    );
    await assert.rejects(
      rpc("get_campaign_editor_options", { workspace_id: workspace }, viewer),
      /权限/,
    );
    await assert.rejects(
      rpc("get_campaign_editor_options", { workspace_id: workspace }, outsider),
      /权限/,
    );
    const otherOptions = await rpc(
      "get_campaign_editor_options",
      { workspace_id: otherWorkspace },
      outsider,
    );
    assert.ok(otherOptions.templates.every((item) => item.id !== template));
    assert.ok(otherOptions.tags.every((item) => item.id !== tag));
  });

  await t.test(
    "管理员和编辑者可保存不完整草稿，查看者只能读取摘要",
    async () => {
      campaign = await rpc("save_campaign", {
        workspace_id: workspace,
        name: "秋季活动",
        template_id: template,
        audience_type: "tag",
        tag_id: tag,
        variables: { discount: "SECRET-20", sender_name: "" },
      });
      const list = await rpc(
        "list_campaigns",
        { workspace_id: workspace },
        viewer,
      );
      assert.equal(list.total, 1);
      assert.equal(list.page_size, 20);
      assert.equal(list.items[0].name, "秋季活动");
      assert.equal(list.items[0].tag_name, "VIP");
      assert.equal("variables" in list.items[0], false);
      assert.equal(list.items[0].recipient_count, null);
      assert.equal(list.items[0].confirmed_at, null);
      assert.equal("subject" in list.items[0], false);

      await assert.rejects(
        rpc("get_campaign", { workspace_id: workspace, id: campaign }, viewer),
        /权限/,
      );
      await assert.rejects(
        rpc(
          "save_campaign",
          {
            workspace_id: workspace,
            name: "越权活动",
            template_id: template,
            audience_type: "all",
            variables: {},
          },
          viewer,
        ),
        /权限/,
      );

      const detail = await rpc(
        "get_campaign",
        { workspace_id: workspace, id: campaign },
        editor,
      );
      assert.equal(detail.variables.discount, "SECRET-20");
      assert.equal(detail.template.id, template);

      await rpc(
        "save_campaign",
        {
          workspace_id: workspace,
          id: campaign,
          expected_version: 1,
          name: "秋季活动更新",
          template_id: template,
          audience_type: "all",
          tag_id: null,
          variables: {},
        },
        editor,
      );
      assert.equal(
        (
          await rpc("get_campaign", {
            workspace_id: workspace,
            id: campaign,
          })
        ).version,
        2,
      );
    },
  );

  await t.test("数据库约束拒绝非法变量、收件范围和跨工作区关联", async () => {
    const base = {
      workspace_id: workspace,
      name: "非法活动",
      template_id: template,
      audience_type: "all",
      variables: {},
    };
    await assert.rejects(
      rpc("save_campaign", { ...base, tag_id: tag }),
      /不一致/,
    );
    await assert.rejects(
      rpc("save_campaign", {
        ...base,
        audience_type: "tag",
        tag_id: null,
      }),
      /不一致/,
    );
    await assert.rejects(
      rpc("save_campaign", { ...base, variables: { unknown: "value" } }),
      /变量格式无效/,
    );
    await assert.rejects(
      rpc("save_campaign", { ...base, variables: { discount: 20 } }),
      /变量格式无效/,
    );
    await assert.rejects(
      rpc("save_campaign", { ...base, variables: [] }),
      /变量格式无效/,
    );
    await assert.rejects(
      rpc("save_campaign", {
        ...base,
        variables: { discount: "x".repeat(201) },
      }),
      /变量格式无效/,
    );
    await assert.rejects(
      rpc("save_campaign", { ...base, template_id: otherTemplate }),
      /模板不存在|不可访问/,
    );
    await assert.rejects(
      rpc("save_campaign", {
        ...base,
        audience_type: "tag",
        tag_id: otherTag,
      }),
      /标签不存在|不可访问/,
    );
    await assert.rejects(
      db.query(
        `insert into edm.campaigns(workspace_id,name,template_id,audience_type,created_by,updated_by)
         values($1,'跨工作区成员',$2,'all',$3,$3)`,
        [workspace, template, outsider],
      ),
      /foreign key/,
    );
  });

  await t.test("直接表访问、匿名、AIGC 与非成员访问均被拒绝", async () => {
    await assert.rejects(
      asUser(db, admin, "select * from edm.campaigns"),
      /permission/,
    );
    await assert.rejects(
      asUser(db, admin, "insert into edm.campaigns default values"),
      /permission/,
    );
    await assert.rejects(
      asUser(
        db,
        admin,
        "select edm_private.campaign_variables_are_valid('{}'::jsonb)",
      ),
      /permission/,
    );
    await assert.rejects(
      rpc("list_campaigns", { workspace_id: workspace }, null, "anon"),
      /permission/,
    );
    await assert.rejects(
      rpc("list_campaigns", { workspace_id: workspace }, outsider, "aigc_api"),
      /permission/,
    );
    await assert.rejects(
      rpc("list_campaigns", { workspace_id: workspace }, outsider),
      /不可访问/,
    );
  });

  await t.test("归档模板可被既有草稿保留，但不能新建或切换引用", async () => {
    const existing = await rpc("save_campaign", {
      workspace_id: workspace,
      name: "保留模板引用",
      template_id: secondTemplate,
      audience_type: "all",
      variables: {},
    });
    await rpc("set_template_archived", {
      workspace_id: workspace,
      id: secondTemplate,
      expected_version: 1,
      archived: true,
    });
    assert.equal(
      (
        await rpc("get_campaign_editor_options", {
          workspace_id: workspace,
        })
      ).templates.some((item) => item.id === secondTemplate),
      false,
    );
    await rpc("save_campaign", {
      workspace_id: workspace,
      id: existing,
      expected_version: 1,
      name: "保留模板引用更新",
      template_id: secondTemplate,
      audience_type: "all",
      variables: { product: "" },
    });
    await assert.rejects(
      rpc("save_campaign", {
        workspace_id: workspace,
        name: "不能新建",
        template_id: secondTemplate,
        audience_type: "all",
        variables: {},
      }),
      /已归档/,
    );
    await assert.rejects(
      rpc("save_campaign", {
        workspace_id: workspace,
        id: campaign,
        expected_version: 2,
        name: "不能切换",
        template_id: secondTemplate,
        audience_type: "all",
        variables: {},
      }),
      /已归档/,
    );
    const summary = (
      await rpc("list_campaigns", { workspace_id: workspace })
    ).items.find((item) => item.id === existing);
    assert.equal(summary.template_archived, true);
  });

  await t.test("并发版本、活动归档和非草稿状态均阻止非法修改", async () => {
    await assert.rejects(
      rpc("save_campaign", {
        workspace_id: workspace,
        id: campaign,
        expected_version: 1,
        name: "旧版本更新",
        template_id: template,
        audience_type: "all",
        variables: {},
      }),
      /重新加载/,
    );
    await rpc("set_campaign_archived", {
      workspace_id: workspace,
      id: campaign,
      expected_version: 2,
      archived: true,
    });
    await assert.rejects(
      rpc("save_campaign", {
        workspace_id: workspace,
        id: campaign,
        expected_version: 3,
        name: "归档后编辑",
        template_id: template,
        audience_type: "all",
        variables: {},
      }),
      /先恢复/,
    );
    await rpc("set_campaign_archived", {
      workspace_id: workspace,
      id: campaign,
      expected_version: 3,
      archived: false,
    });
    await db.query("update edm.campaigns set status='queued' where id=$1", [
      campaign,
    ]);
    await assert.rejects(
      rpc("set_campaign_archived", {
        workspace_id: workspace,
        id: campaign,
        expected_version: 4,
        archived: true,
      }),
      /当前活动状态/,
    );
    await assert.rejects(
      rpc("save_campaign", {
        workspace_id: workspace,
        id: campaign,
        expected_version: 4,
        name: "排队后编辑",
        template_id: template,
        audience_type: "all",
        variables: {},
      }),
      /只有草稿/,
    );
  });

  await t.test(
    "活动审计不记录变量值或模板正文，P3-4 快照表已隔离",
    async () => {
      for (const action of [
        "campaign.created",
        "campaign.updated",
        "campaign.archived",
        "campaign.restored",
      ]) {
        assert.equal(
          (
            await db.query(
              "select count(*)::int n from edm.activity_logs where workspace_id=$1 and target_id=$2 and action=$3",
              [workspace, campaign, action],
            )
          ).rows[0].n,
          1,
        );
      }
      const metadata = JSON.stringify(
        (
          await db.query(
            "select metadata from edm.activity_logs where workspace_id=$1 and target_type='campaign'",
            [workspace],
          )
        ).rows,
      );
      assert.equal(metadata.includes("SECRET-20"), false);
      assert.equal(metadata.includes("Contact {{email}}"), false);
      assert.match(metadata, /variable_keys/);

      const tables = (
        await db.query(
          "select table_name from information_schema.tables where table_schema='edm' and (table_name like 'campaign_recipient%' or table_name like 'campaign_snapshot%')",
        )
      ).rows;
      assert.deepEqual(tables.map((item) => item.table_name).sort(), [
        "campaign_recipient_snapshots",
        "campaign_snapshots",
      ]);
    },
  );
});
