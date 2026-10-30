// 仅供本地端到端测试：模拟认证协议，业务查询仍执行真实 PostgreSQL RLS。
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  parseCredentialKeyring,
  sealCredentialPayload,
} from "../src/features/channels/crypto-core.ts";
import { createDatabase, asUser } from "./database-helper.mjs";
const db = await createDatabase();
const a = "10000000-0000-0000-0000-000000000001",
  b = "10000000-0000-0000-0000-000000000002",
  templateUser = "10000000-0000-0000-0000-000000000003",
  channelUser = "10000000-0000-0000-0000-000000000004",
  onboardingUser = "10000000-0000-0000-0000-000000000005",
  returningUser = "10000000-0000-0000-0000-000000000006",
  freshUser = "10000000-0000-0000-0000-000000000007",
  journeyUser = "10000000-0000-0000-0000-000000000008",
  mobileJourneyUser = "10000000-0000-0000-0000-000000000009";
const testAccounts = {
  [a]: "owner@example.test",
  [b]: "viewer@example.test",
  [templateUser]: "templates@example.test",
  [channelUser]: "channels@example.test",
  [onboardingUser]: "onboarding@example.test",
  [returningUser]: "returning@example.test",
  [freshUser]: "fresh@example.test",
  [journeyUser]: "journey@example.test",
  [mobileJourneyUser]: "mobile-journey@example.test",
};
await db.exec(`
  insert into auth.users(id,email,email_confirmed_at) values
    ('${a}','owner@example.test',now()),
    ('${b}','viewer@example.test',now()),
    ('${templateUser}','templates@example.test',now()),
    ('${channelUser}','channels@example.test',now()),
    ('${onboardingUser}','onboarding@example.test',now()),
    ('${returningUser}','returning@example.test',now()),
    ('${freshUser}','fresh@example.test',now()),
    ('${journeyUser}','journey@example.test',now()),
    ('${mobileJourneyUser}','mobile-journey@example.test',now())
`);
// 首次使用验证使用独立账号和工作区，场景控制不接触现有回归账号。
const onboardingWorkspaces = [];
for (const uid of [
  onboardingUser,
  returningUser,
  journeyUser,
  mobileJourneyUser,
]) {
  const workspaceId = (
    await asUser(db, uid, "select edm.initialize_member() as id")
  ).rows[0].id;
  onboardingWorkspaces.push(workspaceId);
  await db.query("update edm.workspaces set name=$2,plan='team' where id=$1", [
    workspaceId,
    uid === returningUser ? "回访协作邮局" : "初次使用邮局",
  ]);
}
await db.query(
  "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer')",
  [onboardingWorkspaces[1], onboardingUser],
);
let onboardingScenario = {};
// 通道流程使用独立工作区，避免视觉记录与既有设置、活动回归互相改变状态。
const channelWorkspace = (
  await asUser(db, channelUser, "select edm.initialize_member() as id")
).rows[0].id;
await db.query(
  "update edm.workspaces set name='通道测试邮局', mailing_address='上海市测试路 3 号', plan='pro' where id=$1",
  [channelWorkspace],
);
// 模板交互使用独立账号，避免设置页回归保存真实署名后改变缺省状态。
const templateWorkspace = (
  await asUser(db, templateUser, "select edm.initialize_member() as id")
).rows[0].id;
await db.query(
  "update edm.workspaces set name='模板验证邮局', plan='pro' where id=$1",
  [templateWorkspace],
);
const wb = (await asUser(db, b, "select edm.initialize_member() as id")).rows[0]
  .id;
await db.exec(
  `update edm.workspaces set name='协作邮局',mailing_address='上海市测试路 2 号' where id='${wb}'`,
);
const wa = (await asUser(db, a, "select edm.initialize_member() as id")).rows[0]
  .id;
