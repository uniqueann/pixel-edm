// 仅供本地端到端测试：模拟认证协议，业务查询仍执行真实 PostgreSQL RLS。
import { createServer } from "node:http";
import { createDatabase, asUser } from "./database-helper.mjs";
const db = await createDatabase();
const a = "10000000-0000-0000-0000-000000000001",
  b = "10000000-0000-0000-0000-000000000002";
await db.exec(`insert into auth.users values('${a}'),('${b}')`);
const wb = (await asUser(db, b, "select edm.initialize_member() as id")).rows[0]
  .id;
await db.exec(
  `update edm.workspaces set name='协作邮局',mailing_address='上海市测试路 2 号' where id='${wb}'`,
);
const wa = (await asUser(db, a, "select edm.initialize_member() as id")).rows[0]
  .id;
await db.query(
  "update edm.workspaces set mailing_address='上海市测试路 1 号' where id=$1",
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
  email: id === a ? "owner@example.test" : "viewer@example.test",
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
const server = createServer(async (req, res) => {
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
      if (
        input.email !== "owner@example.test" ||
        input.password !== "edm-test-password"
      )
        return send({ message: "登录失败" }, 400);
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
      if ([a, b].includes(claims.sub)) uid = claims.sub;
    }
    if (url.pathname === "/auth/v1/user")
      return uid ? send(user(uid)) : send({ message: "需要登录" }, 401);
    if (url.pathname === "/auth/v1/logout") return send({});
    if (!uid) return send({ message: "需要登录" }, 401);
    if (url.pathname === "/functions/v1/edm-directmail-test") {
      const prepared = (
        await asUser(
          db,
          uid,
          `select edm.prepare_delivery_test('${JSON.stringify(input).replaceAll("'", "''")}'::jsonb) as result`,
        )
      ).rows[0].result;
      if (!prepared.is_new)
        return send({ data: prepared.attempt, reused: true });
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
      const completed = (
        await db.query(
          `select edm.worker_complete_delivery_test('${JSON.stringify({
            workspace_id: input.workspace_id,
            attempt_id: input.attempt_id,
            status: "accepted",
            provider_request_id: "fixture-request-123456",
            provider_event_id: "fixture-env-654321",
          }).replaceAll("'", "''")}'::jsonb) as result`,
        )
      ).rows[0].result;
      return send({ data: completed });
    }
    if (url.pathname === "/rest/v1/rpc/initialize_member") {
      const result = await asUser(
        db,
        uid,
        "select edm.initialize_member() as id",
      );
      await db.query(
        "insert into edm.workspace_members(workspace_id,user_id,role) values($1,$2,'viewer') on conflict do nothing",
        [wb, uid],
      );
      return send(result.rows[0].id);
    }
    const rpc = url.pathname.split("/").pop();
    if (
      url.pathname.startsWith("/rest/v1/rpc/") &&
      [
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
        "revoke_delivery_webhook",
        "prepare_delivery_test",
        "get_delivery_test_summary",
        "start_campaign_delivery",
        "set_campaign_delivery_paused",
        "abort_campaign_delivery",
        "get_campaign_delivery_summaries",
        "list_campaign_delivery_tasks",
        "resolve_delivery_unknown",
      ].includes(rpc)
    ) {
      const result = await asUser(
        db,
        uid,
        `select edm.${rpc}('${JSON.stringify(input.payload).replaceAll("'", "''")}'::jsonb) as result`,
      );
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
      if (
        table !== "workspaces" ||
        Object.keys(input).some((k) => !["name", "mailing_address"].includes(k))
      )
        return send({ message: "禁止操作" }, 403);
      sql = `update edm.workspaces set ${Object.entries(input)
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
server.listen(54329, "127.0.0.1", () =>
  console.log("本地测试认证与数据库接口已就绪"),
);
process.on("SIGTERM", () =>
  server.close(async () => {
    await db.close();
    process.exit();
  }),
);
