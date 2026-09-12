import test from "node:test";
import assert from "node:assert/strict";
import { parseDirectMailEvent } from "../supabase/functions/_shared/directmail-event.ts";
import {
  assertEventBridgeCertificateUrl,
  assertEventBridgeTimestamp,
  buildEventBridgeStringToSign,
  readEventBridgeHeaders,
  sha256Hex,
  verifyEventBridgeSignature,
} from "../supabase/functions/_shared/eventbridge-signature.mjs";

test("EventBridge 固定头、时间窗、证书白名单与 RSA-SHA256 签名", async () => {
  const now = 1_777_258_182_789;
  const certificateUrl =
    "https://cn-hangzhou-eventbridge.oss-accelerate.aliyuncs.com/x509_public_certificate_2021012501.pem";
  const headers = new Headers({
    "x-eventbridge-signature-timestamp": String(now),
    "x-eventbridge-hash-method": "SHA256",
    "x-eventbridge-signature-version": "1.0",
    "x-eventbridge-signature-url": certificateUrl,
    "x-eventbridge-signature-token": "one-time-test-token",
    "x-eventbridge-signature-v2": "placeholder",
  });
  const parsedHeaders = readEventBridgeHeaders(headers);
  assertEventBridgeTimestamp(String(now), now + 59_999);
  assert.throws(
    () => assertEventBridgeTimestamp(String(now), now + 60_001),
    /EXPIRED/,
  );
  assert.equal(
    assertEventBridgeCertificateUrl(certificateUrl, "cn-hangzhou").href,
    certificateUrl,
  );
  assert.throws(
    () =>
      assertEventBridgeCertificateUrl(
        "https://cn-hangzhou-eventbridge.oss-accelerate.aliyuncs.com.evil.test/cert.pem",
        "cn-hangzhou",
      ),
    /URL_INVALID/,
  );

  const url =
    "https://example.supabase.co/functions/v1/edm-directmail-events?channel_id=abc";
  const body = '{"id":"event-1"}';
  const stringToSign = buildEventBridgeStringToSign(url, parsedHeaders, body);
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    keys.privateKey,
    new TextEncoder().encode(stringToSign),
  );
  assert.equal(
    await verifyEventBridgeSignature({
      publicKey: keys.publicKey,
      signature: Buffer.from(signature).toString("base64"),
      stringToSign,
    }),
    true,
  );
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("DirectMail 七类事件仅提取安全归一化字段", () => {
  const cases = [
    ["dm:Deliver:Succeed", "delivery_succeeded", { status: "0" }],
    ["dm:Deliver:Fail", "delivery_failed", { status: "2", err_code: "554" }],
    [
      "dm:Feedback:FblReport",
      "fbl_complaint",
      {
        block_email: "USER@example.test",
        send_email: "edm@send.example.test",
        block_time: "1726821667",
      },
    ],
    [
      "dm:Feedback:Subscribe",
      "provider_resubscribed",
      { operate_time: "2026-09-13T10:00:00" },
    ],
    [
      "dm:Feedback:UnSubscribe",
      "provider_unsubscribed",
      { operate_time: "2026-09-13T10:00:00" },
    ],
    ["dm:Trace:Open", "opened", {}],
    ["dm:Trace:Click", "clicked", { url: "https://sensitive.example/path" }],
  ];
  for (const [type, normalized, extra] of cases) {
    const value = parseDirectMailEvent({
      id: `id-${normalized}`,
      source: "acs.dm",
      type,
      time: "2026-09-13T18:00:00+08:00",
      aliyunregionid: "cn-hangzhou",
      data: {
        env_id: "env-1",
        msg_id: "message-1",
        from: "edm@send.example.test",
        rcpt: "USER@example.test",
        send_time: "2026-09-13T17:59:00",
        ...extra,
      },
    });
    assert.equal(value.event_type, normalized);
    assert.equal(value.recipient_email, "user@example.test");
    assert.equal("client_ip" in value, false);
    assert.equal("url" in value, false);
  }
  assert.throws(
    () => parseDirectMailEvent([{ id: "one" }, { id: "two" }]),
    /BATCH_UNSUPPORTED/,
  );
});