await db.query(
  "update edm.workspaces set mailing_address='上海市测试路 1 号', plan='pro' where id=$1",
  [wa],
);
await db.query(
  "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer') on conflict do nothing",
  [wb, a],
);
const vipTag = (
  await db.query(
    "insert into edm.tags(workspace_id,name) values($1,'VIP') returning id",
    [wa],
  )
).rows[0].id;
const previewContacts = [
  ["preview-alpha@example.test", "=2+2", "subscribed", false],
  ["preview-blank@example.test", "", "subscribed", false],
  ["preview-charlie@example.test", "+SUM(1,1)", "subscribed", false],
  ["preview-delta@example.test", "-10", "subscribed", false],
  ["preview-echo@example.test", "@cmd", "subscribed", false],
  ["preview-tab@example.test", "\tTAB", "subscribed", false],
  ["preview-cr@example.test", "\rCR", "subscribed", false],
  ["preview-archived@example.test", "归档客户", "subscribed", true],
  ["preview-pending@example.test", "未确认客户", "unconfirmed", false],
  ["preview-suppressed@example.test", "抑制客户", "subscribed", false],
];
let suppressedPreviewContact;
for (const [
  index,
  [email, name, status, archived],
] of previewContacts.entries()) {
  const contact = (
    await db.query(
      `insert into edm.contacts(
         workspace_id,email,name,subscription_status,archived_at,created_by,created_at
       ) values($1,$2,$3,$4,case when $5 then now() end,$6,$7) returning id`,
      [
        wa,
        email,
        name,
        status,
        archived,
        a,
        new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
      ],
    )
  ).rows[0];
  await db.query(
    "insert into edm.contact_tags(workspace_id,contact_id,tag_id) values($1,$2,$3)",
    [wa, contact.id, vipTag],
  );
  if (email === "preview-suppressed@example.test")
    suppressedPreviewContact = contact.id;
}
const suppressionEvent = (
  await db.query(
    `insert into edm.subscription_events(
       workspace_id,contact_id,email,event_type,source,note,created_by
     ) values($1,$2,'preview-suppressed@example.test','unsubscribed','test','预览测试抑制',$3)
     returning id`,
    [wa, suppressedPreviewContact, a],
  )
).rows[0].id;
await db.query(
  `insert into edm.suppressions(workspace_id,email,reason,first_event_id)
   values($1,'preview-suppressed@example.test','unsubscribed',$2)`,
  [wa, suppressionEvent],
);
const wbTemplate = (
  await db.query(
    "select id from edm.templates where workspace_id=$1 and archived_at is null order by id limit 1",
    [wb],
  )
).rows[0].id;
await asUser(
  db,
  b,
  `select edm.save_campaign('${JSON.stringify({
    workspace_id: wb,
    name: "查看者可见活动",
    template_id: wbTemplate,
    audience_type: "all",
    variables: {},
  }).replaceAll("'", "''")}'::jsonb)`,
);
const user = (id) => ({
  id,
  aud: "authenticated",
  role: "authenticated",
  email: testAccounts[id],
  email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: new Date().toISOString(),
});
const token = (id) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: id,
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "test-signature",
  ].join(".");
