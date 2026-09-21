import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

test("P6 团队邀请、成员生命周期、角色权限与 AIGC 隔离", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const owner = "60000000-0000-0000-0000-000000000001";
  const invited = "60000000-0000-0000-0000-000000000002";
  const removed = "60000000-0000-0000-0000-000000000003";
  const revoked = "60000000-0000-0000-0000-000000000004";
  const expired = "60000000-0000-0000-0000-000000000005";
  const resent = "60000000-0000-0000-0000-000000000006";
  const outsider = "60000000-0000-0000-0000-000000000007";
  const disabled = "60000000-0000-0000-0000-000000000008";
  const unverified = "60000000-0000-0000-0000-000000000009";
  await db.exec(`
    insert into auth.users(id,email,email_confirmed_at) values
      ('${owner}','owner@team.test',now()),
      ('${invited}','invited@team.test',now()),
      ('${removed}','removed@team.test',now()),
      ('${revoked}','revoked@team.test',now()),
      ('${expired}','expired@team.test',now()),
      ('${resent}','resent@team.test',now()),
      ('${outsider}','outsider@other.test',now()),
      ('${disabled}','disabled@team.test',now()),
      ('${unverified}','unverified@team.test',null);
    insert into aigc.members(user_id) values('${owner}');
  `);
  const workspace = (
    await asUser(db, owner, "select edm.initialize_member() id")
  ).rows[0].id;
  const otherWorkspace = (
    await asUser(db, outsider, "select edm.initialize_member() id")
  ).rows[0].id;
  // P12：免费版仅 1 名成员；本套件覆盖多成员生命周期，使用 Team 档席位。
  await db.query(
    "update edm.workspaces set plan='team' where id = any($1::uuid[])",
    [[workspace, otherWorkspace]],
  );

  const hash = (character) => character.repeat(64);
  const rpc = async (name, payload, user = owner, role = "authenticated") =>
    (
      await asUser(
        db,
        user,
        `select edm.${name}('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb) result`,
        role,
      )
    ).rows[0].result;

  let invitedId;
  await t.test("首个有效邀请转换团队并保留单一 pending", async () => {
    await assert.rejects(
      rpc(
        "create_workspace_invitation",
        {
          workspace_id: otherWorkspace,
          email: "not-an-email",
          role: "viewer",
          token_hash: hash("8"),
          token_hint: "8123",
        },
        outsider,
      ),
      /邮箱格式无效/,
    );
    assert.equal(
      (
        await db.query("select type from edm.workspaces where id=$1", [
          otherWorkspace,
        ])
      ).rows[0].type,
      "personal",
    );
    const result = await rpc("create_workspace_invitation", {
      workspace_id: workspace,
      email: " Invited@Team.Test ",
      role: "editor",
      token_hash: hash("a"),
      token_hint: "a123",
    });
    invitedId = result.id;
    assert.equal(result.status, "pending");
    assert.equal(
      (
        await db.query("select type from edm.workspaces where id=$1", [
          workspace,
        ])
      ).rows[0].type,
      "team",
    );
    await assert.rejects(
      rpc("create_workspace_invitation", {
        workspace_id: workspace,
        email: "invited@team.test",
        role: "viewer",
        token_hash: hash("b"),
        token_hint: "b123",
      }),
      /待处理邀请/,
    );
    const preview = await rpc("get_workspace_invitation_preview", {
      token_hash: hash("a"),
    });
    assert.equal(preview.email_hint, "i***@team.test");
    assert.equal("token_hash" in preview, false);
  });

  await t.test(
    "接受要求已验证邮箱，不创建个人工作区且重复消费幂等失败",
    async () => {
      await assert.rejects(
        rpc("accept_workspace_invitation", { token_hash: hash("a") }, outsider),
        /邀请无法接受/,
      );
      const accepted = await rpc(
        "accept_workspace_invitation",
        { token_hash: hash("a") },
        invited,
      );
      assert.equal(accepted.workspace_id, workspace);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from edm.workspaces where bootstrap_owner_id=$1",
            [invited],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select role,status from edm.workspace_members where workspace_id=$1 and user_id=$2",
            [workspace, invited],
          )
        ).rows[0].role,
        "editor",
      );
      await assert.rejects(
        rpc("accept_workspace_invitation", { token_hash: hash("a") }, invited),
        /邀请无法接受/,
      );
      await assert.rejects(
        rpc("create_workspace_invitation", {
          workspace_id: workspace,
          email: "invited@team.test",
          role: "viewer",
          token_hash: hash("c"),
          token_hint: "c123",
        }),
        /已是工作区成员/,
      );

      await db.exec(
        `insert into edm.members(user_id,status) values('${disabled}','disabled')`,
      );
      const disabledInvite = await rpc("create_workspace_invitation", {
        workspace_id: workspace,
        email: "disabled@team.test",
        role: "viewer",
        token_hash: hash("9"),
        token_hint: "9123",
      });
      await assert.rejects(
        rpc("accept_workspace_invitation", { token_hash: hash("9") }, disabled),
        /邀请无法接受/,
      );
      assert.equal(
        (
          await db.query(
            "select status from edm.workspace_invitations where id=$1",
            [disabledInvite.id],
          )
        ).rows[0].status,
        "pending",
      );
      const unverifiedInvite = await rpc("create_workspace_invitation", {
        workspace_id: workspace,
        email: "unverified@team.test",
        role: "viewer",
        token_hash: hash("0"),
        token_hint: "0123",
      });
      await assert.rejects(
        rpc(
          "accept_workspace_invitation",
          { token_hash: hash("0") },
          unverified,
        ),
        /邀请无法接受/,
      );
      await rpc(
        "revoke_workspace_invitation",
        { workspace_id: workspace, id: disabledInvite.id },
        owner,
      );
      await rpc(
        "revoke_workspace_invitation",
        { workspace_id: workspace, id: unverifiedInvite.id },
        owner,
      );
    },
  );

  await t.test("重发令牌只保留一个 pending，旧令牌立即失效", async () => {
    const first = await rpc("create_workspace_invitation", {
      workspace_id: workspace,
      email: "resent@team.test",
      role: "viewer",
      token_hash: hash("d"),
      token_hint: "d123",
    });
    const resentResult = await rpc("resend_workspace_invitation", {
      workspace_id: workspace,
      id: first.id,
      token_hash: hash("e"),
      token_hint: "e123",
    });
    assert.equal(resentResult.id, first.id);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.workspace_invitations where workspace_id=$1 and email_normalized='resent@team.test' and status='pending'",
          [workspace],
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      rpc("accept_workspace_invitation", { token_hash: hash("d") }, resent),
      /邀请无法接受/,
    );
    await rpc("accept_workspace_invitation", { token_hash: hash("e") }, resent);
  });

  await t.test("撤销、过期与跨工作区访问均不可接受", async () => {
    const revokedInvite = await rpc("create_workspace_invitation", {
      workspace_id: workspace,
      email: "revoked@team.test",
      role: "viewer",
      token_hash: hash("f"),
      token_hint: "f123",
    });
    await rpc("revoke_workspace_invitation", {
      workspace_id: workspace,
      id: revokedInvite.id,
    });
    await assert.rejects(
      rpc("accept_workspace_invitation", { token_hash: hash("f") }, revoked),
      /邀请无法接受/,
    );
    const expiredInvite = await rpc("create_workspace_invitation", {
      workspace_id: workspace,
      email: "expired@team.test",
      role: "viewer",
      token_hash: hash("1"),
      token_hint: "1123",
    });
    await db.query(
      "update edm.workspace_invitations set expires_at=now()-interval '1 minute' where id=$1",
      [expiredInvite.id],
    );
    const team = await rpc("list_workspace_team", { workspace_id: workspace });
    assert.equal(
      team.invitations.some((item) => item.id === expiredInvite.id),
      false,
    );
    assert.equal(
      (
        await db.query(
          "select status from edm.workspace_invitations where id=$1",
          [expiredInvite.id],
        )
      ).rows[0].status,
      "expired",
    );
    await assert.rejects(
      rpc(
        "resend_workspace_invitation",
        {
          workspace_id: otherWorkspace,
          id: invitedId,
          token_hash: hash("2"),
          token_hint: "2123",
        },
        outsider,
      ),
      /邀请不存在或不可访问|只有管理员/,
    );
  });

  await t.test("移除保留历史，重新邀请恢复成员并使用新角色", async () => {
    const invite = await rpc("create_workspace_invitation", {
      workspace_id: workspace,
      email: "removed@team.test",
      role: "admin",
      token_hash: hash("3"),
      token_hint: "3123",
    });
    await rpc(
      "accept_workspace_invitation",
      { token_hash: hash("3") },
      removed,
    );
    const member = (
      await db.query(
        "select version from edm.workspace_members where workspace_id=$1 and user_id=$2",
        [workspace, removed],
      )
    ).rows[0];
    await rpc("remove_workspace_member", {
      workspace_id: workspace,
      user_id: removed,
      expected_version: member.version,
    });
    assert.equal(
      (
        await db.query(
          "select status,removed_at from edm.workspace_members where workspace_id=$1 and user_id=$2",
          [workspace, removed],
        )
      ).rows[0].status,
      "removed",
    );
    await assert.rejects(
      rpc("list_workspace_team", { workspace_id: workspace }, removed),
      /不可访问/,
    );
    const reInvite = await rpc("create_workspace_invitation", {
      workspace_id: workspace,
      email: "removed@team.test",
      role: "viewer",
      token_hash: hash("4"),
      token_hint: "4123",
    });
    assert.notEqual(reInvite.id, invite.id);
    await rpc(
      "accept_workspace_invitation",
      { token_hash: hash("4") },
      removed,
    );
    assert.deepEqual(
      (
        await db.query(
          "select role,status,removed_at from edm.workspace_members where workspace_id=$1 and user_id=$2",
          [workspace, removed],
        )
      ).rows[0],
      { role: "viewer", status: "active", removed_at: null },
    );
  });

  await t.test("角色变更、owner 转移、查看者权限和审计脱敏", async () => {
    const removedMember = (
      await db.query(
        "select version from edm.workspace_members where workspace_id=$1 and user_id=$2",
        [workspace, removed],
      )
    ).rows[0];
    await rpc("change_workspace_member_role", {
      workspace_id: workspace,
      user_id: removed,
      role: "editor",
      expected_version: removedMember.version,
    });
    await rpc("change_workspace_member_role", {
      workspace_id: workspace,
      user_id: invited,
      role: "admin",
      expected_version: 1,
    });
    const pendingBeforeTransfer = await rpc("create_workspace_invitation", {
      workspace_id: workspace,
      email: "revoked@team.test",
      role: "viewer",
      token_hash: hash("b"),
      token_hint: "b123",
    });
    await rpc("transfer_workspace_ownership", {
      workspace_id: workspace,
      new_owner_id: invited,
    });
    const owners = await db.query(
      "select owner_id from edm.workspaces where id=$1",
      [workspace],
    );
    assert.equal(owners.rows[0].owner_id, invited);
    assert.equal(
      (
        await db.query(
          "select role,status from edm.workspace_members where workspace_id=$1 and user_id=$2",
          [workspace, owner],
        )
      ).rows[0].role,
      "admin",
    );
    assert.equal(
      (
        await db.query(
          "select status from edm.workspace_invitations where id=$1",
          [pendingBeforeTransfer.id],
        )
      ).rows[0].status,
      "pending",
    );
    await assert.rejects(
      rpc(
        "change_workspace_member_role",
        {
          workspace_id: workspace,
          user_id: invited,
          role: "viewer",
          expected_version: 2,
        },
        invited,
      ),
      /所有者/,
    );
    const viewerMember = (
      await db.query(
        "select version from edm.workspace_members where workspace_id=$1 and user_id=$2",
        [workspace, removed],
      )
    ).rows[0];
    await rpc(
      "change_workspace_member_role",
      {
        workspace_id: workspace,
        user_id: removed,
        role: "viewer",
        expected_version: viewerMember.version,
      },
      invited,
    );
    await assert.rejects(
      rpc(
        "create_workspace_invitation",
        {
          workspace_id: workspace,
          email: "outsider@other.test",
          role: "viewer",
          token_hash: hash("5"),
          token_hint: "5123",
        },
        removed,
      ),
      /只有管理员|不可访问/,
    );
    const audit = (
      await db.query(
        "select action,metadata::text metadata,target_label from edm.activity_logs where workspace_id=$1",
        [workspace],
      )
    ).rows;
    assert.ok(audit.some((row) => row.action === "team.owner_transferred"));
    assert.ok(audit.every((row) => !row.metadata.includes(hash("a"))));
    assert.ok(
      audit.every((row) => !row.target_label.includes("invited@team.test")),
    );
  });

  await t.test("并发角色变更串行化且始终保留活动管理员", async () => {
    const concurrentOwner = outsider;
    const firstAdmin = revoked;
    const secondAdmin = expired;
    const concurrentWorkspace = otherWorkspace;

    for (const [user, email, token] of [
      [firstAdmin, "revoked@team.test", "6"],
      [secondAdmin, "expired@team.test", "7"],
    ]) {
      const invitation = await rpc(
        "create_workspace_invitation",
        {
          workspace_id: concurrentWorkspace,
          email,
          role: "admin",
          token_hash: hash(token),
          token_hint: `${token}123`,
        },
        concurrentOwner,
      );
      await rpc(
        "accept_workspace_invitation",
        { token_hash: hash(token) },
        user,
      );
      assert.equal(invitation.status, "pending");
    }

    const members = (
      await db.query(
        "select user_id,version from edm.workspace_members where workspace_id=$1 and user_id in ($2,$3)",
        [concurrentWorkspace, firstAdmin, secondAdmin],
      )
    ).rows;
    const attempts = members.map((member) =>
      rpc(
        "change_workspace_member_role",
        {
          workspace_id: concurrentWorkspace,
          user_id: member.user_id,
          role: "viewer",
          expected_version: member.version,
        },
        concurrentOwner,
      ),
    );
    const results = await Promise.all(attempts);
    assert.equal(results.length, 2);
    assert.deepEqual(
      (
        await db.query(
          "select count(*)::int as count from edm.workspace_members where workspace_id=$1 and status='active' and role='admin'",
          [concurrentWorkspace],
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await db.query("select owner_id from edm.workspaces where id=$1", [
          concurrentWorkspace,
        ])
      ).rows[0].owner_id,
      concurrentOwner,
    );
  });

  await t.test("EDM 团队变更不影响 AIGC", async () => {
    assert.equal(
      (
        await db.query("select status from aigc.members where user_id=$1", [
          owner,
        ])
      ).rows[0].status,
      "active",
    );
    await assert.rejects(
      asUser(db, outsider, "select * from edm.workspace_invitations"),
      /permission denied/,
    );
    await assert.rejects(
      asUser(
        db,
        outsider,
        "select edm.list_workspace_team('{}'::jsonb)",
        "aigc_api",
      ),
      /permission denied/,
    );
  });
});
