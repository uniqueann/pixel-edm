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

  await db.exec(`insert into auth.users(id) values('${admin}'),('${editor}')`);
  const workspace = (
    await asUser(db, admin, "select edm.initialize_member() id")
  ).rows[0].id;
  await db.query(
    "update edm.workspaces set mailing_address='上海市测试路 1 号' where id=$1",
    [workspace],
  );
  await db.query("update edm.workspaces set plan='pro' where id=$1", [
    workspace,
  ]);
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

  await t.test("P5-3 行为追踪仅管理员可配置并默认影响未来活动", async () => {
    await assert.rejects(
      asUser(
        db,
        editor,
        rpc("configure_delivery_tracking", {
          workspace_id: workspace,
          channel_id: channelId,
          expected_version: 1,
          tracking_enabled: true,
          tracking_tag_name: "pixel_edm_tracking",
        }),
      ),
      /只有管理员/,
    );
    const configured = (
      await asUser(
        db,
        admin,
        rpc("configure_delivery_tracking", {
          workspace_id: workspace,
          channel_id: channelId,
          expected_version: 1,
          tracking_enabled: true,
          tracking_tag_name: "pixel_edm_tracking",
        }),
      )
    ).rows[0].result;
    assert.equal(configured.tracking_enabled, true);
    assert.equal(configured.tracking_tag_name, "pixel_edm_tracking");
    assert.equal(configured.version, 2);
    await assert.rejects(
      asUser(
        db,
        admin,
        rpc("configure_delivery_tracking", {
          workspace_id: workspace,
          channel_id: channelId,
          expected_version: 1,
          tracking_enabled: true,
          tracking_tag_name: "pixel edm",
        }),
      ),
      /字母、数字和下划线/,
    );
  });

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
    await db.query("update edm.workspaces set mailing_address='' where id=$1", [
      workspace,
    ]);
    let missingAddressError;
    try {
      await asUser(db, admin, rpc("start_campaign_delivery", payload));
    } catch (error) {
      missingAddressError = error;
    }
    await db.query(
      "update edm.workspaces set mailing_address='上海市测试路 1 号' where id=$1",
      [workspace],
    );
    assert.match(String(missingAddressError), /发件人联系地址/);
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
    assert.equal(firstClaim.channel.tracking_enabled, true);
    assert.equal(firstClaim.channel.tracking_tag_name, "pixel_edm_tracking");
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

  await t.test("P5-1 回执幂等投影、抑制优先级与令牌轮换", async () => {
    const occurredAt = (minutes) =>
      new Date(Date.now() + minutes * 60_000).toISOString();
    const task = (
      await db.query(
        `select task.id,task.active_attempt_id,recipient.email
         from edm.campaign_delivery_tasks task
         join edm.campaign_recipient_snapshots recipient on recipient.id=task.recipient_snapshot_id
         where task.run_id=$1 and task.status='accepted' limit 1`,
        [runId],
      )
    ).rows[0];
    assert.ok(task);
    await db.query(
      `update edm.campaign_delivery_attempts
       set provider_env_id='env-p5-1',provider_message_id='message-p5-1'
       where id=$1`,
      [task.active_attempt_id],
    );
    await db.query(
      "update edm.campaign_delivery_tasks set provider_message_id='message-p5-1' where id=$1",
      [task.id],
    );

    const digestA = "a".repeat(64);
    const digestB = "b".repeat(64);
    const configured = (
      await asUser(
        db,
        admin,
        rpc("configure_delivery_webhook", {
          workspace_id: workspace,
          channel_id: channelId,
          token_digest: digestA,
          token_hint: "aaaa",
        }),
      )
    ).rows[0].result;
    assert.equal(configured.webhook.configured, true);
    await assert.rejects(
      asUser(
        db,
        editor,
        rpc("configure_delivery_webhook", {
          workspace_id: workspace,
          channel_id: channelId,
          expected_token_version: 1,
          token_digest: digestB,
          token_hint: "bbbb",
        }),
      ),
      /只有管理员/,
    );
    await assert.rejects(
      asUser(db, admin, "select * from edm.campaign_delivery_events"),
      /permission denied/,
    );
    await assert.rejects(
      asUser(
        db,
        admin,
        rpc("webhook_authorize_delivery_event", {
          channel_id: channelId,
          token_digest: digestA,
        }),
      ),
      /permission denied/,
    );

    const event = (id, eventType, occurredAt, extra = {}) => ({
      channel_id: channelId,
      token_digest: digestA,
      provider_event_id: id,
      provider_event_type: "dm:test",
      event_type: eventType,
      provider_env_id: "env-p5-1",
      provider_message_id: "message-p5-1",
      sender_address: "edm@send.example.test",
      recipient_email: task.email,
      occurred_at: occurredAt,
      payload_sha256: Buffer.from(id)
        .toString("hex")
        .padEnd(64, "0")
        .slice(0, 64),
      ...extra,
    });
    const delivered = event(
      "1-delivered",
      "delivery_succeeded",
      occurredAt(1),
      {
        provider_status: "0",
        // P8-2：SES 没有 EnvId，必须仅凭 MessageId 也能命中任务。
        provider_env_id: "",
      },
    );
    const first = (
      await asServiceRole(db, rpc("webhook_ingest_delivery_event", delivered))
    ).rows[0].result;
    const duplicate = (
      await asServiceRole(db, rpc("webhook_ingest_delivery_event", delivered))
    ).rows[0].result;
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    await assert.rejects(
      asServiceRole(
        db,
        rpc("webhook_ingest_delivery_event", {
          ...delivered,
          payload_sha256: "f".repeat(64),
        }),
      ),
      /WEBHOOK_EVENT_ID_CONFLICT/,
    );

    await asServiceRole(
      db,
      rpc(
        "webhook_ingest_delivery_event",
        event("2-bounce", "delivery_failed", occurredAt(2), {
          provider_status: "2",
          error_code: "554",
          failure_type: "SmtpNxBox",
        }),
      ),
    );
    await asServiceRole(
      db,
      rpc(
        "webhook_ingest_delivery_event",
        event("3-old-success", "delivery_succeeded", occurredAt(1.5), {
          provider_status: "0",
        }),
      ),
    );
    await asServiceRole(
      db,
      rpc(
        "webhook_ingest_delivery_event",
        event("4-unsubscribe", "provider_unsubscribed", occurredAt(3)),
      ),
    );
    const resubscribe = (
      await asServiceRole(
        db,
        rpc(
          "webhook_ingest_delivery_event",
          event("5-resubscribe", "provider_resubscribed", occurredAt(4)),
        ),
      )
    ).rows[0].result;
    assert.equal(resubscribe.status, "ignored");
    await asServiceRole(
      db,
      rpc(
        "webhook_ingest_delivery_event",
        event("6-open", "opened", occurredAt(5)),
      ),
    );
    await asServiceRole(
      db,
      rpc(
        "webhook_ingest_delivery_event",
        event("7-click", "clicked", occurredAt(6)),
      ),
    );
    await asServiceRole(
      db,
      rpc(
        "webhook_ingest_delivery_event",
        event("8-fbl", "fbl_complaint", occurredAt(7)),
      ),
    );

    const projected = (
      await db.query(
        `select delivery_status,feedback_status,first_opened_at is not null opened,
          first_clicked_at is not null clicked,provider_message_id
         from edm.campaign_delivery_tasks where id=$1`,
        [task.id],
      )
    ).rows[0];
    assert.deepEqual(projected, {
      delivery_status: "hard_bounced",
      feedback_status: "complained",
      opened: true,
      clicked: true,
      provider_message_id: "message-p5-1",
    });
    const contact = (
      await db.query(
        "select subscription_status from edm.contacts where email=$1",
        [task.email],
      )
    ).rows[0];
    assert.equal(contact.subscription_status, "complained");

    const unmatched = (
      await asServiceRole(
        db,
        rpc(
          "webhook_ingest_delivery_event",
          event(
            "9-unmatched-unsubscribe",
            "provider_unsubscribed",
            occurredAt(8),
            {
              provider_env_id: "env-not-found",
              provider_message_id: "",
              recipient_email: "unmatched@example.test",
            },
          ),
        ),
      )
    ).rows[0].result;
    assert.equal(unmatched.status, "pending");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from edm.suppressions where workspace_id=$1 and email='unmatched@example.test'",
          [workspace],
        )
      ).rows[0].n,
      1,
    );
    await db.query(
      `update edm.campaign_delivery_events set received_at=now()-interval '31 days',next_match_at=now()
       where id=$1`,
      [unmatched.event_id],
    );
    await asServiceRole(
      db,
      rpc("worker_reconcile_delivery_events", { limit: 100 }),
    );
    assert.equal(
      (
        await db.query(
          "select processing_status from edm.campaign_delivery_events where id=$1",
          [unmatched.event_id],
        )
      ).rows[0].processing_status,
      "unmatched",
    );
    await db.query(
      "update edm.campaign_delivery_events set received_at=now()-interval '181 days' where id=$1",
      [unmatched.event_id],
    );
    const cleanup = (
      await asServiceRole(db, rpc("worker_cleanup_delivery_events", {}))
    ).rows[0].result;
    assert.equal(cleanup.deleted, 1);

    await asUser(
      db,
      admin,
      rpc("configure_delivery_webhook", {
        workspace_id: workspace,
        channel_id: channelId,
        expected_token_version: 1,
        token_digest: digestB,
        token_hint: "bbbb",
      }),
    );
    assert.ok(
      (
        await asServiceRole(
          db,
          rpc("webhook_authorize_delivery_event", {
            channel_id: channelId,
            token_digest: digestA,
          }),
        )
      ).rows[0].result,
    );
    await asUser(
      db,
      admin,
      rpc("revoke_delivery_webhook", {
        workspace_id: workspace,
        channel_id: channelId,
        expected_token_version: 2,
      }),
    );
    assert.equal(
      (
        await asServiceRole(
          db,
          rpc("webhook_authorize_delivery_event", {
            channel_id: channelId,
            token_digest: digestB,
          }),
        )
      ).rows[0].result,
      null,
    );
  });

  await t.test("P5-3 聚合统计去重、结果筛选与成员只读权限", async () => {
    const statistics = (
      await asUser(
        db,
        editor,
        rpc("get_campaign_delivery_statistics", {
          workspace_id: workspace,
          run_id: runId,
        }),
      )
    ).rows[0].result;
    assert.equal(statistics.tracking_enabled, true);
    assert.equal(statistics.tracking_tag_name, "pixel_edm_tracking");
    assert.equal(statistics.counts.recipients, 2);
    assert.equal(statistics.counts.hard_bounced, 1);
    assert.equal(statistics.counts.complained, 1);
    assert.equal(statistics.counts.opened, 1);
    assert.equal(statistics.counts.clicked, 1);

    const filtered = (
      await asUser(
        db,
        admin,
        rpc("list_campaign_delivery_tasks", {
          workspace_id: workspace,
          run_id: runId,
          result_filter: "clicked",
        }),
      )
    ).rows[0].result;
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].first_clicked_at !== null, true);
    await assert.rejects(
      asUser(
        db,
        editor,
        rpc("list_campaign_delivery_tasks", {
          workspace_id: workspace,
          run_id: runId,
          result_filter: "clicked",
        }),
      ),
      /只有管理员/,
    );

    const workspaceStatistics = (
      await asUser(
        db,
        editor,
        rpc("get_workspace_campaign_statistics", {
          workspace_id: workspace,
        }),
      )
    ).rows[0].result;
    assert.equal(workspaceStatistics.window_days, 30);
    assert.equal(workspaceStatistics.tracked_campaigns, 2);
    assert.equal(workspaceStatistics.opened, 1);
    assert.equal(workspaceStatistics.clicked, 1);
  });

  await t.test("P8-2 发送完成显式保存 SES MessageId 到尝试与任务", async () => {
    await assert.rejects(
      db.transaction(async (tx) => {
        const task = (
          await tx.query(
            `select task.id,task.workspace_id,task.run_id,run.credential_version
             from edm.campaign_delivery_tasks task
             join edm.campaign_delivery_runs run on run.id=task.run_id
             where task.run_id=$1 and task.status='accepted'
             limit 1`,
            [runId],
          )
        ).rows[0];
        const attemptId = "74000000-0000-0000-0000-000000000001";
        const leaseToken = "74000000-0000-0000-0000-000000000002";
        await tx.query(
          `insert into edm.campaign_delivery_attempts(
             id,workspace_id,run_id,task_id,attempt_number,credential_version
           ) values($1,$2,$3,$4,4,$5)`,
          [
            attemptId,
            task.workspace_id,
            task.run_id,
            task.id,
            task.credential_version,
          ],
        );
        await tx.query(
          `update edm.campaign_delivery_tasks set
             status='processing',attempt_count=4,active_attempt_id=$2,
             lease_token=$3,lease_expires_at=now()+interval '90 seconds',
             provider_message_id=null
           where id=$1`,
          [task.id, attemptId, leaseToken],
        );
        await tx.exec("set local role service_role");
        const completed = (
          await tx.query(
            "select edm.worker_complete_delivery_task($1::jsonb) as result",
            [
              JSON.stringify({
                task_id: task.id,
                attempt_id: attemptId,
                lease_token: leaseToken,
                status: "accepted",
                provider_request_id: "aws-request-1",
                provider_message_id: "ses-message-1",
              }),
            ],
          )
        ).rows[0].result;
        assert.equal(completed.task_status, "accepted");
        await tx.exec("reset role");
        assert.deepEqual(
          (
            await tx.query(
              `select attempt.provider_env_id,attempt.provider_message_id,
                      task.provider_message_id as task_message_id
               from edm.campaign_delivery_attempts attempt
               join edm.campaign_delivery_tasks task on task.id=attempt.task_id
               where attempt.id=$1`,
              [attemptId],
            )
          ).rows[0],
          {
            provider_env_id: null,
            provider_message_id: "ses-message-1",
            task_message_id: "ses-message-1",
          },
        );
        throw new Error("ROLLBACK_P8_MESSAGE_ID_TEST");
      }),
      /ROLLBACK_P8_MESSAGE_ID_TEST/,
    );
  });
});
