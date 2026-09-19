import test from "node:test";
import assert from "node:assert/strict";
import { Ecdsa, PrivateKey } from "starkbank-ecdsa";
import {
  buildSendGridMailPayload,
  resolveSendGridApiBaseUrl,
} from "../supabase/functions/_shared/providers/sendgrid/request.ts";
import { parseSendGridEvent } from "../supabase/functions/_shared/providers/sendgrid/event.ts";
import { classifySendGridError } from "../supabase/functions/_shared/providers/sendgrid/error.ts";
import {
  verifySendGridWebhookSignature,
  verifySendGridWebhook,
} from "../supabase/functions/_shared/providers/sendgrid/webhook.ts";
import { renderTrackedHtmlBody } from "../supabase/functions/_shared/unsubscribe-token.ts";

const baseRequest = {
  senderAddress: "hello@send.example.test",
  senderAlias: "测试邮局",
  replyToAddress: "reply@example.test",
  recipientEmail: "customer@example.test",
  subject: "测试主题",
  textBody: "纯文本内容",
  headers: {
    "List-Unsubscribe": "<https://example.test/api/unsubscribe/token>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
};

test("P9-2 SendGrid Mail Send 请求体与数据中心", () => {
  assert.equal(resolveSendGridApiBaseUrl("global"), "https://api.sendgrid.com");
  assert.equal(resolveSendGridApiBaseUrl("eu"), "https://api.eu.sendgrid.com");
  assert.throws(() => resolveSendGridApiBaseUrl("us"), /API_HOST_INVALID/);

  const payload = buildSendGridMailPayload({
    ...baseRequest,
    htmlBody: "<p>HTML</p>",
    trackingEnabled: true,
  });
  assert.deepEqual(payload.personalizations[0].to, [
    { email: "customer@example.test" },
  ]);
  assert.equal(payload.from.email, "hello@send.example.test");
  assert.equal(payload.tracking_settings.click_tracking.enable, true);
  assert.equal(payload.content.length, 2);
  assert.throws(
    () => buildSendGridMailPayload({ ...baseRequest, trackingEnabled: true }),
    /HTML_BODY_REQUIRED/,
  );
});

test("P9-2 SendGrid 错误分类", () => {
  assert.equal(
    classifySendGridError({ name: "SendGridHttpError", status: 401 })
      .error_category,
    "authentication",
  );
  assert.equal(
    classifySendGridError({ name: "SendGridHttpError", status: 422 })
      .error_category,
    "configuration",
  );
  assert.equal(
    classifySendGridError({ name: "SendGridHttpError", status: 429 })
      .error_category,
    "rate_limit",
  );
  assert.equal(
    classifySendGridError({ name: "SendGridHttpError", status: 503 })
      .error_category,
    "temporary",
  );
});

test("P9-2 SendGrid 事件映射与丢弃 processed", () => {
  const delivered = parseSendGridEvent({
    kind: "notification",
    payload: [
      {
        event: "delivered",
        email: "User@Example.test",
        timestamp: 1_700_000_000,
        sg_message_id: "abc.filter.123",
        sg_event_id: "evt-delivered",
      },
    ],
  });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].event_type, "delivery_succeeded");
  assert.equal(delivered[0].recipient_email, "user@example.test");
  assert.equal(delivered[0].provider_message_id, "abc.filter.123");

  const skipped = parseSendGridEvent({
    kind: "notification",
    payload: [
      { event: "processed", email: "a@b.co", timestamp: 1, sg_message_id: "x" },
    ],
  });
  assert.equal(skipped.length, 0);

  const bounce = parseSendGridEvent({
    kind: "notification",
    payload: [
      {
        event: "bounce",
        email: "bad@example.test",
        timestamp: 1_700_000_001,
        sg_message_id: "msg-bounce",
        sg_event_id: "evt-bounce",
        type: "blocked",
        reason: "550 invalid",
      },
    ],
  });
  assert.equal(bounce[0].failure_class, "hard_bounce");

  const resubscribe = parseSendGridEvent({
    kind: "notification",
    payload: [
      {
        event: "group_resubscribe",
        email: "u@example.test",
        timestamp: 2,
        sg_message_id: "msg-r",
        sg_event_id: "evt-r",
      },
    ],
  });
  assert.equal(resubscribe[0].event_type, "provider_resubscribed");
});

test("P9-2 SendGrid Signed Webhook 验签", async () => {
  const privateKey = new PrivateKey();
  const publicPem = privateKey.publicKey().toPem();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify([
    {
      event: "open",
      email: "open@example.test",
      timestamp: Number(timestamp),
      sg_message_id: "msg-open",
      sg_event_id: "evt-open",
    },
  ]);
  const signature = Ecdsa.sign(`${timestamp}${rawBody}`, privateKey).toBase64();

  await verifySendGridWebhookSignature({
    publicKeyPem: publicPem,
    rawBody,
    signature,
    timestamp,
    now: Date.now(),
  });

  const headers = new Headers({
    "x-twilio-email-event-webhook-signature": signature,
    "x-twilio-email-event-webhook-timestamp": timestamp,
  });
  const verified = await verifySendGridWebhook({
    requestUrl: "https://example.test/edm-sendgrid-events",
    headers,
    rawBody,
    providerConfig: { event_webhook_public_key: publicPem },
  });
  const events = parseSendGridEvent(verified);
  assert.equal(events[0].event_type, "opened");

  await assert.rejects(
    () =>
      verifySendGridWebhookSignature({
        publicKeyPem: publicPem,
        rawBody,
        signature: "AAAA",
        timestamp,
        now: Date.now(),
      }),
    /SIGNATURE_INVALID/,
  );
});

test("P9-2 SendGrid 退订链接禁用点击追踪", () => {
  const html = renderTrackedHtmlBody({
    body: "正文",
    workspaceName: "测试邮局",
    mailingAddress: "示例地址",
    pageUrl: "https://example.test/unsubscribe/token",
    provider: "sendgrid",
  });
  assert.match(html, /clicktracking="off"/);
  assert.doesNotMatch(html, /ses:no-track/);
});
