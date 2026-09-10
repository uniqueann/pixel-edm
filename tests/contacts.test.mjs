import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";
test("客户事务、标签、搜索分页及授权", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const a = "20000000-0000-0000-0000-000000000001",
    b = "20000000-0000-0000-0000-000000000002";
  await db.exec(`insert into auth.users values('${a}'),('${b}')`);
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
});
