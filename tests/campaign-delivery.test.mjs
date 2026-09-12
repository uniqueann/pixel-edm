import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

const admin = "71000000-0000-0000-0000-000000000001";
const editor = "71000000-0000-0000-0000-000000000002";
const channelId = "72000000-0000-0000-0000-000000000001";

function rpc(name, payload) {
  const encoded = JSON.stringify(payload).replaceAll("'", "''");
  return `select edm.${name}('${encoded}'::jsonb) as result`;
}

async function asServiceRole(db, sql) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    return tx.query(sql);
  });
}

test("P4-3 正式发送队列、重试、暂停与未知结果核对", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  await db.exec(`insert into auth.users values('${admin}'),('${editor}')`);
  const workspace = (
    await asUser(db, admin, "select edm.initialize_member() id")
  ).rows[0].id;
  await asUser(db, editor, "select edm.initialize_member()");
  await db.query(
    "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'editor')",
    [workspace, editor],
  );
  await asUser(
    db,
    admin,
    rpc("save_delivery_channel", {
      workspace_id: workspace,
      id: channelId,
      region: "cn-hangzhou",
      sender_domain: "send.example.test",
      sender_address: "edm@send.example.test",
      sender_alias: "测试邮局",
      reply_to_address: "",
      credential: {
        key_id: "test-v1",
        nonce: Buffer.alloc(12, 1).toString("base64"),
        ciphertext: Buffer.alloc(32, 1).toString("base64"),
        credential_version: 1,
        access_key_hint: "1234",
      },
    }),
  );
  await db.query(
    "update edm.delivery_channels set status='verified',last_verified_at=now() where id=$1",
    [channelId],
  );

  const template = (
    await db.query(
      "select id from edm.templates where workspace_id=$1 and archived_at is null order by id limit 1",
      [workspace],
    )
  ).rows[0].id;
  for (const [email, name] of [
    ["one@example.test", "客户一"],
    ["two@example.test", "客户二"],
  ]) {
    await db.query(
      `insert into edm.contacts(workspace_id,email,name,subscription_status,created_by)
       values($1,$2,$3,'subscribed',$4)`,
      [workspace, email, name, admin],
    );
  }
  const campaign = (
    await asUser(
      db,
      admin,
      rpc("save_campaign", {
        workspace_id: workspace,
        name: "P4-3 正式发送验收",
        template_id: template,
        audience_type: "all",
        variables: {
          store_name: "测试店铺",
          sender_name: "测试发件人",
          discount: "八折",
          product: "测试商品",
          order_number: "ORDER-001",
        },
      }),
    )
  ).rows[0].result;
  const preview = (
    await asUser(
      db,
      admin,
      rpc("get_campaign_preview", { workspace_id: workspace, id: campaign }),
    )
  ).rows[0].result;
  const confirmation = (
    await asUser(
      db,
      admin,
      rpc("confirm_campaign", {
        workspace_id: workspace,
        id: campaign,
        expected_campaign_version: preview.campaign.version,
        expected_template_version: preview.template.version,
      }),
    )
  ).rows[0].result;

  const idempotencyKey = "73000000-0000-0000-0000-000000000001";
  let runId;
  await t.test("仅管理员可创建任务，且幂等键不会重复入队", async () => {
    const payload = {
      workspace_id: workspace,
      campaign_id: campaign,
      expected_version: confirmation.campaign_version,
      idempotency_key: idempotencyKey,
      confirmation_name: "P4-3 正式发送验收",
    };
    await assert.rejects(
      asUser(db, editor, rpc("start_campaign_delivery", payload)),
      /只有管理员/,
    );
    const first = (
      await asUser(db, admin, rpc("start_campaign_delivery", payload))
    ).rows[0].result;
    const repeated = (
      await asUser(db, admin, rpc("start_campaign_delivery", payload))
    ).rows[0].result;
    runId = first.run_id;
    assert.equal(first.reused, false);
    assert.equal(repeated.reused, true);
    assert.equal(repeated.run_id, runId);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.campaign_delivery_tasks where run_id=$1",
          [runId],
        )
      ).rows[0].n,
      2,
    );
    await assert.rejects(
      db.query(
        "update edm.delivery_channels set sender_alias='非法换名' where id=$1",
        [channelId],
      ),
      /不能更换发件身份/,
    );
  });

  let firstClaim;
  await t.test("临时错误按计划进入重试，领取接口不向普通成员开放", async () => {
    await assert.rejects(
      asUser(db, admin, rpc("worker_claim_delivery_batch", { limit: 1 })),
      /permission denied/,
    );
    firstClaim = (
      await asServiceRole(db, rpc("worker_claim_delivery_batch", { limit: 1 }))
    ).rows[0].result[0];
    assert.ok(
      ["one@example.test", "two@example.test"].includes(
        firstClaim.recipient_email,
      ),
    );
    const completed = (
      await asServiceRole(
        db,
        rpc("worker_complete_delivery_task", {
          task_id: firstClaim.task_id,
          attempt_id: firstClaim.attempt_id,
          lease_token: firstClaim.lease_token,
          status: "failed",
          error_category: "temporary",
          error_code: "HTTP_503",
        }),
      )
    ).rows[0].result;
    assert.equal(completed.task_status, "pending");
    const task = (
      await db.query(
        "select status,attempt_count,next_attempt_at>now() delayed from edm.campaign_delivery_tasks where id=$1",
        [firstClaim.task_id],
      )
    ).rows[0];
    assert.equal(task.status, "pending");
    assert.equal(task.attempt_count, 1);
    assert.equal(task.delayed, true);
  });

  await t.test("可暂停继续，未知结果不自动重试并支持人工核对", async () => {
    let run = (
      await db.query(
        "select version from edm.campaign_delivery_runs where id=$1",
        [runId],
      )
    ).rows[0];
    await asUser(
      db,
      admin,
      rpc("set_campaign_delivery_paused", {
        workspace_id: workspace,
        run_id: runId,
        expected_version: run.version,
        paused: true,
      }),
    );
    assert.equal(
      (
        await db.query("select status from edm.campaigns where id=$1", [
          campaign,
        ])
      ).rows[0].status,
      "paused",
    );
    run = (
      await db.query(
        "select version from edm.campaign_delivery_runs where id=$1",
        [runId],
      )
    ).rows[0];
    await asUser(
      db,
      admin,
      rpc("set_campaign_delivery_paused", {
        workspace_id: workspace,
        run_id: runId,
        expected_version: run.version,
        paused: false,
      }),
    );

    const secondClaim = (
      await asServiceRole(db, rpc("worker_claim_delivery_batch", { limit: 1 }))
    ).rows[0].result[0];
    await asServiceRole(
      db,
      rpc("worker_complete_delivery_task", {
        task_id: secondClaim.task_id,
        attempt_id: secondClaim.attempt_id,
        lease_token: secondClaim.lease_token,
        status: "unknown",
        error_category: "unknown",
        error_code: "NETWORK_BOUNDARY",
      }),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.campaign_delivery_tasks where run_id=$1 and status='unknown'",
          [runId],
        )
      ).rows[0].n,
      1,
    );
    await asUser(
      db,
      admin,
      rpc("resolve_delivery_unknown", {
        workspace_id: workspace,
        task_id: secondClaim.task_id,
        resolution: "accepted",
        note: "已在供应商后台核对，确认该邮件请求已受理。",
      }),
    );
    assert.equal(
      (
        await db.query(
          "select status from edm.campaign_delivery_tasks where id=$1",
          [secondClaim.task_id],
        )
      ).rows[0].status,
      "accepted",
    );
  });

  await t.test(
    "暂停期间任务全部结束后，继续操作会立即收敛最终状态",
    async () => {
      let run = (
        await db.query(
          "select version from edm.campaign_delivery_runs where id=$1",
          [runId],
        )
      ).rows[0];
      await asUser(
        db,
        admin,
        rpc("set_campaign_delivery_paused", {
          workspace_id: workspace,
          run_id: runId,
          expected_version: run.version,
          paused: true,
        }),
      );
      await db.query(
        `update edm.campaign_delivery_tasks set status='failed',completed_at=now()
       where run_id=$1 and status='pending'`,
        [runId],
      );
      run = (
        await db.query(
          "select version from edm.campaign_delivery_runs where id=$1",
          [runId],
        )
      ).rows[0];
      await asUser(
        db,
        admin,
        rpc("set_campaign_delivery_paused", {
          workspace_id: workspace,
          run_id: runId,
          expected_version: run.version,
          paused: false,
        }),
      );
      assert.equal(
        (
          await db.query(
            "select status from edm.campaign_delivery_runs where id=$1",
            [runId],
          )
        ).rows[0].status,
        "completed_with_errors",
      );
      const exported = (
        await asUser(
          db,
          editor,
          rpc("get_campaign_export_chunk", {
            workspace_id: workspace,
            id: campaign,
            export_id: "73000000-0000-0000-0000-000000000099",
          }),
        )
      ).rows[0].result;
      assert.equal(exported.recipient_count, 2);
      const duplicate = (
        await asUser(
          db,
          editor,
          rpc("duplicate_confirmed_campaign", {
            workspace_id: workspace,
            id: campaign,
          }),
        )
      ).rows[0].result;
      assert.ok(duplicate);
    },
  );

  await t.test("管理员可在暂停后放弃全部剩余待发任务", async () => {
    const secondCampaign = (
      await asUser(
        db,
        admin,
        rpc("save_campaign", {
          workspace_id: workspace,
          name: "P4-3 放弃任务验收",
          template_id: template,
          audience_type: "all",
          variables: {
            store_name: "测试店铺",
            sender_name: "测试发件人",
            discount: "八折",
            product: "测试商品",
            order_number: "ORDER-002",
          },
        }),
      )
    ).rows[0].result;
    const secondPreview = (
      await asUser(
        db,
        admin,
        rpc("get_campaign_preview", {
          workspace_id: workspace,
          id: secondCampaign,
        }),
      )
    ).rows[0].result;
    const secondConfirmation = (
      await asUser(
        db,
        admin,
        rpc("confirm_campaign", {
          workspace_id: workspace,
          id: secondCampaign,
          expected_campaign_version: secondPreview.campaign.version,
          expected_template_version: secondPreview.template.version,
        }),
      )
    ).rows[0].result;
    const secondRun = (
      await asUser(
        db,
        admin,
        rpc("start_campaign_delivery", {
          workspace_id: workspace,
          campaign_id: secondCampaign,
          expected_version: secondConfirmation.campaign_version,
          idempotency_key: "73000000-0000-0000-0000-000000000002",
          confirmation_name: "P4-3 放弃任务验收",
        }),
      )
    ).rows[0].result;
    let run = (
      await db.query(
        "select version from edm.campaign_delivery_runs where id=$1",
        [secondRun.run_id],
      )
    ).rows[0];
    await asUser(
      db,
      admin,
      rpc("set_campaign_delivery_paused", {
        workspace_id: workspace,
        run_id: secondRun.run_id,
        expected_version: run.version,
        paused: true,
      }),
    );
    run = (
      await db.query(
        "select version from edm.campaign_delivery_runs where id=$1",
        [secondRun.run_id],
      )
    ).rows[0];
    const aborted = (
      await asUser(
        db,
        admin,
        rpc("abort_campaign_delivery", {
          workspace_id: workspace,
          run_id: secondRun.run_id,
          expected_version: run.version,
          confirmation_name: "P4-3 放弃任务验收",
        }),
      )
    ).rows[0].result;
    assert.equal(aborted.skipped_count, 2);
    assert.equal(aborted.status, "completed_with_errors");
  });
});
