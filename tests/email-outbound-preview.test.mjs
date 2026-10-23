import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOutboundFromLine,
  outboundFooterPlainText,
} from "../src/lib/email-outbound-preview.ts";

test("formatOutboundFromLine 与真实 From 头格式一致", () => {
  assert.equal(
    formatOutboundFromLine("测试邮局", "hello@send.example.com"),
    "测试邮局 <hello@send.example.com>",
  );
  assert.equal(
    formatOutboundFromLine("", "hello@send.example.com"),
    "hello@send.example.com",
  );
  assert.equal(formatOutboundFromLine("仅别名", ""), "仅别名");
  assert.equal(formatOutboundFromLine("", ""), null);
});

test("outboundFooterPlainText 结构对齐 appendUnsubscribeFooter", () => {
  const text = outboundFooterPlainText({
    body: "Hello",
    workspaceName: "我的店铺",
    mailingAddress: "上海市测试路 1 号",
  });
  assert.match(text, /^Hello\n\n—\n我的店铺\nContact address/);
  assert.match(text, /联系地址: 上海市测试路 1 号/);
  assert.match(text, /Unsubscribe \/ 退订: （发送时自动生成退订链接）$/);
});
