import test from "node:test";
import assert from "node:assert/strict";
import {
  openCredentialPayload,
  parseCredentialKeyring,
  sealCredentialPayload,
} from "../src/features/channels/crypto-core.ts";
import {
  createFakeDeliveryAdapter,
  DeliveryAdapterError,
  directMailEndpointForRegion,
} from "../src/features/channels/provider.ts";

const keyA = Buffer.alloc(32, 1).toString("base64");
const keyB = Buffer.alloc(32, 2).toString("base64");
const context = {
  workspaceId: "00000000-0000-0000-0000-000000000001",
  channelId: "10000000-0000-0000-0000-000000000001",
  credentialVersion: 1,
};

test("DirectMail 凭据使用 AES-GCM 加密且可按密钥版本解密", () => {
  const keyring = parseCredentialKeyring(
    JSON.stringify({ active: "key-a", keys: { "key-a": keyA, "key-b": keyB } }),
  );
  const encrypted = sealCredentialPayload(keyring, context, {
    accessKeyId: "test-access-key-id",
    accessKeySecret: "test-access-key-secret",
  });
  assert.equal(encrypted.key_id, "key-a");
  assert.equal(encrypted.credential_version, 1);
  assert.equal(encrypted.access_key_hint, "y-id");
  assert.equal(Buffer.from(encrypted.nonce, "base64").length, 12);
  assert.doesNotMatch(encrypted.ciphertext, /test-access-key/);
  assert.deepEqual(openCredentialPayload(keyring, context, encrypted), {
    accessKeyId: "test-access-key-id",
    accessKeySecret: "test-access-key-secret",
  });
});

test("密文篡改、AAD 变化与错误密钥都会阻止解密", () => {
  const keyring = parseCredentialKeyring(
    JSON.stringify({ active: "key-a", keys: { "key-a": keyA } }),
  );
  const encrypted = sealCredentialPayload(keyring, context, {
    accessKeyId: "test-access-key-id",
    accessKeySecret: "test-access-key-secret",
  });
  const tamperedBytes = Buffer.from(encrypted.ciphertext, "base64");
  tamperedBytes[0] ^= 1;
  assert.throws(() =>
    openCredentialPayload(keyring, context, {
      ...encrypted,
      ciphertext: tamperedBytes.toString("base64"),
    }),
  );
  assert.throws(() =>
    openCredentialPayload(
      keyring,
      { ...context, workspaceId: "00000000-0000-0000-0000-000000000002" },
      encrypted,
    ),
  );
  assert.throws(() =>
    openCredentialPayload(
      parseCredentialKeyring(
        JSON.stringify({ active: "key-a", keys: { "key-a": keyB } }),
      ),
      context,
      encrypted,
    ),
  );
});

test("密钥环拒绝缺失活动密钥和非 32 字节密钥", () => {
  assert.throws(
    () => parseCredentialKeyring('{"active":"missing","keys":{}}'),
    /活动加密密钥不存在/,
  );
  assert.throws(
    () =>
      parseCredentialKeyring(
        JSON.stringify({ active: "short", keys: { short: "YQ==" } }),
      ),
    /32 字节/,
  );
});

test("P4-0 适配器契约固定区域端点并保留明确失败分类", async () => {
  assert.equal(
    directMailEndpointForRegion("ap-southeast-1"),
    "dm.ap-southeast-1.aliyuncs.com",
  );
  const accepted = {
    provider: "directmail",
    requestId: "request-1",
    eventId: "event-1",
    acceptedAt: "2026-09-11T00:00:00.000Z",
  };
  assert.deepEqual(
    await createFakeDeliveryAdapter(accepted).deliver({
      taskId: "task-1",
      from: { address: "hello@send.contentup.cc", alias: "测试邮局" },
      to: "recipient@example.test",
      subject: "测试主题",
      textBody: "测试正文",
    }),
    accepted,
  );
  await assert.rejects(
    createFakeDeliveryAdapter(
      new DeliveryAdapterError("unknown", "结果未知，不可自动重试"),
    ).deliver({
      taskId: "task-2",
      from: { address: "hello@send.contentup.cc", alias: "测试邮局" },
      to: "recipient@example.test",
      subject: "测试主题",
      textBody: "测试正文",
    }),
    (error) => error.category === "unknown",
  );
});
