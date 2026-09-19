import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, asUser } from "./database-helper.mjs";

const admin = "24000000-0000-0000-0000-000000000001";
const viewer = "24000000-0000-0000-0000-000000000002";
const channelId = "25000000-0000-0000-0000-000000000001";
const secondChannelId = "25000000-0000-0000-0000-000000000002";

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

function credential(version, hint = "ABCD") {
  return {
    key_id: "test-v1",
    nonce: Buffer.alloc(12, version).toString("base64"),
    ciphertext: Buffer.alloc(32, version).toString("base64"),
    credential_version: version,
    access_key_hint: hint,
  };
}

function channelPayload(workspaceId, overrides = {}) {
  return {
    workspace_id: workspaceId,
    id: channelId,
    region: "ap-southeast-1",
    sender_domain: "send.contentup.cc",
    sender_address: "hello@send.contentup.cc",
    sender_alias: "测试邮局",
    reply_to_address: "reply@contentup.cc",
    credential: credential(1),
    ...overrides,
  };
}

test("P8-1 服务商注册表、provider_config 校验与归一化退信分级", async (t) => {
  const db = await createDatabase();
  try {
    await db.exec(
      `insert into auth.users(id) values('${admin}'),('${viewer}');`,
    );
    const workspace = (
      await asUser(db, admin, "select edm.initialize_member() as id")
    ).rows[0].id;
    await asUser(db, viewer, "select edm.initialize_member() as id");
    await db.query(
      "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",
      [workspace, viewer],
    );

    await t.test("注册表登记两家厂商且未开放的厂商不能配置", async () => {
      const providers = (
        await asUser(
          db,
          admin,
          "select edm.list_delivery_providers() as result",
        )
      ).rows[0].result;
      const byId = Object.fromEntries(
        providers.map((row) => [row.provider, row]),
      );
      assert.deepEqual(Object.keys(byId).sort(), [
        "aliyun_directmail",
        "amazon_ses",
      ]);
      assert.equal(byId.aliyun_directmail.enabled, true);
      assert.equal(byId.aliyun_directmail.sender_alias_max_length, 14);
      assert.equal(byId.aliyun_directmail.default_rate_per_second, 5);
      assert.equal(byId.aliyun_directmail.default_daily_quota, 2000);
      assert.equal(byId.aliyun_directmail.quota_timezone, "Asia/Shanghai");
      assert.equal(byId.amazon_ses.enabled, false);
      assert.equal(byId.amazon_ses.requires_sender_domain, false);
      assert.equal(
        byId.amazon_ses.requires_webhook_subscription_confirmation,
        true,
      );

      await assert.rejects(
        asUser(
          db,
          admin,
          rpc(
            "save_delivery_channel",
            channelPayload(workspace, {
              provider: "amazon_ses",
              region: "us-east-1",
            }),
          ),
        ),
        /暂未开放/,
      );
      await assert.rejects(
        asUser(
          db,
          admin,
          rpc(
            "save_delivery_channel",
            channelPayload(workspace, { provider: "sendgrid" }),
          ),
        ),
        /不支持的发信服务商/,
      );
      await assert.rejects(
        asUser(db, admin, "select * from edm.delivery_providers"),
        /permission denied/,
      );
    });

    await t.test("provider_config 按厂商校验形状", async () => {
      const normalized = (
        await db.query(
          `select edm_private.delivery_provider_config(
             'aliyun_directmail',
             '{"region":" ap-southeast-1 ","tracking_tag_name":"tag_1","extra":"drop"}'::jsonb
           ) as result`,
        )
      ).rows[0].result;
      assert.deepEqual(normalized, {
        region: "ap-southeast-1",
        tracking_tag_name: "tag_1",
      });

      const ses = (
        await db.query(
          `select edm_private.delivery_provider_config(
             'amazon_ses',
             '{"region":"eu-west-1","configuration_set_name":"pixel-edm"}'::jsonb
           ) as result`,
        )
      ).rows[0].result;
      assert.deepEqual(ses, {
        region: "eu-west-1",
        configuration_set_name: "pixel-edm",
      });

      for (const [provider, config, pattern] of [
        ["aliyun_directmail", '{"region":"eu-west-1"}', /阿里云区域无效/],
        [
          "aliyun_directmail",
          '{"region":"us-east-1","tracking_tag_name":"bad tag"}',
          /字母、数字和下划线/,
        ],
        ["amazon_ses", '{"region":"cn-hangzhou-x"}', /AWS 区域无效/],
        [
          "amazon_ses",
          '{"region":"us-east-1","configuration_set_name":"bad set"}',
          /配置集名称/,
        ],
      ]) {
        await assert.rejects(
          db.query(
            `select edm_private.delivery_provider_config('${provider}','${config}'::jsonb)`,
          ),
          pattern,
        );
      }
    });

    await t.test(
      "阿里云通道落库到 provider_config 且旧字段仍回显",
      async () => {
        const saved = (
          await asUser(
            db,
            admin,
            rpc("save_delivery_channel", channelPayload(workspace)),
          )
        ).rows[0].result;
        assert.equal(saved.provider, "aliyun_directmail");
        assert.deepEqual(saved.provider_config, { region: "ap-southeast-1" });
        assert.equal(saved.region, "ap-southeast-1");
        assert.equal(saved.is_primary, true);
        assert.equal(saved.credential_hint, "ABCD");
        assert.equal(saved.access_key_hint, "ABCD");
        assert.equal(saved.rate_per_second, 5);
        assert.equal(saved.daily_quota, 2000);
        assert.equal(saved.capabilities.sender_alias_max_length, 14);

        const stored = (
          await db.query(
            "select provider,provider_config,credential_hint,is_primary from edm.delivery_channels where id=$1",
            [channelId],
          )
        ).rows[0];
        assert.equal(stored.provider, "aliyun_directmail");
        assert.deepEqual(stored.provider_config, { region: "ap-southeast-1" });
        assert.equal(stored.credential_hint, "ABCD");
        assert.equal(stored.is_primary, true);

        await assert.rejects(
          asUser(
            db,
            admin,
            rpc(
              "save_delivery_channel",
              channelPayload(workspace, {
                expected_version: 1,
                sender_alias: "这个发件人名称明显超过十四个字符上限",
                credential: undefined,
              }),
            ),
          ),
          /1 至 14 个字符/,
        );
      },
    );

    await t.test("追踪标签写入 provider_config 且开关保持通用列", async () => {
      const tracked = (
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
      assert.equal(tracked.tracking_enabled, true);
      assert.equal(tracked.tracking_tag_name, "pixel_edm_tracking");
      assert.deepEqual(tracked.provider_config, {
        region: "ap-southeast-1",
        tracking_tag_name: "pixel_edm_tracking",
      });

      const stored = (
        await db.query(
          "select tracking_enabled,provider_config->>'tracking_tag_name' as tag from edm.delivery_channels where id=$1",
          [channelId],
        )
      ).rows[0];
      assert.equal(stored.tracking_enabled, true);
      assert.equal(stored.tag, "pixel_edm_tracking");
    });

    await t.test("同一工作区只能有一个主通道", async () => {
      await assert.rejects(
        db.query(
          `insert into edm.delivery_channels(
             id,workspace_id,provider,provider_config,sender_domain,sender_address,
             sender_alias,status,credential_version,is_primary,created_by,updated_by
           ) values($1,$2,'amazon_ses','{"region":"us-east-1"}'::jsonb,
             'ses.contentup.cc','hello@ses.contentup.cc','SES',
             'configured',1,true,$3,$3)`,
          [secondChannelId, workspace, admin],
        ),
        /delivery_channels_primary_idx/,
      );
      await db.query(
        `insert into edm.delivery_channels(
           id,workspace_id,provider,provider_config,sender_domain,sender_address,
           sender_alias,status,credential_version,is_primary,created_by,updated_by
         ) values($1,$2,'amazon_ses','{"region":"us-east-1"}'::jsonb,
           'ses.contentup.cc','hello@ses.contentup.cc','SES',
           'configured',1,false,$3,$3)`,
        [secondChannelId, workspace, admin],
      );
      const primary = (
        await asUser(
          db,
          admin,
          rpc("get_delivery_channel", { workspace_id: workspace }),
        )
      ).rows[0].result;
      assert.equal(primary.id, channelId);
      assert.equal(primary.provider, "aliyun_directmail");
      await db.query("delete from edm.delivery_channels where id=$1", [
        secondChannelId,
      ]);
    });

    await t.test("通道可覆盖注册表默认限速", async () => {
      await db.query(
        "update edm.delivery_channels set rate_per_second=2,daily_quota=200 where id=$1",
        [channelId],
      );
      const limited = (
        await asUser(
          db,
          admin,
          rpc("get_delivery_channel", { workspace_id: workspace }),
        )
      ).rows[0].result;
      assert.equal(limited.rate_per_second, 2);
      assert.equal(limited.daily_quota, 200);
      await db.query(
        "update edm.delivery_channels set rate_per_second=null,daily_quota=null where id=$1",
        [channelId],
      );
    });

    await t.test("退信分级按厂商归一化并驱动抑制", async () => {
      assert.deepEqual(
        (
          await db.query(
            `select
               edm_private.delivery_failure_class('aliyun_directmail','2',null) as aliyun_hard,
               edm_private.delivery_failure_class('aliyun_directmail','3',null) as aliyun_complaint,
               edm_private.delivery_failure_class('aliyun_directmail','1',null) as aliyun_other,
               edm_private.delivery_failure_class('amazon_ses',null,'Permanent') as ses_hard,
               edm_private.delivery_failure_class('amazon_ses',null,'Transient') as ses_soft`,
          )
        ).rows[0],
        {
          aliyun_hard: "hard_bounce",
          aliyun_complaint: "complaint",
          aliyun_other: "undetermined",
          ses_hard: "hard_bounce",
          ses_soft: "soft_bounce",
        },
      );

      const digest = "c".repeat(64);
      await asUser(
        db,
        admin,
        rpc("configure_delivery_webhook", {
          workspace_id: workspace,
          channel_id: channelId,
          token_digest: digest,
          token_hint: "cccc",
        }),
      );
      const ingest = (eventId, email, extra) => ({
        channel_id: channelId,
        token_digest: digest,
        provider_event_id: eventId,
        provider_event_type: "dm:Deliver:Failed",
        event_type: "delivery_failed",
        recipient_email: email,
        occurred_at: "2026-09-19T00:00:00Z",
        payload_sha256: eventId.padEnd(64, "0"),
        ...extra,
      });

      await asServiceRole(
        db,
        rpc(
          "webhook_ingest_delivery_event",
          ingest("aaaa1", "hard@example.test", { provider_status: "2" }),
        ),
      );
      await asServiceRole(
        db,
        rpc(
          "webhook_ingest_delivery_event",
          ingest("bbbb1", "soft@example.test", { provider_status: "1" }),
        ),
      );
      // 适配器已归一化时，SQL 直接采用而不再回看厂商状态码。
      await asServiceRole(
        db,
        rpc(
          "webhook_ingest_delivery_event",
          ingest("cccc1", "declared@example.test", {
            provider_status: "1",
            failure_class: "hard_bounce",
          }),
        ),
      );

      const classes = (
        await db.query(
          `select recipient_email,provider,failure_class
           from edm.campaign_delivery_events order by provider_event_id`,
        )
      ).rows;
      assert.deepEqual(classes, [
        {
          recipient_email: "hard@example.test",
          provider: "aliyun_directmail",
          failure_class: "hard_bounce",
        },
        {
          recipient_email: "soft@example.test",
          provider: "aliyun_directmail",
          failure_class: "undetermined",
        },
        {
          recipient_email: "declared@example.test",
          provider: "aliyun_directmail",
          failure_class: "hard_bounce",
        },
      ]);

      const suppressed = (
        await db.query(
          "select email,reason from edm.suppressions where workspace_id=$1 order by email",
          [workspace],
        )
      ).rows;
      assert.deepEqual(suppressed, [
        { email: "declared@example.test", reason: "bounced" },
        { email: "hard@example.test", reason: "bounced" },
      ]);
    });

    await t.test("查看者读不到凭据线索与限速覆盖以外的敏感项", async () => {
      const summary = (
        await asUser(
          db,
          viewer,
          rpc("get_delivery_channel", { workspace_id: workspace }),
        )
      ).rows[0].result;
      assert.equal(summary.provider, "aliyun_directmail");
      assert.equal("credential_hint" in summary, false);
      assert.equal("access_key_hint" in summary, false);
      assert.equal("credential_version" in summary, false);
      assert.equal("webhook" in summary, false);
    });
  } finally {
    await db.close();
  }
});
