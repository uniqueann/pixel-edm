import test from "node:test";
import assert from "node:assert/strict";
import { buildDirectMailRequest } from "../supabase/functions/_shared/directmail-request.ts";
import { classifyDirectMailError } from "../supabase/functions/_shared/providers/aliyun_directmail/error.ts";

const base = {
  senderAddress: "edm@send.example.test",
  senderAlias: "测试邮局",
  replyToAddress: "reply@example.test",
  recipientEmail: "customer@example.test",
  subject: "测试主题",
  textBody: "纯文本内容",
  headers: {
    "List-Unsubscribe": "<https://example.test/api/unsubscribe/token>",
  },
};

test("P5-3 未开启行为追踪时保持纯文本且关闭 ClickTrace", () => {
  const request = buildDirectMailRequest(base);
  assert.equal(request.textBody, "纯文本内容");
  assert.equal(request.htmlBody, undefined);
  assert.equal(request.tagName, undefined);
  assert.equal(request.clickTrace, "0");
});

test("P5-3 开启行为追踪时发送 HTML、标签并开启 ClickTrace", () => {
  const request = buildDirectMailRequest({
    ...base,
    htmlBody: "<p>HTML 内容</p>",
    trackingTagName: "pixel_edm_tracking",
  });
  assert.equal(request.textBody, undefined);
  assert.equal(request.htmlBody, "<p>HTML 内容</p>");
  assert.equal(request.tagName, "pixel_edm_tracking");
  assert.equal(request.clickTrace, "1");
  assert.match(request.headers, /List-Unsubscribe/);
});

test("P5-3 追踪配置缺少 HTML 时拒绝发送", () => {
  assert.throws(
    () =>
      buildDirectMailRequest({
        ...base,
        trackingTagName: "pixel_edm_tracking",
      }),
    /TRACKING_HTML_BODY_REQUIRED/,
  );
});

test("P8-2 DirectMail 错误分类保持既有六类语义", () => {
  const cases = [
    ["InvalidAccessKeyId.NotFound", "authentication", "failed"],
    ["InvalidSenderAddress", "configuration", "failed"],
    ["Throttling.User", "rate_limit", "failed"],
    ["ServiceUnavailable", "temporary", "failed"],
    ["MessageRejected", "permanent", "failed"],
    ["TimeoutError", "unknown", "unknown"],
  ];
  for (const [code, category, status] of cases) {
    assert.deepEqual(classifyDirectMailError({ code }), {
      status,
      error_category: category,
      error_code: code,
    });
  }
});
