import test from "node:test";
import assert from "node:assert/strict";
import {
  appendUnsubscribeFooter,
  renderTrackedHtmlBody,
  signUnsubscribeToken,
  unsubscribeHeaders,
  unsubscribeUrls,
  verifyUnsubscribeToken,
} from "../supabase/functions/_shared/unsubscribe-token.ts";

const taskId = "81000000-0000-4000-8000-000000000001";
const firstKey = Buffer.alloc(32, 11).toString("base64");
const secondKey = Buffer.alloc(32, 12).toString("base64");

test("P5-2 退订令牌可长期验证、轮换且不暴露客户信息", async () => {
  const firstKeyring = JSON.stringify({ active: "u1", keys: { u1: firstKey } });
  const token = await signUnsubscribeToken({
    keyringSource: firstKeyring,
    taskId,
  });
  const rotatedKeyring = JSON.stringify({
    active: "u2",
    keys: { u1: firstKey, u2: secondKey },
  });
  assert.deepEqual(
    await verifyUnsubscribeToken({ keyringSource: rotatedKeyring, token }),
    {
      version: 1,
      purpose: "unsubscribe",
      keyId: "u1",
      taskId,
    },
  );
  assert.equal(token.includes("customer@example.test"), false);
  const [payloadPart] = token.split(".");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());
  assert.deepEqual(Object.keys(payload).sort(), ["k", "p", "t", "v"]);
  assert.equal(payload.t, taskId);

  const tampered = `${payloadPart}.${token.split(".")[1].slice(0, -1)}A`;
  await assert.rejects(
    verifyUnsubscribeToken({ keyringSource: rotatedKeyring, token: tampered }),
    /UNSUBSCRIBE_TOKEN_INVALID/,
  );
  await assert.rejects(
    verifyUnsubscribeToken({
      keyringSource: JSON.stringify({ active: "u2", keys: { u2: secondKey } }),
      token,
    }),
    /UNSUBSCRIBE_TOKEN_INVALID/,
  );
});

test("P5-2 邮件页脚、公开地址与 one-click 邮件头固定", async () => {
  const token = await signUnsubscribeToken({
    keyringSource: JSON.stringify({ active: "u1", keys: { u1: firstKey } }),
    taskId,
  });
  const urls = unsubscribeUrls("https://edm.contentup.cc", token);
  assert.equal(urls.pageUrl, `https://edm.contentup.cc/unsubscribe/${token}`);
  assert.equal(
    urls.oneClickUrl,
    `https://edm.contentup.cc/api/unsubscribe/${token}`,
  );
  assert.deepEqual(unsubscribeHeaders(urls.oneClickUrl), {
    "List-Unsubscribe": `<${urls.oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
  const body = appendUnsubscribeFooter({
    body: "Hello customer\n",
    workspaceName: "测试店铺\n伪造行",
    mailingAddress: "上海市测试路 1 号\r\n中国",
    pageUrl: urls.pageUrl,
  });
  assert.match(body, /Hello customer\n\n—/);
  assert.match(body, /测试店铺 伪造行/);
  assert.match(body, /Contact address \/ 联系地址: 上海市测试路 1 号 中国/);
  assert.match(body, /Unsubscribe \/ 退订: https:\/\/edm\.contentup\.cc/);
  assert.throws(
    () => unsubscribeUrls("http://edm.contentup.cc", token),
    /UNSUBSCRIBE_SITE_URL_INVALID/,
  );
});

test("P5-3 追踪邮件 HTML 安全转义、链接化且退订链接不计点击", () => {
  const html = renderTrackedHtmlBody({
    body: '新品 <script>alert("x")</script>\n查看 https://example.test/deal?x=1&y=2。',
    workspaceName: "测试 & 店铺",
    mailingAddress: "上海 <测试路>",
    pageUrl: "https://edm.contentup.cc/unsubscribe/signed-token",
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example\.test\/deal\?x=1&amp;y=2"/);
  assert.match(html, /测试 &amp; 店铺/);
  assert.match(html, /上海 &lt;测试路&gt;/);
  assert.match(
    html,
    /href="https:\/\/edm\.contentup\.cc\/unsubscribe\/signed-token" data-alidm-traceoff/,
  );
});