const publicUnsubscribedTokens = new Set(["already.suppressed"]);
const originalProviders = (
  await db.query("select provider,enabled from edm.delivery_providers")
).rows;
const fixtureKeyring = parseCredentialKeyring(
  '{"active":"test-v1","keys":{"test-v1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}}',
);
let channelScenario = {};
let channelRequests = [];
let providerAcceptances = 0;
const waitChannelRequest = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, Number(milliseconds) || 0));
async function channelRpc(name, payload, worker = false) {
  const sql = `select edm.${name}('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb) as result`;
  return (await (worker ? db.query(sql) : asUser(db, channelUser, sql))).rows[0]
    .result;
}
async function seedChannel(provider) {
  const id = randomUUID();
  return channelRpc("save_delivery_channel", {
    workspace_id: channelWorkspace,
    id,
    provider,
    provider_config: {
      region: provider === "amazon_ses" ? "us-east-1" : "cn-hangzhou",
    },
    sender_domain: provider === "amazon_ses" ? null : "send.example.com",
    sender_address:
      provider === "amazon_ses"
        ? "hello@ses.example.test"
        : "hello@send.example.com",
    sender_alias: "通道测试邮局",
    credential: sealCredentialPayload(
      fixtureKeyring,
      {
        workspaceId: channelWorkspace,
        channelId: id,
        credentialVersion: 1,
        provider,
      },
      {
        accessKeyId: "LTAI5tFixture1234",
        accessKeySecret: "local-fixture-secret",
      },
    ),
  });
}
async function completeChannelTest(attemptId, status = "accepted") {
  return channelRpc(
    "worker_complete_delivery_test",
    {
      workspace_id: channelWorkspace,
      attempt_id: attemptId,
      status,
      provider_request_id: "fixture-request-123456",
      provider_event_id: "fixture-env-654321",
      ...(status === "failed"
        ? { error_category: "authentication", error_code: "InvalidAccessKeyId" }
        : status === "unknown"
          ? { error_category: "unknown", error_code: "NETWORK_BOUNDARY" }
          : {}),
    },
    true,
  );
}
const server = createServer(async (req, res) => {
  // Playwright 的 API 请求会复用 keep-alive。Node 默认空闲 5 秒就拆连接，
  // 与下一次 POST（常见于用例 afterEach 重置）撞上时客户端只看到 socket hang up。
  res.setHeader("Connection", "close");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3100");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const send = (value, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  try {
    const url = new URL(req.url, "http://localhost:54329");
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    if (url.pathname === "/health") return send({ ok: true });
    if (url.pathname === "/__fixtures/onboarding") {
      if (req.method === "GET")
        return send({
          workspaces: onboardingWorkspaces,
          freshWorkspaces: Number(
            (
              await db.query(
                "select count(*) as total from edm.workspaces where bootstrap_owner_id=$1",
                [freshUser],
              )
            ).rows[0].total,
          ),
        });
      onboardingScenario = { ...input };
      const workspaceId =
        onboardingWorkspaces[
          input.journey === "mobile" ? 3 : input.journey ? 2 : 0
        ];
      const scenarioUser =
        input.journey === "mobile"
          ? mobileJourneyUser
          : input.journey
            ? journeyUser
            : onboardingUser;
      await db.transaction(async (tx) => {
        await tx.query(
          "update edm.workspace_members set role='admin' where workspace_id=$1 and user_id=$2",
          [workspaceId, scenarioUser],
        );
        await tx.query("update edm.workspaces set owner_id=$2 where id=$1", [
          workspaceId,
          scenarioUser,
        ]);
        await tx.query(
          "delete from edm.workspace_members where workspace_id=$1 and user_id=$2",
          [workspaceId, b],
        );
      });
      await db.query("delete from edm.campaigns where workspace_id=$1", [
        workspaceId,
      ]);
      await db.query("delete from edm.suppressions where workspace_id=$1", [
        workspaceId,
      ]);
      await db.query(
        "delete from edm.subscription_events where workspace_id=$1",
        [workspaceId],
      );
      await db.query(
        "delete from edm.contact_import_rows where workspace_id=$1",
        [workspaceId],
      );
      await db.query("delete from edm.contact_imports where workspace_id=$1", [
        workspaceId,
      ]);
      await db.query("delete from edm.contacts where workspace_id=$1", [
        workspaceId,
      ]);
      await db.query(
        "delete from edm.delivery_channels where workspace_id=$1",
        [workspaceId],
      );
      await db.query(
        "update edm.templates set archived_at=null where workspace_id=$1",
        [workspaceId],
      );
      await db.query(
        "update edm.members set display_name='店主' where user_id=$1",
        [scenarioUser],
      );
      const prepared = ["ready", "existing", "invalidated"].includes(
        input.state,
      );
      await db.query(
        "update edm.workspaces set name=$2,mailing_address=$3,plan=$4 where id=$1",
        [
          workspaceId,
          input.longName
            ? "跨境电商与设计工作室的首次邮件营销准备".repeat(5).slice(0, 80)
            : "初次使用邮局",
          prepared || input.state === "partial" ? "上海市测试路 5 号" : "",
          input.overCapacity ? "free" : "team",
        ],
      );
      if (prepared || input.state === "partial") {
        await db.query(
          "insert into edm.contacts(workspace_id,email,name,subscription_status,created_by) values($1,'reader@example.test','测试客户',$2,$3)",
          [
            workspaceId,
            input.unconfirmed ? "unconfirmed" : "subscribed",
            scenarioUser,
          ],
        );
      }
      if (prepared) {
        const channelId = randomUUID();
        const credential = sealCredentialPayload(
          fixtureKeyring,
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
        );
        const payload = {
          workspace_id: workspaceId,
          id: channelId,
          provider: "aliyun_directmail",
          provider_config: { region: "cn-hangzhou" },
          sender_domain: "send.example.com",
          sender_address: "hello@send.example.com",
          sender_alias: "初次使用邮局",
          credential,
        };
        await asUser(
          db,
          scenarioUser,
          `select edm.save_delivery_channel('${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb)`,
        );
        await db.query(
          "update edm.delivery_channels set status=$2 where id=$1",
          [
            channelId,
            input.state === "invalidated" ? "disconnected" : "verified",
          ],
        );
      }
      if (input.state === "existing") {
        const templateId = (
          await db.query(
            "select id from edm.templates where workspace_id=$1 order by id limit 1",
            [workspaceId],
          )
        ).rows[0].id;
        const payload = {
          workspace_id: workspaceId,
          name: "第一场新品介绍活动",
          template_id: templateId,
          audience_type: "all",
          variables: {},
        };
        await asUser(
          db,
          scenarioUser,
          `select edm.save_campaign('${JSON.stringify(payload)}'::jsonb)`,
        );
      }
      if (input.archivedTemplates)
        await db.query(
          "update edm.templates set archived_at=now() where workspace_id=$1",
          [workspaceId],
        );
      if (input.role && input.role !== "admin") {
        await db.transaction(async (tx) => {
          await tx.query(
            "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'admin')",
            [workspaceId, b],
          );
          await tx.query("update edm.workspaces set owner_id=$2 where id=$1", [
            workspaceId,
            b,
          ]);
          await tx.query(
            "update edm.workspace_members set role=$3 where workspace_id=$1 and user_id=$2",
            [workspaceId, scenarioUser, input.role],
          );
        });
      }
      return send({ ok: true, workspaceId });
    }
    // 仅此 127.0.0.1 测试进程提供场景控制，数据局限于独立通道测试工作区。
    if (url.pathname === "/__fixtures/channels") {
      if (req.method === "GET")
        return send({
          requests: channelRequests,
          providerAcceptances,
          attempts: (
            await db.query(
              "select id,status from edm.delivery_test_attempts where workspace_id=$1 order by created_at",
              [channelWorkspace],
            )
          ).rows,
        });
      if (input.operation === "complete") {
        const attempts = (
          await db.query(
            "select id,status from edm.delivery_test_attempts where workspace_id=$1 and status in ('pending','processing')",
            [channelWorkspace],
          )
        ).rows;
        for (const attempt of attempts) {
          if (attempt.status === "pending")
            await channelRpc(
              "worker_claim_delivery_test",
              {
                workspace_id: channelWorkspace,
                attempt_id: attempt.id,
                recipient_email: testAccounts[channelUser],
              },
              true,
            );
          await completeChannelTest(attempt.id, input.status ?? "accepted");
        }
        return send({ ok: true });
      }
      if (input.operation === "faults") {
        channelScenario = { ...channelScenario, ...input };
        return send({ ok: true });
      }
      await db.transaction(async (tx) => {
        await tx.query(
          "update edm.workspace_members set role='admin' where workspace_id=$1 and user_id=$2",
          [channelWorkspace, channelUser],
        );
        await tx.query("update edm.workspaces set owner_id=$2 where id=$1", [
          channelWorkspace,
          channelUser,
        ]);
        await tx.query(
          "delete from edm.workspace_members where workspace_id=$1 and user_id=$2",
          [channelWorkspace, b],
        );
      });
      await db.query(
        "delete from edm.delivery_channels where workspace_id=$1",
        [channelWorkspace],
      );
      for (const provider of originalProviders)
        await db.query(
          "update edm.delivery_providers set enabled=$2 where provider=$1",
          [provider.provider, provider.enabled],
        );
      channelScenario = { ...input };
      channelRequests = [];
      providerAcceptances = 0;
      await db.query(
        "update edm.workspaces set mailing_address=$2 where id=$1",
        [channelWorkspace, input.missingAddress ? "" : "上海市测试路 3 号"],
      );
      await db.query(
        "update edm.members set display_name='店主' where user_id=$1",
        [channelUser],
      );
      if (input.seed) {
        const seeded = await seedChannel("aliyun_directmail");
        if (input.status)
          await db.query(
            "update edm.delivery_channels set status=$2 where id=$1",
            [seeded.id, input.status],
          );
        if (input.missingCredentials)
          await db.query(
            "delete from edm_private.delivery_channel_credentials where channel_id=$1",
            [seeded.id],
          );
        if (input.longContent)
          await db.query(
            "update edm.delivery_channels set sender_domain=$2,sender_address=$3 where id=$1",
            [
              seeded.id,
              "long-domain-".repeat(4) + "mail.example.test",
              "long-sender-".repeat(4) +
                "@" +
                "long-domain-".repeat(4) +
                "mail.example.test",
            ],
          );
      }
      if (input.multiple) {
        await db.query(
          "update edm.delivery_providers set enabled=true where provider='amazon_ses'",
        );
        await seedChannel("amazon_ses");
      }
      if (input.readOnly)
        await db.transaction(async (tx) => {
          // 保留有效管理员与所有者约束，再设置当前测试成员的只读角色。
          await tx.query(
            "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'admin')",
            [channelWorkspace, b],
          );
          await tx.query("update edm.workspaces set owner_id=$2 where id=$1", [
            channelWorkspace,
            b,
          ]);
          await tx.query(
            "update edm.workspace_members set role='viewer' where workspace_id=$1 and user_id=$2",
            [channelWorkspace, channelUser],
          );
        });
      return send({ ok: true });
    }
    if (url.pathname === "/functions/v1/edm-unsubscribe") {
      const publicToken = req.headers["x-edm-unsubscribe-token"];
      if (typeof publicToken !== "string" || publicToken === "invalid.invalid")
        return send({ error: "退订链接无效" }, 404);
      if (req.method === "GET")
        return send({
          status: publicUnsubscribedTokens.has(publicToken)
            ? "already_suppressed"
            : "ready",
          workspace_name: "公开测试店铺",
          masked_email: "c***@example.test",
        });
      if (req.method === "POST") {
        publicUnsubscribedTokens.add(publicToken);
        return send({
          status: "unsubscribed",
          workspace_name: "公开测试店铺",
          masked_email: "c***@example.test",
          already_applied: false,
        });
      }
      return send({ error: "请求方式无效" }, 405);
    }
    if (url.pathname === "/auth/v1/token") {
      // viewer@example.test 是免费版「协作邮局」的管理员，用于套餐用量上限场景。
      const loginId = Object.keys(testAccounts).find(
        (accountId) => testAccounts[accountId] === input.email,
      );
      if (!loginId || input.password !== "edm-test-password")
        return send({ message: "登录失败" }, 400);
      return send({
        access_token: token(loginId),
        refresh_token: "test-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: user(loginId),
      });
    }
    // 邮件链接的 token_hash 校验。只接受注册确认和重置密码，其余类型保持失败。
    if (url.pathname === "/auth/v1/verify" && req.method === "POST") {
      const accepted =
        (input.token_hash === "valid-email" &&
          (input.type === "email" || input.type === "signup")) ||
        (input.token_hash === "valid-recovery" && input.type === "recovery");
      if (!accepted) return send({ message: "验证失败" }, 403);
      return send({
        access_token: token(a),
        refresh_token: "test-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: user(a),
      });
    }
    const bearer = req.headers.authorization?.replace("Bearer ", "");
    const id = bearer === token(a) ? a : bearer === token(b) ? b : null;
    // 令牌时间随秒变化，因此测试验证解析后的固定用户与测试签名。
    let uid = id;
    if (!uid && bearer?.endsWith(".test-signature")) {
      const claims = JSON.parse(
        Buffer.from(bearer.split(".")[1], "base64url").toString(),
      );
      if (Object.hasOwn(testAccounts, claims.sub)) uid = claims.sub;
    }
    if (url.pathname === "/auth/v1/user")
      return uid ? send(user(uid)) : send({ message: "需要登录" }, 401);
    if (url.pathname === "/auth/v1/logout") return send({});
    if (!uid) return send({ message: "需要登录" }, 401);
    if (
      url.pathname === "/functions/v1/edm-directmail-test" ||
      url.pathname === "/functions/v1/edm-delivery-test"
    ) {
      const isolatedChannel = uid === channelUser;
      const outcome = isolatedChannel
        ? (channelScenario.testOutcomes?.shift() ?? "accepted")
        : "accepted";
      if (isolatedChannel) {
        channelRequests.push({
          operation: "test",
          channelId: input.channel_id,
          key: input.idempotency_key,
        });
        await waitChannelRequest(channelScenario.testDelayMs);
      }
      const prepared = (
        await asUser(
          db,
          uid,
          `select edm.prepare_delivery_test('${JSON.stringify(input).replaceAll("'", "''")}'::jsonb) as result`,
        )
      ).rows[0].result;
      if (!prepared.is_new)
        return send({ data: prepared.attempt, reused: true });
      if (outcome === "pending") return send({ data: prepared.attempt });
      const claim = (
        await db.query(
          `select edm.worker_claim_delivery_test('${JSON.stringify({
            workspace_id: input.workspace_id,
            attempt_id: input.attempt_id,
            recipient_email: user(uid).email,
          }).replaceAll("'", "''")}'::jsonb) as result`,
        )
      ).rows[0].result;
      if (!claim.claim_acquired)
        return send({ data: claim.attempt, reused: true });
      if (outcome === "processing") return send({ data: claim.attempt });
      const completed = (
        await db.query(
          `select edm.worker_complete_delivery_test('${JSON.stringify({
            workspace_id: input.workspace_id,
            attempt_id: input.attempt_id,
            status: ["failed", "unknown"].includes(outcome)
              ? outcome
              : "accepted",
            ...(outcome === "failed"
              ? {
                  error_category: "authentication",
                  error_code: "InvalidAccessKeyId",
                }
              : outcome === "unknown"
                ? { error_category: "unknown", error_code: "NETWORK_BOUNDARY" }
                : {}),
            provider_request_id: "fixture-request-123456",
            provider_event_id: "fixture-env-654321",
          }).replaceAll("'", "''")}'::jsonb) as result`,
        )
      ).rows[0].result;
      if (isolatedChannel && !["failed", "unknown"].includes(outcome))
        providerAcceptances += 1;
      if (outcome === "transport")
        return send({ error: "模拟发送完成后响应中断" }, 503);
      return send({ data: completed });
    }
    if (url.pathname === "/rest/v1/rpc/initialize_member") {
      if (uid === freshUser && onboardingScenario.initializeFailures > 0) {
        onboardingScenario.initializeFailures -= 1;
        return send({ message: "模拟初始化暂时不可用" }, 503);
      }
      const result = await asUser(
        db,
        uid,
        "select edm.initialize_member() as id",
      );
      if (
        ![
          templateUser,
          onboardingUser,
          returningUser,
          freshUser,
          journeyUser,
          mobileJourneyUser,
        ].includes(uid)
      )
        await db.query(
          "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer') on conflict do nothing",
          [wb, uid],
        );
      return send(result.rows[0].id);
    }
    const rpc = url.pathname.split("/").pop();
    if (uid === onboardingUser && onboardingScenario.failedRpcs?.includes(rpc))
      return send({ message: "模拟准备信息暂时不可用" }, 503);
    if (uid === channelUser && url.pathname.startsWith("/rest/v1/rpc/")) {
      if (
        [
          "save_delivery_channel",
          "disconnect_delivery_channel",
          "configure_delivery_tracking",
          "configure_delivery_webhook",
          "set_primary_delivery_channel",
        ].includes(rpc)
      ) {
        channelRequests.push({ operation: rpc });
        if (rpc === "save_delivery_channel") {
          await waitChannelRequest(channelScenario.saveDelayMs);
          if (channelScenario.saveFailures > 0) {
            channelScenario.saveFailures -= 1;
            return send({ message: "模拟保存失败，请核对后重试。" }, 503);
          }
        }
      }
    }
    const noPayloadRpcs = new Set(["list_delivery_providers"]);
    if (
      url.pathname.startsWith("/rest/v1/rpc/") &&
      [
        "list_delivery_providers",
        "list_delivery_channels",
        "set_primary_delivery_channel",
        "save_contact",
        "archive_contact",
        "list_contacts",
        "prepare_contact_import",
        "confirm_contact_import",
        "process_contact_import_batch",
        "get_contact_import",
        "list_contact_imports",
        "export_contact_import",
        "unsubscribe_contact",
        "save_template",
        "duplicate_template",
        "set_template_archived",
        "list_templates",
        "list_activity_logs",
        "list_campaigns",
        "get_campaign",
        "save_campaign",
        "set_campaign_archived",
        "get_campaign_editor_options",
        "get_campaign_preview",
        "confirm_campaign",
        "duplicate_confirmed_campaign",
        "get_campaign_export_chunk",
        "get_delivery_channel",
        "save_delivery_channel",
        "disconnect_delivery_channel",
        "configure_delivery_webhook",
        "configure_delivery_tracking",
        "revoke_delivery_webhook",
        "prepare_delivery_test",
        "get_delivery_test_summary",
        "start_campaign_delivery",
        "set_campaign_delivery_paused",
        "abort_campaign_delivery",
        "get_campaign_delivery_summaries",
        "get_campaign_delivery_statistics",
        "get_workspace_campaign_statistics",
        "get_workspace_delivery_plan",
        "get_workspace_billing_status",
        "list_campaign_delivery_tasks",
        "resolve_delivery_unknown",
        "list_workspace_team",
      ].includes(rpc)
    ) {
      const sql = noPayloadRpcs.has(rpc)
        ? `select edm.${rpc}() as result`
        : `select edm.${rpc}('${JSON.stringify(input.payload ?? input).replaceAll("'", "''")}'::jsonb) as result`;
      const result = await asUser(db, uid, sql);
      return send(result.rows[0].result);
    }
    const table = url.pathname.split("/").pop();
    if (!["members", "workspaces", "workspace_members"].includes(table))
      return send({ message: "不存在" }, 404);
    const clauses = [];
    for (const [key, value] of url.searchParams) {
      if (
        ["id", "user_id", "workspace_id", "status"].includes(key) &&
        value.startsWith("eq.")
      )
        clauses.push(`${key}='${value.slice(3).replaceAll("'", "''")}'`);
    }
    const where = clauses.length ? ` where ${clauses.join(" and ")}` : "";
    let sql = `select * from edm.${table}${where}`;
    if (req.method === "PATCH") {
      const patchable = {
        workspaces: ["name", "mailing_address"],
        members: ["display_name"],
      }[table];
      if (!patchable || Object.keys(input).some((k) => !patchable.includes(k)))
        return send({ message: "禁止操作" }, 403);
      sql = `update edm.${table} set ${Object.entries(input)
        .map(([k, v]) => `${k}='${String(v).replaceAll("'", "''")}'`)
        .join(",")}${where} returning *`;
    }
    const result = await asUser(db, uid, sql);
    const single = req.headers.accept?.includes("vnd.pgrst.object");
    if (single && result.rows.length === 0)
      return send(
        { code: "PGRST116", details: "The result contains 0 rows" },
        406,
      );
    return send(single ? result.rows[0] : result.rows);
  } catch (error) {
    send({ message: String(error) }, 400);
  }
});
server.keepAliveTimeout = 60_000;
server.headersTimeout = 65_000;
server.listen(54329, "127.0.0.1", () =>
  console.log("本地测试认证与数据库接口已就绪"),
);
process.on("SIGTERM", () =>
  server.close(async () => {
    await db.close();
    process.exit();
  }),
);
