import test from "node:test";
import assert from "node:assert/strict";
import { buildSesSendEmailInput } from "../supabase/functions/_shared/providers/amazon_ses/request.ts";
import { parseSesEvent } from "../supabase/functions/_shared/providers/amazon_ses/event.ts";
import {
  assertSnsCertificateUrl,
  assertSnsSubscribeUrl,
  assertSnsTimestamp,
  assertSnsTopicArn,
  buildSnsStringToSign,
  parseSnsEnvelope,
} from "../supabase/functions/_shared/providers/amazon_ses/sns-signature.ts";
import { renderTrackedHtmlBody } from "../supabase/functions/_shared/unsubscribe-token.ts";
import {
  openCredentialPayload,
  parseCredentialKeyring,
  sealCredentialPayload,
} from "../src/features/channels/crypto-core.ts";
import { openCredentialEnvelope } from "../supabase/functions/_shared/credential-envelope.ts";

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

test("P8-2 SES v2 请求显式控制追踪且不启用厂商列表管理", () => {
  const request = buildSesSendEmailInput({
    ...baseRequest,
    htmlBody: "<p>HTML 内容</p>",
    trackingEnabled: true,
    configurationSetName: "pixel-edm",
  });
  assert.deepEqual(request.Destination.ToAddresses, ["customer@example.test"]);
  assert.match(request.FromEmailAddress, /^=\?UTF-8\?B\?/);
  assert.equal(request.ConfigurationSetName, "pixel-edm");
  assert.deepEqual(request.ConfigurationOverrides.Tracking, {
    OpenTrackingEnabled: true,
    ClickTrackingEnabled: true,
  });
  assert.equal(request.Content.Simple.Body.Text.Data, "纯文本内容");
  assert.equal(request.Content.Simple.Body.Html.Data, "<p>HTML 内容</p>");
  assert.deepEqual(
    request.Content.Simple.Headers.map((header) => header.Name),
    ["List-Unsubscribe", "List-Unsubscribe-Post"],
  );
  assert.equal("ListManagementOptions" in request, false);

  assert.throws(
    () =>
      buildSesSendEmailInput({
        ...baseRequest,
        htmlBody: "<p>HTML 内容</p>",
        trackingEnabled: true,
      }),
    /CONFIGURATION_SET_REQUIRED/,
  );
  assert.throws(
    () =>
      buildSesSendEmailInput({
        ...baseRequest,
        trackingEnabled: true,
        configurationSetName: "pixel-edm",
      }),
    /HTML_BODY_REQUIRED/,
  );
});

test("P8-2 SES 退订链接使用 ses:no-track，DirectMail 标记保持不变", () => {
  const input = {
    body: "正文",
    workspaceName: "测试邮局",
    mailingAddress: "示例地址",
    pageUrl: "https://example.test/unsubscribe/token",
  };
  const ses = renderTrackedHtmlBody({ ...input, provider: "amazon_ses" });
  assert.match(ses, /ses:no-track/);
  assert.doesNotMatch(ses, /data-alidm-traceoff/);
  const directMail = renderTrackedHtmlBody(input);
  assert.match(directMail, /data-alidm-traceoff/);
  assert.doesNotMatch(directMail, /ses:no-track/);
});

test("P8-2 SNS 只接受指定区域、Topic、时间窗与 SignatureVersion 2", () => {
  const now = Date.parse("2026-09-19T03:00:00.000Z");
  const envelope = parseSnsEnvelope({
    Type: "Notification",
    MessageId: "sns-message-1",
    TopicArn: "arn:aws:sns:us-east-1:123456789012:pixel-edm",
    Message: '{"eventType":"Delivery"}',
    Timestamp: "2026-09-19T03:00:00.000Z",
    SignatureVersion: "2",
    Signature: "c2lnbmF0dXJl",
    SigningCertURL:
      "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc123.pem",
  });
  assertSnsTimestamp(envelope.Timestamp, now + 299_999);
  assert.throws(
    () => assertSnsTimestamp(envelope.Timestamp, now + 300_001),
    /EXPIRED/,
  );
  assert.equal(
    assertSnsCertificateUrl(envelope.SigningCertURL, "us-east-1").hostname,
    "sns.us-east-1.amazonaws.com",
  );
  assert.throws(
    () =>
      assertSnsCertificateUrl(
        "https://sns.us-east-1.amazonaws.com.evil.test/SimpleNotificationService-abc123.pem",
        "us-east-1",
      ),
    /URL_INVALID/,
  );
  assertSnsTopicArn(
    envelope.TopicArn,
    "arn:aws:sns:us-east-1:123456789012:pixel-edm",
  );
  assert.throws(
    () =>
      assertSnsTopicArn(
        envelope.TopicArn,
        "arn:aws:sns:us-east-1:123456789012:other",
      ),
    /MISMATCH/,
  );
  assert.equal(
    buildSnsStringToSign(envelope),
    [
      "Message",
      '{"eventType":"Delivery"}',
      "MessageId",
      "sns-message-1",
      "Timestamp",
      "2026-09-19T03:00:00.000Z",
      "TopicArn",
      "arn:aws:sns:us-east-1:123456789012:pixel-edm",
      "Type",
      "Notification",
      "",
    ].join("\n"),
  );
});

