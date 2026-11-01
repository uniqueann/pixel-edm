import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { asUser } from "../database-helper.mjs";
import {
  parseCredentialKeyring,
  sealCredentialPayload,
} from "../../src/features/channels/crypto-core.ts";

// 只有本地 PGlite；不调用服务商，不持有真实客户或凭据。
export async function createPerformanceFixture(db, profiles) {
  const keyring = parseCredentialKeyring(
    '{"active":"test-v1","keys":{"test-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}}',
  );
  const rpc = async (userId, name, payload) =>
    (
      await asUser(
        db,
        userId,
        `select edm.${name}('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb) as result`,
      )
    ).rows[0].result;
  for (const { userId, workspaceId, size } of profiles) {
    const boundary = size === "boundary";
    await db.query(
      "update edm.workspaces set name='性能验证邮局',plan='team',mailing_address='上海市本地测试路 1 号' where id=$1",
      [workspaceId],
    );
    await db.query(
      "update edm.members set display_name='性能验证管理员' where user_id=$1",
      [userId],
    );
    const unit =
      "Hello {{name}}, explore {{product}} at {{store_name}}. 优惠 {{discount}}。\n";
    const length = boundary ? 20000 : 500;
    const body = unit
      .repeat(Math.floor(length / unit.length))
      .padEnd(length, "。");
    const templates = (
      await db.query(
        "select id from edm.templates where workspace_id=$1 order by name,id",
        [workspaceId],
      )
    ).rows;
    for (let index = templates.length; index < (boundary ? 50 : 20); index++) {
      await rpc(userId, "save_template", {
        workspace_id: workspaceId,
        name: `性能模板 ${String(index).padStart(3, "0")}`,
        category: "性能验证",
        subject: "Hello {{name}}",
        body,
      });
    }
    await db.query(
      "update edm.templates set body=$2,subject='Hello {{name}}',created_at='2026-10-31T01:00:00Z' where workspace_id=$1",
      [workspaceId, body],
    );
    await db.query(
      "with ordered as (select id,row_number() over(order by name,id) as n from edm.templates where workspace_id=$1) update edm.templates t set created_at=\'2026-10-31T01:00:00Z\'::timestamptz+ordered.n * interval \'1 second\' from ordered where t.id=ordered.id",
      [workspaceId],
    );
    const template = (
      await db.query(
        "select id from edm.templates where workspace_id=$1 order by name,id limit 1",
        [workspaceId],
      )
    ).rows[0];
    await db.query(
      `insert into edm.contacts(workspace_id,email,name,subscription_status,created_by,created_at)
      select $1,'perf-'||n||'@example.test','测试客户 '||n,'subscribed',$2,'2026-10-30T00:00:00Z'::timestamptz+n * interval '1 second' from generate_series(1,$3) n`,
      [workspaceId, userId, boundary ? 500 : 20],
    );
    const channelId = randomUUID();
    await rpc(userId, "save_delivery_channel", {
      workspace_id: workspaceId,
      id: channelId,
      provider: "aliyun_directmail",
      provider_config: { region: "cn-hangzhou" },
      sender_domain: "send.example.com",
      sender_address: "hello@send.example.com",
      sender_alias: "性能验证邮局",
      credential: sealCredentialPayload(
        keyring,
        {
          workspaceId,
          channelId,
          credentialVersion: 1,
          provider: "aliyun_directmail",
        },
        {
          accessKeyId: "LTAI5tFixture1234",
          accessKeySecret: "local-fixture-secret",
        },
      ),
    });
    await db.query(
      "update edm.delivery_channels set status='verified' where id=$1",
      [channelId],
    );
    const variables = {
      store_name: "性能验证邮局",
      sender_name: "测试管理员",
      discount: "10%",
      product: "测试商品",
      order_number: "TEST-001",
    };
    for (let index = 0; index < (boundary ? 100 : 20); index++)
      await rpc(userId, "save_campaign", {
        workspace_id: workspaceId,
        name: `性能活动 ${String(index).padStart(3, "0")}`,
        template_id: template.id,
        audience_type: "all",
        variables,
      });
    const campaign = (
      await db.query(
        "select id from edm.campaigns where workspace_id=$1 order by name limit 1",
        [workspaceId],
      )
    ).rows[0];
    // 统计由本地快照和静止的已完成任务构造；没有启动发送进程。
    const preview = await rpc(userId, "get_campaign_preview", {
      workspace_id: workspaceId,
      id: campaign.id,
    });
    const confirmation = await rpc(userId, "confirm_campaign", {
      workspace_id: workspaceId,
      id: campaign.id,
      expected_campaign_version: preview.campaign.version,
      expected_template_version: preview.template.version,
    });
    const started = await rpc(userId, "start_campaign_delivery", {
      workspace_id: workspaceId,
      campaign_id: campaign.id,
      expected_version: confirmation.campaign_version,
      idempotency_key: randomUUID(),
      confirmation_name: "性能活动 000",
    });
    await db.query(
      "update edm.campaign_delivery_tasks set status='accepted',accepted_at='2026-10-31T02:00:00Z',completed_at='2026-10-31T02:00:00Z' where run_id=$1",
      [started.run_id],
    );
    await db.query(
      "update edm.campaign_delivery_runs set status='completed',completed_at='2026-10-31T02:00:00Z' where id=$1",
      [started.run_id],
    );
    await db.query(
      "update edm.campaigns set created_at='2026-10-31T02:00:00Z'::timestamptz - right(name,3)::integer * interval '1 second' where workspace_id=$1",
      [workspaceId],
    );
    await db.query(
      "update edm.campaigns set status='completed',created_at='2026-10-31T03:00:00Z' where id=$1",
      [campaign.id],
    );
  }
  let requests = [];
  return {
    observe(req, res) {
      if (!req.url.startsWith("/rest/") && !req.url.startsWith("/auth/"))
        return;
      const start = performance.now();
      const path = new URL(req.url, "http://localhost").pathname;
      res.once("finish", () =>
        requests.push({
          path,
          startMs: start,
          durationMs: performance.now() - start,
          status: res.statusCode,
        }),
      );
    },
    async handle(url, input, send) {
      if (url.pathname === "/__fixtures/performance") {
        if (input.reset) requests = [];
        send({ profiles, requests });
        return true;
      }
      // 固定每次认证 / 数据请求的夹具等待，数据库执行另由请求完整时长反映。
      if (
        url.pathname.startsWith("/rest/") ||
        url.pathname.startsWith("/auth/")
      )
        await new Promise((resolve) => setTimeout(resolve, 20));
      return false;
    },
  };
}
