import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003";
test("EDM 迁移、用户初始化、工作区权限与 AIGC 隔离", async (t) => {
  const db = await createDatabase();
  try {
    await db.exec(
      `insert into auth.users values('${a}'),('${b}'),('${c}'); insert into aigc.members(user_id) values('${a}'),('${c}');`,
    );
    let wa, wb;
    await t.test(
      "旧 Auth 账号首次进入创建工作区，重复调用保持幂等",
      async () => {
        wa = (await asUser(db, a, "select edm.initialize_member() as id"))
          .rows[0].id;
        assert.equal(
          (await asUser(db, a, "select edm.initialize_member() as id")).rows[0]
            .id,
          wa,
        );
        wb = (await asUser(db, b, "select edm.initialize_member() as id"))
          .rows[0].id;
        assert.notEqual(wa, wb);
        assert.equal(
          (await db.query("select count(*)::int as n from edm.workspaces"))
            .rows[0].n,
          2,
        );
      },
    );
    await t.test("跨工作区和跨用户读取被过滤", async () => {
      assert.deepEqual(
        (await asUser(db, a, "select id from edm.workspaces")).rows,
        [{ id: wa }],
      );
      assert.equal(
        (await asUser(db, c, "select * from edm.workspaces")).rows.length,
        0,
      );
      assert.equal(
        (await asUser(db, a, `select * from edm.members where user_id='${b}'`))
          .rows.length,
        0,
      );
    });
    await t.test("管理员仅可修改名称和地址，不可自提权或伪造成员", async () => {
      assert.equal(
        (
          await asUser(
            db,
            a,
            `update edm.workspaces set name='我的店铺' where id='${wa}' returning name`,
          )
        ).rows[0].name,
        "我的店铺",
      );
      assert.equal(
        (
          await asUser(
            db,
            a,
            `update edm.workspaces set name='越权' where id='${wb}' returning id`,
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        asUser(db, a, "update edm.members set status='disabled'"),
        /permission denied/,
      );
      await assert.rejects(
        asUser(db, a, `update edm.workspaces set owner_id='${b}'`),
        /permission denied/,
      );
      await assert.rejects(
        asUser(
          db,
          a,
          `insert into edm.workspace_members values('${wb}','${a}','admin','active',now())`,
        ),
        /permission denied/,
      );
    });
    await t.test("查看者可以查看所在工作区，但无法编辑设置", async () => {
      await db.exec(
        `insert into edm.workspace_members(workspace_id,user_id,role) values('${wa}','${b}','viewer')`,
      );
      assert.equal(
        (await asUser(db, b, `select id from edm.workspaces where id='${wa}'`))
          .rows.length,
        1,
      );
      assert.equal(
        (
          await asUser(
            db,
            b,
            `update edm.workspaces set name='越权' where id='${wa}' returning id`,
          )
        ).rows.length,
        0,
      );
    });
    await t.test("不能移除或降级所有者管理员，失败事务回滚", async () => {
      await assert.rejects(
        db.exec(
          `delete from edm.workspace_members where workspace_id='${wa}' and user_id='${a}'`,
        ),
        /所有者/,
      );
      await assert.rejects(
        db.exec(
          `update edm.workspace_members set role='viewer' where workspace_id='${wa}' and user_id='${a}'`,
        ),
        /所有者/,
      );
      assert.equal(
        (
          await db.query(
            `select role from edm.workspace_members where workspace_id='${wa}' and user_id='${a}'`,
          )
        ).rows[0].role,
        "admin",
      );
    });
    await t.test("EDM 停用不能重新初始化，且不影响 AIGC 状态", async () => {
      await db.exec(
        `update edm.members set status='disabled' where user_id='${a}'`,
      );
      assert.equal(
        (await asUser(db, a, "select * from edm.workspaces")).rows.length,
        0,
      );
      await assert.rejects(
        asUser(db, a, "select edm.initialize_member()"),
        /停用/,
      );
      assert.equal(
        (await db.query(`select status from aigc.members where user_id='${a}'`))
          .rows[0].status,
        "active",
      );
    });
    await t.test(
      "匿名与 AIGC 专用角色不能访问 EDM，也没有反向授权",
      async () => {
        await assert.rejects(
          asUser(db, null, "select edm.initialize_member()", "anon"),
          /permission denied/,
        );
        await assert.rejects(
          asUser(db, c, "select * from edm.members", "aigc_api"),
          /permission denied/,
        );
        await assert.rejects(
          asUser(db, b, "select * from aigc.members"),
          /permission denied/,
        );
        await assert.rejects(
          asUser(db, null, "select edm.initialize_member()"),
          /需要登录/,
        );
      },
    );
    await t.test("应用类型升级不再次初始化个人工作区", async () => {
      await db.exec(`update edm.workspaces set type='team' where id='${wb}'`);
      assert.equal(
        (await asUser(db, b, "select edm.initialize_member() as id")).rows[0]
          .id,
        wb,
      );
    });
  } finally {
    await db.close();
  }
});