test("P8-2 SNS 订阅确认 URL 必须指向同区域 AWS ConfirmSubscription", () => {
  const source =
    "https://sns.us-west-2.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn%3Aaws%3Asns%3Aus-west-2%3A123456789012%3Apixel-edm&Token=token";
  assert.equal(
    assertSnsSubscribeUrl(source, "us-west-2").searchParams.get("Action"),
    "ConfirmSubscription",
  );
  assert.throws(
    () =>
      assertSnsSubscribeUrl(
        "https://sns.us-west-2.amazonaws.com.evil.test/?Action=ConfirmSubscription&TopicArn=x&Token=y",
        "us-west-2",
      ),
    /URL_INVALID/,
  );
});

function notification(providerEventId, payload) {
  return {
    kind: "notification",
    providerEventId,
    payload,
  };
}

function mail() {
  return {
    timestamp: "2026-09-19T03:00:00.000Z",
    messageId: "ses-message-1",
    source: "hello@send.example.test",
    destination: ["customer@example.test"],
  };
}

test("P8-2 SES 回执按 MessageId 归一化送达、退信、投诉、打开与点击", () => {
  const cases = [
    [
      "delivery",
      {
        eventType: "Delivery",
        mail: mail(),
        delivery: {
          timestamp: "2026-09-19T03:01:00.000Z",
          recipients: ["customer@example.test"],
        },
      },
      "delivery_succeeded",
      undefined,
    ],
    [
      "hard",
      {
        eventType: "Bounce",
        mail: mail(),
        bounce: {
          timestamp: "2026-09-19T03:01:00.000Z",
          bounceType: "Permanent",
          bounceSubType: "Suppressed",
          bouncedRecipients: [
            {
              emailAddress: "customer@example.test",
              status: "5.1.1",
              diagnosticCode: "smtp; 550 user unknown",
            },
          ],
        },
      },
      "delivery_failed",
      "hard_bounce",
    ],
    [
      "soft",
      {
        eventType: "Bounce",
        mail: mail(),
        bounce: {
          timestamp: "2026-09-19T03:01:00.000Z",
          bounceType: "Transient",
          bounceSubType: "MailboxFull",
          bouncedRecipients: [
            { emailAddress: "customer@example.test", status: "4.2.2" },
          ],
        },
      },
      "delivery_failed",
      "soft_bounce",
    ],
    [
      "complaint",
      {
        eventType: "Complaint",
        mail: mail(),
        complaint: {
          timestamp: "2026-09-19T03:01:00.000Z",
          complaintFeedbackType: "abuse",
          complainedRecipients: [{ emailAddress: "customer@example.test" }],
        },
      },
      "fbl_complaint",
      "complaint",
    ],
    [
      "open",
      {
        eventType: "Open",
        mail: mail(),
        open: { timestamp: "2026-09-19T03:01:00.000Z" },
      },
      "opened",
      undefined,
    ],
    [
      "click",
      {
        eventType: "Click",
        mail: mail(),
        click: {
          timestamp: "2026-09-19T03:01:00.000Z",
          link: "https://sensitive.example/path",
        },
      },
      "clicked",
      undefined,
    ],
  ];

  for (const [id, payload, eventType, failureClass] of cases) {
    const [event] = parseSesEvent(notification(`sns-${id}`, payload));
    assert.equal(event.event_type, eventType);
    assert.equal(event.failure_class, failureClass);
    assert.equal(event.provider_message_id, "ses-message-1");
    assert.equal(event.provider_env_id, "ses-message-1");
    assert.equal(event.recipient_email, "customer@example.test");
    assert.equal("link" in event, false);
  }
});

test("P8-2 SES 多收件人 SNS 回执拆分稳定事件 ID", () => {
  const events = parseSesEvent(
    notification("sns-batch", {
      eventType: "Bounce",
      mail: {
        ...mail(),
        destination: ["one@example.test", "two@example.test"],
      },
      bounce: {
        timestamp: "2026-09-19T03:01:00.000Z",
        bounceType: "Permanent",
        bouncedRecipients: [
          { emailAddress: "one@example.test", status: "5.1.1" },
          { emailAddress: "two@example.test", status: "5.1.1" },
        ],
      },
    }),
  );
  assert.deepEqual(
    events.map((event) => [event.provider_event_id, event.recipient_email]),
    [
      ["sns-batch:0", "one@example.test"],
      ["sns-batch:1", "two@example.test"],
    ],
  );
});

test("P8-2 凭据 AAD 隔离 provider，既有 DirectMail 信封保持兼容", async () => {
  const source = JSON.stringify({
    active: "key-a",
    keys: { "key-a": Buffer.alloc(32, 7).toString("base64") },
  });
  const keyring = parseCredentialKeyring(source);
  const baseContext = {
    workspaceId: "00000000-0000-0000-0000-000000000001",
    channelId: "10000000-0000-0000-0000-000000000001",
    credentialVersion: 1,
  };
  const credentials = {
    accessKeyId: "test-access-key-id",
    accessKeySecret: "test-access-key-secret",
  };
  const directMailEnvelope = sealCredentialPayload(
    keyring,
    baseContext,
    credentials,
  );
  assert.deepEqual(
    await openCredentialEnvelope({
      keyringSource: source,
      context: baseContext,
      envelope: directMailEnvelope,
    }),
    credentials,
  );

  const sesContext = { ...baseContext, provider: "amazon_ses" };
  const sesEnvelope = sealCredentialPayload(keyring, sesContext, credentials);
  assert.deepEqual(
    openCredentialPayload(keyring, sesContext, sesEnvelope),
    credentials,
  );
  await assert.rejects(
    openCredentialEnvelope({
      keyringSource: source,
      context: baseContext,
      envelope: sesEnvelope,
    }),
    /DECRYPT_FAILED/,
  );
});
