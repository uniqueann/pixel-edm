import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";
test("客户事务、标签、搜索分页及授权", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "20000000-0000-0000-0000-000000000001",
    b = "20000000-0000-0000-0000-000000000002";
  await db.exec(`insert into auth.users(id) values('${a}'),('${b}')`);
  const wa = (await asUser(db, a, "select edm.initialize_member() id")).rows[0]
    .id;
  const wb = (await asUser(db, b, "select edm.initialize_member() id")).rows[0]
    .id;
  const rpc = async (fn, p, user = a) =>
    (
      await asUser(
        db,
        user,
        `select edm.${fn}('${JSON.stringify(p).replaceAll("'", "''")}'::jsonb) result`,
      )
    ).rows[0].result;
  const save = (p) =>
    rpc("save_contact", {
      workspace_id: wa,
      email: "test@example.com",
      name: "客户",
      tags: ["VIP", "vip"],
      ...p,
    });
  const id = await save({ email: " Test@Example.COM " });
  await t.test("邮箱规范化、标签去重和保存原子性", async () => {
    assert.equal(
      (await db.query("select email from edm.contacts where id=$1", [id]))
        .rows[0].email,
      "test@example.com",
    );
    assert.equal(
      (await db.query("select count(*)::int n from edm.tags")).rows[0].n,
      1,
    );
    await assert.rejects(save({}), /unique/);
    await assert.rejects(
      save({ email: "rollback@example.com", tags: ["有效", ""] }),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.contacts where email='rollback@example.com'",
        )
      ).rows[0].n,
      0,
    );
  });
  await t.test("归档保留邮箱及标签，冲突不覆盖", async () => {
    await rpc("archive_contact", {
      workspace_id: wa,
      id,
      expected_version: 1,
      archived: true,
    });
    await assert.rejects(save({}), /unique/);
    await assert.rejects(save({ id, expected_version: 2 }), /恢复/);
    await rpc("archive_contact", {
      workspace_id: wa,
      id,
      expected_version: 2,
      archived: false,
    });
    await assert.rejects(save({ id, expected_version: 1 }), /已被修改/);
    const list = await rpc("list_contacts", { workspace_id: wa });
    assert.equal(list.items[0].tags[0].name, "VIP");
  });
  await t.test("只读、跨工作区、直接写入与关联越权被拒绝", async () => {
    await assert.rejects(
      rpc(
        "save_contact",
        { workspace_id: wa, email: "bad@example.com", tags: [] },
        b,
      ),
      /权限/,
    );
    await db.exec(
      `insert into edm.workspace_members values('${wa}','${b}','viewer','active',now())`,
    );
    assert.equal(
      (await rpc("list_contacts", { workspace_id: wa }, b)).total,
      1,
    );
    await assert.rejects(
      rpc(
        "save_contact",
        { workspace_id: wa, email: "bad@example.com", tags: [] },
        b,
      ),
      /权限/,
    );
    await assert.rejects(
      asUser(db, a, "update edm.contacts set version=99"),
      /permission/,
    );
    const other = await rpc(
      "save_contact",
      { workspace_id: wb, email: "test@example.com", tags: [] },
      b,
    );
    const tag = (await db.query("select id from edm.tags limit 1")).rows[0].id;
    await assert.rejects(
      db.query("insert into edm.contact_tags values($1,$2,$3)", [
        wa,
        other,
        tag,
      ]),
      /foreign key/,
    );
    await db.query("update edm.workspaces set plan='team' where id=$1", [wa]);
    await db.exec(
      `update edm.workspace_members set role='editor' where workspace_id='${wa}' and user_id='${b}'`,
    );
    await rpc(
      "save_contact",
      { workspace_id: wa, email: "editor@example.com", tags: [] },
      b,
    );
    await db.exec(
      `update edm.members set status='disabled' where user_id='${b}'`,
    );
    await assert.rejects(
      rpc("list_contacts", { workspace_id: wa }, b),
      /不可访问/,
    );
  });
  await t.test("分页、字面搜索和无结果", async () => {
    for (let i = 0; i < 23; i++)
      await save({
        email: `page${i}@example.com`,
        name: i === 0 ? "100%客户" : "分页",
        tags: [],
      });
    const page = await rpc("list_contacts", { workspace_id: wa, page: 99 });
    assert.equal(page.page, 2);
    assert.equal(page.items.length, 5);
    assert.equal(
      (await rpc("list_contacts", { workspace_id: wa, q: "%" })).total,
      1,
    );
    assert.equal(
      (await rpc("list_contacts", { workspace_id: wa, q: "不存在" })).total,
      0,
    );
    const tag = (await db.query("select id from edm.tags where name='VIP'"))
      .rows[0].id;
    assert.equal(
      (await rpc("list_contacts", { workspace_id: wa, tag_id: tag })).total,
      1,
    );
  });
  await t.test("手动声明同意：留痕、不覆盖证据、不越过抑制", async () => {
    const consent = {
      consent_declared: true,
      consent_source: "展会名片",
      consent_note: "客户现场书面同意接收促销邮件",
    };
    const status = async (cid) =>
      (
        await db.query(
          "select subscription_status s,consent_source,consent_note,consent_at,version from edm.contacts where id=$1",
          [cid],
        )
      ).rows[0];
    const events = async (cid) =>
      (
        await db.query(
          "select event_type,source,note,consent_at,metadata from edm.subscription_events where contact_id=$1 and event_type='consented'",
          [cid],
        )
      ).rows;

    const plain = await save({ email: "plain@example.com", tags: [] });
    assert.equal((await status(plain)).s, "unconfirmed");
    assert.equal((await events(plain)).length, 0);

    await assert.rejects(
      save({
        email: "no-evidence@example.com",
        tags: [],
        consent_declared: true,
        consent_source: "",
        consent_note: "",
      }),
      /同意来源/,
    );
    await assert.rejects(
      save({
        email: "future@example.com",
        tags: [],
        ...consent,
        consent_at: "2999-01-01T00:00:00Z",
      }),
      /不能晚于/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.contacts where email in ('no-evidence@example.com','future@example.com')",
        )
      ).rows[0].n,
      0,
    );

    const fresh = await save({
      email: "consented@example.com",
      tags: [],
      ...consent,
      consent_at: "2026-01-02T03:04:05Z",
    });
    const row = await status(fresh);
    assert.equal(row.s, "subscribed");
    assert.equal(row.consent_source, "展会名片");
    assert.equal(row.version, 1);
    assert.equal(
      new Date(row.consent_at).toISOString(),
      "2026-01-02T03:04:05.000Z",
    );
    const [event] = await events(fresh);
    assert.equal(event.source, "展会名片");
    assert.equal(event.note, "客户现场书面同意接收促销邮件");
    assert.equal(event.metadata.channel, "manual_form");

    await save({
      id: plain,
      expected_version: 1,
      email: "plain@example.com",
      tags: [],
      ...consent,
    });
    const upgraded = await status(plain);
    assert.equal(upgraded.s, "subscribed");
    assert.equal(upgraded.version, 2);
    assert.equal((await events(plain)).length, 1);

    await save({
      id: plain,
      expected_version: 2,
      email: "plain@example.com",
      tags: [],
      consent_declared: true,
      consent_source: "另一来源",
      consent_note: "不应覆盖",
    });
    assert.equal((await status(plain)).consent_source, "展会名片");
    assert.equal((await events(plain)).length, 1);

    const blocked = await save({ email: "blocked@example.com", tags: [] });
    await rpc("unsubscribe_contact", {
      workspace_id: wa,
      id: blocked,
      expected_version: 1,
      reason: "客户要求退订",
    });
    await assert.rejects(
      save({
        id: blocked,
        expected_version: 2,
        email: "blocked@example.com",
        tags: [],
        ...consent,
      }),
      /不能标记为已获得同意/,
    );
    assert.equal((await status(blocked)).s, "unsubscribed");
    await assert.rejects(
      save({ email: "blocked@example.com", tags: [], ...consent }),
      /unique/,
    );

    const untouched = await db.query(
      "select count(*)::int n from edm.contacts where email like 'page%' and subscription_status<>'unconfirmed'",
    );
    assert.equal(untouched.rows[0].n, 0);
  });
});
