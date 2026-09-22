import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

test("P3-3 动态收件人、变量完整性与前三封预览", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const admin = "51000000-0000-0000-0000-000000000001";
  const editor = "51000000-0000-0000-0000-000000000002";
  const viewer = "51000000-0000-0000-0000-000000000003";
  const outsider = "51000000-0000-0000-0000-000000000004";
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
  await db.query("update edm.workspaces set plan='team' where id=$1", [
    workspace,
  ]);

  const template = (
    await db.query(
      "select id from edm.templates where workspace_id=$1 and default_key='welcome'",
      [workspace],
    )
  ).rows[0].id;
  await db.query(
    `update edm.templates
     set subject='{{ name }} / {{email}} / {{discount}}',
         body=E'{{store_name}}\\n{{ discount }}\\n{{discount}}\\n{{sender_name}}',
         version=version+1
     where id=$1`,
    [template],
  );
  const tag = (
    await db.query(
      "insert into edm.tags(workspace_id,name) values($1,'VIP') returning id",
      [workspace],
    )
  ).rows[0].id;

  const contacts = [
    ["alpha@example.test", "Alpha", "subscribed", false, true],
    ["blank@example.test", "", "subscribed", false, true],
    ["charlie@example.test", "Charlie", "subscribed", false, false],
    ["delta@example.test", "Delta", "subscribed", false, true],
    ["archived@example.test", "Archived", "subscribed", true, true],
    ["suppressed@example.test", "Suppressed", "subscribed", false, true],
    ["pending@example.test", "Pending", "unconfirmed", false, true],
    ["unsubscribed@example.test", "Unsubscribed", "unsubscribed", false, false],
    ["bounced@example.test", "Bounced", "bounced", false, false],
    ["complained@example.test", "Complained", "complained", false, false],
  ];
  const contactIds = new Map();
  for (const [
    index,
    [email, name, status, archived, tagged],
  ] of contacts.entries()) {
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
          new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        ],
      )
    ).rows[0];
    contactIds.set(email, contact.id);
    if (tagged) {
      await db.query(
        "insert into edm.contact_tags(workspace_id,contact_id,tag_id) values($1,$2,$3)",
        [workspace, contact.id, tag],
      );
    }
  }
  const suppressedContact = contactIds.get("suppressed@example.test");
  const event = (
    await db.query(
      `insert into edm.subscription_events(
         workspace_id,contact_id,email,event_type,source,note,created_by
       ) values($1,$2,'suppressed@example.test','unsubscribed','test','测试抑制',$3)
       returning id`,
      [workspace, suppressedContact, admin],
    )
  ).rows[0].id;
  await db.query(
    `insert into edm.suppressions(workspace_id,email,reason,first_event_id)
     values($1,'suppressed@example.test','unsubscribed',$2)`,
    [workspace, event],
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
    name: "动态预览活动",
    template_id: template,
    audience_type: "all",
    variables: {
      store_name: "店铺\\路径",
      sender_name: "发送人 $1",
      discount: "",
    },
  });

  await t.test("缺失变量阻断样本但保留互斥筛选统计", async () => {
    const preview = await rpc("get_campaign_preview", {
      workspace_id: workspace,
      id: campaign,
    });
    assert.equal(preview.validation.valid, false);
    assert.deepEqual(preview.validation.missing_variables, ["discount"]);
    assert.deepEqual(
      preview.validation.blockers.map((item) => item.code),
      ["missing_variables"],
    );
    assert.equal(preview.recipients.audience_count, 10);
    assert.equal(preview.recipients.eligible_count, 4);
    assert.deepEqual(preview.recipients.excluded, {
      archived: 1,
      not_subscribed: 4,
      suppressed: 1,
    });
    assert.equal(preview.recipients.excluded_count, 6);
    assert.deepEqual(preview.recipients.sample, []);
    assert.equal(
      preview.recipients.audience_count,
      preview.recipients.eligible_count +
        preview.recipients.excluded.archived +
        preview.recipients.excluded.not_subscribed +
        preview.recipients.excluded.suppressed,
    );
  });

  await t.test("完整变量按固定顺序渲染前三封并保留特殊字符", async () => {
    await rpc("save_campaign", {
      workspace_id: workspace,
      id: campaign,
      expected_version: 1,
      name: "动态预览活动",
      template_id: template,
      audience_type: "all",
      variables: {
        store_name: "店铺\\路径",
        sender_name: "发送人 $1",
        discount: "SAVE\\20",
      },
    });
    const preview = await rpc("get_campaign_preview", {
      workspace_id: workspace,
      id: campaign,
    });
    assert.equal(preview.validation.valid, true);
    assert.equal(preview.template.version, 2);
    assert.equal(preview.recipients.sample.length, 3);
    assert.deepEqual(
      preview.recipients.sample.map((item) => item.email),
      ["alpha@example.test", "blank@example.test", "charlie@example.test"],
    );
    assert.equal(preview.recipients.sample[1].name, "blank");
    assert.equal(
      preview.recipients.sample[1].subject,
      "blank / blank@example.test / SAVE\\20",
    );
    assert.equal(
      preview.recipients.sample[0].body,
      "店铺\\路径\nSAVE\\20\nSAVE\\20\n发送人 $1",
    );
  });

  await t.test("标签、订阅和抑制变化会在下一次预览立即生效", async () => {
    await rpc("save_campaign", {
      workspace_id: workspace,
      id: campaign,
      expected_version: 2,
      name: "VIP 动态预览",
      template_id: template,
      audience_type: "tag",
      tag_id: tag,
      variables: {
        store_name: "店铺\\路径",
        sender_name: "发送人 $1",
        discount: "SAVE\\20",
      },
    });
    let preview = await rpc("get_campaign_preview", {
      workspace_id: workspace,
      id: campaign,
    });
    assert.equal(preview.recipients.audience_count, 6);
    assert.equal(preview.recipients.eligible_count, 3);
    assert.deepEqual(
      preview.recipients.sample.map((item) => item.email),
      ["alpha@example.test", "blank@example.test", "delta@example.test"],
    );

    await db.query(
      "update edm.contacts set subscription_status='unconfirmed' where id=$1",
      [contactIds.get("alpha@example.test")],
    );
    await db.query(
      "delete from edm.contact_tags where contact_id=$1 and tag_id=$2",
      [contactIds.get("delta@example.test"), tag],
    );
    preview = await rpc("get_campaign_preview", {
      workspace_id: workspace,
      id: campaign,
    });
    assert.equal(preview.recipients.audience_count, 5);
    assert.equal(preview.recipients.eligible_count, 1);
    assert.equal(preview.recipients.excluded.not_subscribed, 2);
    assert.deepEqual(
      preview.recipients.sample.map((item) => item.email),
      ["blank@example.test"],
    );
  });

  await t.test("模板新增变量和归档都会结构化阻断预览", async () => {
    await db.query(
      "update edm.templates set body=body||E'\\n{{product}}',version=version+1 where id=$1",
      [template],
    );
    let preview = await rpc("get_campaign_preview", {
      workspace_id: workspace,
      id: campaign,
    });
    assert.equal(preview.validation.valid, false);
    assert.deepEqual(preview.validation.missing_variables, ["product"]);
    assert.deepEqual(preview.recipients.sample, []);

    await db.query(
      "update edm.templates set archived_at=now(),version=version+1 where id=$1",
      [template],
    );
    preview = await rpc("get_campaign_preview", {
      workspace_id: workspace,
      id: campaign,
    });
    assert.deepEqual(
      preview.validation.blockers.map((item) => item.code),
      ["template_archived", "missing_variables"],
    );
    assert.deepEqual(preview.recipients.sample, []);
  });

  await t.test("角色、工作区、状态及内部函数权限不能绕过", async () => {
    await assert.rejects(
      rpc(
        "get_campaign_preview",
        { workspace_id: workspace, id: campaign },
        viewer,
      ),
      /权限/,
    );
    await assert.rejects(
      rpc(
        "get_campaign_preview",
        { workspace_id: workspace, id: campaign },
        outsider,
      ),
      /权限/,
    );
    await assert.rejects(
      rpc(
        "get_campaign_preview",
        { workspace_id: workspace, id: campaign },
        null,
        "anon",
      ),
      /permission/,
    );
    await assert.rejects(
      rpc(
        "get_campaign_preview",
        { workspace_id: workspace, id: campaign },
        outsider,
        "aigc_api",
      ),
      /permission/,
    );
    await assert.rejects(
      asUser(
        db,
        admin,
        "select edm_private.render_campaign_text('x','','x@example.test','{}'::jsonb)",
      ),
      /permission/,
    );

    await db.query(
      "update edm.templates set archived_at=null,body='正文',version=version+1 where id=$1",
      [template],
    );
    await db.query("update edm.campaigns set archived_at=now() where id=$1", [
      campaign,
    ]);
    await assert.rejects(
      rpc("get_campaign_preview", { workspace_id: workspace, id: campaign }),
      /已归档/,
    );
    await db.query(
      "update edm.campaigns set archived_at=null,status='queued' where id=$1",
      [campaign],
    );
    await assert.rejects(
      rpc("get_campaign_preview", { workspace_id: workspace, id: campaign }),
      /只有草稿/,
    );
  });

  await t.test("预览不会写入快照、持久化人数或业务日志", async () => {
    const tables = (
      await db.query(
        `select table_name from information_schema.tables
         where table_schema='edm'
           and (table_name like 'campaign_recipient%' or table_name like 'campaign_snapshot%')`,
      )
    ).rows;
    assert.deepEqual(tables.map((item) => item.table_name).sort(), [
      "campaign_recipient_snapshots",
      "campaign_snapshots",
    ]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.campaign_snapshots where workspace_id=$1",
          [workspace],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.activity_logs where workspace_id=$1 and action like 'campaign.preview%'",
          [workspace],
        )
      ).rows[0].n,
      0,
    );
    const columns = (
      await db.query(
        `select column_name from information_schema.columns
         where table_schema='edm' and table_name='campaigns'
           and column_name in ('recipient_count','previewed_at')`,
      )
    ).rows;
    assert.deepEqual(columns, []);
  });
});
