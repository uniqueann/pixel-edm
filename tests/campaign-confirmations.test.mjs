import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

test("P3-4 活动确认、不可变快照、导出与权限", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const admin = "61000000-0000-0000-0000-000000000001";
  const editor = "61000000-0000-0000-0000-000000000002";
  const viewer = "61000000-0000-0000-0000-000000000003";
  const outsider = "61000000-0000-0000-0000-000000000004";
  await db.exec(
    `insert into auth.users(id) values('${admin}'),('${editor}'),('${viewer}'),('${outsider}')`,
  );
  const workspace = (
    await asUser(db, admin, "select edm.initialize_member() id")
  ).rows[0].id;
  await asUser(db, editor, "select edm.initialize_member()");
  await asUser(db, viewer, "select edm.initialize_member()");
  await asUser(db, outsider, "select edm.initialize_member()");
  await db.exec(`
    insert into edm.workspace_members(workspace_id,user_id,role)
    values('${workspace}','${editor}','editor'),('${workspace}','${viewer}','viewer')
  `);
  await db.query(
    "update edm.delivery_plan_limits set max_active_members=20 where plan='free'",
  );

  const template = (
    await db.query(
      "select id from edm.templates where workspace_id=$1 and default_key='welcome'",
      [workspace],
    )
  ).rows[0].id;
  const replacementTemplate = (
    await db.query(
      "select id from edm.templates where workspace_id=$1 and default_key='promotion'",
      [workspace],
    )
  ).rows[0].id;
  await db.query(
    `update edm.templates
     set subject='主题 {{discount}} / {{name}}',
         body=E'你好 {{name}},\n邮箱 {{email}}，优惠 {{discount}}。',
         version=version+1
     where id=$1`,
    [template],
  );

  const contacts = [
    ["alpha@example.test", "阿尔法", "subscribed", false],
    ["blank@example.test", "", "subscribed", false],
    ["archived@example.test", "归档", "subscribed", true],
    ["pending@example.test", "待确认", "unconfirmed", false],
    ["suppressed@example.test", "抑制", "subscribed", false],
  ];
  const contactIds = new Map();
  for (const [index, [email, name, status, archived]] of contacts.entries()) {
    const contact = (
      await db.query(
        `insert into edm.contacts(
           workspace_id,email,name,subscription_status,archived_at,created_by,created_at
         ) values($1,$2,$3,$4,case when $5 then now() end,$6,$7) returning id`,
        [
          workspace,
          email,
          name,
          status,
          archived,
          admin,
          new Date(Date.UTC(2026, 2, index + 1)).toISOString(),
        ],
      )
    ).rows[0];
    contactIds.set(email, contact.id);
  }
  const suppressionEvent = (
    await db.query(
      `insert into edm.subscription_events(
         workspace_id,contact_id,email,event_type,source,note,created_by
       ) values($1,$2,'suppressed@example.test','unsubscribed','test','测试',$3)
       returning id`,
      [workspace, contactIds.get("suppressed@example.test"), admin],
    )
  ).rows[0].id;
  await db.query(
    `insert into edm.suppressions(workspace_id,email,reason,first_event_id)
     values($1,'suppressed@example.test','unsubscribed',$2)`,
    [workspace, suppressionEvent],
  );

  const rpc = async (name, payload, user = admin, role = "authenticated") =>
    (
      await asUser(
        db,
        user,
        `select edm.${name}('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb) result`,
        role,
      )
    ).rows[0].result;

  const campaign = await rpc("save_campaign", {
    workspace_id: workspace,
    name: "三月确认活动",
    template_id: template,
    audience_type: "all",
    variables: { discount: 'SAVE,"20"' },
  });
  const preview = await rpc("get_campaign_preview", {
    workspace_id: workspace,
    id: campaign,
  });

  let confirmation;
  await t.test("确认时冻结互斥统计和稳定顺序的合并邮件", async () => {
    confirmation = await rpc("confirm_campaign", {
      workspace_id: workspace,
      id: campaign,
      expected_campaign_version: preview.campaign.version,
      expected_template_version: preview.template.version,
    });
    assert.equal(confirmation.recipient_count, 2);
    assert.equal(confirmation.template_version, 2);
    assert.equal(confirmation.already_confirmed, false);

    const snapshot = (
      await db.query(
        "select * from edm.campaign_snapshots where campaign_id=$1",
        [campaign],
      )
    ).rows[0];
    assert.equal(snapshot.audience_count, 5);
    assert.equal(snapshot.recipient_count, 2);
    assert.equal(snapshot.excluded_archived_count, 1);
    assert.equal(snapshot.excluded_suppressed_count, 1);
    assert.equal(snapshot.excluded_not_subscribed_count, 1);
    assert.equal(snapshot.template_subject, "主题 {{discount}} / {{name}}");
    assert.deepEqual(snapshot.variables, { discount: 'SAVE,"20"' });

    const recipients = (
      await db.query(
        `select position,email,name,subject,body
         from edm.campaign_recipient_snapshots where snapshot_id=$1 order by position`,
        [snapshot.id],
      )
    ).rows;
    assert.deepEqual(
      recipients.map((row) => row.email),
      ["alpha@example.test", "blank@example.test"],
    );
    assert.equal(recipients[1].name, "blank");
    assert.equal(recipients[0].subject, '主题 SAVE,"20" / 阿尔法');
    assert.equal(
      recipients[0].body,
      '你好 阿尔法,\n邮箱 alpha@example.test，优惠 SAVE,"20"。',
    );

    const viewerList = await rpc(
      "list_campaigns",
      { workspace_id: workspace },
      viewer,
    );
    const viewerSummary = viewerList.items.find((item) => item.id === campaign);
    assert.equal(viewerSummary.status, "confirmed");
    assert.equal(viewerSummary.recipient_count, 2);
    assert.equal(viewerSummary.snapshot_template_version, 2);
    assert.equal("variables" in viewerSummary, false);
    assert.equal("template_subject" in viewerSummary, false);
  });

  await t.test("重复确认幂等且后续来源变化不改写快照", async () => {
    const retried = await rpc("confirm_campaign", {
      workspace_id: workspace,
      id: campaign,
      expected_campaign_version: 1,
      expected_template_version: 1,
    });
    assert.equal(retried.snapshot_id, confirmation.snapshot_id);
    assert.equal(retried.already_confirmed, true);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.campaign_snapshots where campaign_id=$1",
          [campaign],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.activity_logs where target_id=$1 and action='campaign.confirmed'",
          [campaign],
        )
      ).rows[0].n,
      1,
    );

    await db.query(
      "update edm.contacts set name='已变化',subscription_status='unsubscribed' where id=$1",
      [contactIds.get("alpha@example.test")],
    );
    await db.query(
      "update edm.templates set subject='已变化主题',body='已变化正文',version=version+1 where id=$1",
      [template],
    );
    const frozen = (
      await db.query(
        "select name,subject,body from edm.campaign_recipient_snapshots where snapshot_id=$1 and position=1",
        [confirmation.snapshot_id],
      )
    ).rows[0];
    assert.equal(frozen.name, "阿尔法");
    assert.equal(frozen.subject, '主题 SAVE,"20" / 阿尔法');
    assert.match(frozen.body, /alpha@example\.test/);
  });

  await t.test("分块导出稳定且单次请求只记录一条审计", async () => {
    const exportId = "61000000-0000-0000-0000-000000000099";
    const first = await rpc("get_campaign_export_chunk", {
      workspace_id: workspace,
      id: campaign,
      export_id: exportId,
      after_position: 0,
      limit: 1,
    });
    assert.equal(first.rows.length, 1);
    assert.equal(first.has_more, true);
    const second = await rpc("get_campaign_export_chunk", {
      workspace_id: workspace,
      id: campaign,
      export_id: exportId,
      after_position: first.next_position,
      limit: 1,
    });
    assert.equal(second.rows[0].email, "blank@example.test");
    assert.equal(second.has_more, false);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.activity_logs where target_id=$1 and action='campaign.csv_exported'",
          [campaign],
        )
      ).rows[0].n,
      1,
    );
  });

  await t.test("已确认活动不可编辑但可归档恢复和复制", async () => {
    await assert.rejects(
      rpc("save_campaign", {
        workspace_id: workspace,
        id: campaign,
        expected_version: confirmation.campaign_version,
        name: "非法编辑",
        template_id: template,
        audience_type: "all",
        variables: {},
      }),
      /只有草稿/,
    );
    await rpc("set_campaign_archived", {
      workspace_id: workspace,
      id: campaign,
      expected_version: confirmation.campaign_version,
      archived: true,
    });
    await rpc("set_campaign_archived", {
      workspace_id: workspace,
      id: campaign,
      expected_version: confirmation.campaign_version + 1,
      archived: false,
    });

    await db.query(
      "update edm.templates set archived_at=now(),version=version+1 where id=$1",
      [template],
    );

    await assert.rejects(
      rpc("duplicate_confirmed_campaign", {
        workspace_id: workspace,
        id: campaign,
      }),
      /已归档/,
    );
    const duplicate = await rpc("duplicate_confirmed_campaign", {
      workspace_id: workspace,
      id: campaign,
      template_id: replacementTemplate,
    });
    const duplicateRow = (
      await db.query("select * from edm.campaigns where id=$1", [duplicate])
    ).rows[0];
    assert.equal(duplicateRow.status, "draft");
    assert.equal(duplicateRow.name, "三月确认活动（副本）");
    assert.equal(duplicateRow.template_id, replacementTemplate);
    assert.deepEqual(duplicateRow.variables, { discount: 'SAVE,"20"' });
  });

  await t.test("无效确认条件和角色权限均在数据库阻断", async () => {
    for (const [user, role] of [
      [viewer, "authenticated"],
      [outsider, "authenticated"],
      [null, "anon"],
      [outsider, "aigc_api"],
    ]) {
      await assert.rejects(
        rpc(
          "get_campaign_export_chunk",
          {
            workspace_id: workspace,
            id: campaign,
            export_id: crypto.randomUUID(),
          },
          user,
          role,
        ),
        /权限|permission/,
      );
    }
    await assert.rejects(
      asUser(db, admin, "select * from edm.campaign_snapshots"),
      /permission/,
    );
    await assert.rejects(
      asUser(db, admin, "select * from edm.campaign_recipient_snapshots"),
      /permission/,
    );
    await assert.rejects(
      db.query(
        "update edm.campaign_snapshots set campaign_name='修改' where id=$1",
        [confirmation.snapshot_id],
      ),
      /不可修改/,
    );
  });

  await t.test(
    "版本、模板、变量、零收件人与上限都能阻断且事务回滚",
    async () => {
      const emptyTemplate = (
        await db.query(
          `insert into edm.templates(workspace_id,name,category,subject,body,created_by,updated_by)
         values($1,'确认校验','测试','{{discount}}','正文',$2,$2) returning id`,
          [workspace, admin],
        )
      ).rows[0].id;
      const invalidCampaign = await rpc("save_campaign", {
        workspace_id: workspace,
        name: "无效确认",
        template_id: emptyTemplate,
        audience_type: "all",
        variables: { discount: "" },
      });
      await assert.rejects(
        rpc("confirm_campaign", {
          workspace_id: workspace,
          id: invalidCampaign,
          expected_campaign_version: 99,
          expected_template_version: 1,
        }),
        /活动已被修改/,
      );
      await assert.rejects(
        rpc("confirm_campaign", {
          workspace_id: workspace,
          id: invalidCampaign,
          expected_campaign_version: 1,
          expected_template_version: 1,
        }),
        /补充活动变量/,
      );
      await db.query(
        'update edm.campaigns set variables=\'{"discount":"OK"}\'::jsonb where id=$1',
        [invalidCampaign],
      );
      await assert.rejects(
        rpc("confirm_campaign", {
          workspace_id: workspace,
          id: invalidCampaign,
          expected_campaign_version: 1,
          expected_template_version: 99,
        }),
        /模板已被修改/,
      );
      await db.query(
        "update edm.contacts set subscription_status='unsubscribed' where workspace_id=$1",
        [workspace],
      );
      await assert.rejects(
        rpc("confirm_campaign", {
          workspace_id: workspace,
          id: invalidCampaign,
          expected_campaign_version: 1,
          expected_template_version: 1,
        }),
        /没有可确认/,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from edm.campaign_snapshots where campaign_id=$1",
            [invalidCampaign],
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(
        db.query(
          `select edm_private.assert_campaign_recipient_limit('${workspace}'::uuid, 501)`,
        ),
        /当前套餐下单个活动最多 500 位收件人/,
      );

      const bigWorkspace = (
        await db.query(
          "select id from edm.workspaces where bootstrap_owner_id=$1",
          [outsider],
        )
      ).rows[0].id;
      await db.query("update edm.workspaces set plan='team' where id=$1", [
        bigWorkspace,
      ]);
      const bigTemplate = (
        await db.query(
          `insert into edm.templates(workspace_id,name,category,subject,body,created_by,updated_by)
           values($1,'大名单模板','测试','主题','正文',$2,$2) returning id`,
          [bigWorkspace, outsider],
        )
      ).rows[0].id;
      await db.query(
        `insert into edm.contacts(workspace_id,email,name,subscription_status,created_by,created_at)
         select $1,'bulk-'||value||'@example.test','客户 '||value,'subscribed',$2,
           '2026-04-01'::timestamptz+(value||' seconds')::interval
         from generate_series(1,25001) value`,
        [bigWorkspace, outsider],
      );
      const bigCampaign = await rpc(
        "save_campaign",
        {
          workspace_id: bigWorkspace,
          name: "超限活动",
          template_id: bigTemplate,
          audience_type: "all",
          variables: {},
        },
        outsider,
      );
      await assert.rejects(
        rpc(
          "confirm_campaign",
          {
            workspace_id: bigWorkspace,
            id: bigCampaign,
            expected_campaign_version: 1,
            expected_template_version: 1,
          },
          outsider,
        ),
        /当前套餐下单个活动最多 25000 位收件人/,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from edm.campaign_snapshots where campaign_id=$1",
            [bigCampaign],
          )
        ).rows[0].n,
        0,
      );

      const oneTag = (
        await db.query(
          "insert into edm.tags(workspace_id,name) values($1,'单人') returning id",
          [bigWorkspace],
        )
      ).rows[0].id;
      await db.query(
        `insert into edm.contact_tags(workspace_id,contact_id,tag_id)
         select $1,id,$2 from edm.contacts where workspace_id=$1 order by created_at,id limit 1`,
        [bigWorkspace, oneTag],
      );
      const concurrentCampaign = await rpc(
        "save_campaign",
        {
          workspace_id: bigWorkspace,
          name: "并发确认活动",
          template_id: bigTemplate,
          audience_type: "tag",
          tag_id: oneTag,
          variables: {},
        },
        outsider,
      );
      const concurrentPayload = {
        workspace_id: bigWorkspace,
        id: concurrentCampaign,
        expected_campaign_version: 1,
        expected_template_version: 1,
      };
      const confirmations = await Promise.all([
        rpc("confirm_campaign", concurrentPayload, outsider),
        rpc("confirm_campaign", concurrentPayload, outsider),
      ]);
      assert.equal(confirmations[0].snapshot_id, confirmations[1].snapshot_id);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from edm.campaign_snapshots where campaign_id=$1",
            [concurrentCampaign],
          )
        ).rows[0].n,
        1,
      );
    },
  );
});
