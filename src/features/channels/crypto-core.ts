import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type CredentialKeyring = {
  active: string;
  keys: Record<string, Buffer>;
};

export type CredentialEnvelope = {
  key_id: string;
  nonce: string;
  ciphertext: string;
  credential_version: number;
  access_key_hint: string;
};

type CredentialContext = {
  workspaceId: string;
  channelId: string;
  credentialVersion: number;
  provider?: "aliyun_directmail" | "amazon_ses" | "sendgrid";
};

type DeliveryCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  sessionToken?: string;
};

const formatVersion = "v1";

function providerAadSegment(provider?: CredentialContext["provider"]) {
  if (provider === "amazon_ses") return "amazon-ses";
  if (provider === "sendgrid") return "sendgrid";
  return "aliyun-directmail";
}

function additionalData(context: CredentialContext) {
  const provider = providerAadSegment(context.provider);
  return Buffer.from(
    [
      "pixel-edm",
      provider,
      formatVersion,
      context.workspaceId,
      context.channelId,
      String(context.credentialVersion),
    ].join(":"),
    "utf8",
  );
}

export function parseCredentialKeyring(source: string): CredentialKeyring {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("凭据加密密钥环不是有效 JSON");
  }
  if (!value || typeof value !== "object")
    throw new Error("凭据加密密钥环无效");
  const input = value as { active?: unknown; keys?: unknown };
  if (
    typeof input.active !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(input.active)
  )
    throw new Error("凭据加密活动密钥标识无效");
  if (!input.keys || typeof input.keys !== "object")
    throw new Error("凭据加密密钥列表无效");

  const keys: Record<string, Buffer> = {};
  for (const [keyId, encoded] of Object.entries(input.keys)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || typeof encoded !== "string")
      throw new Error("凭据加密密钥项无效");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded)
      throw new Error("凭据加密密钥必须是 32 字节 Base64");
    keys[keyId] = key;
  }
  if (!keys[input.active]) throw new Error("活动加密密钥不存在");
  return { active: input.active, keys };
}

export function sealCredentialPayload(
  keyring: CredentialKeyring,
  context: CredentialContext,
  credentials: DeliveryCredentials,
): CredentialEnvelope {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    keyring.keys[keyring.active],
    nonce,
  );
  cipher.setAAD(additionalData(context));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);
  return {
    key_id: keyring.active,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    credential_version: context.credentialVersion,
    access_key_hint: credentials.accessKeyId.slice(-4),
  };
}

export function openCredentialPayload(
  keyring: CredentialKeyring,
  context: CredentialContext,
  envelope: CredentialEnvelope,
): DeliveryCredentials {
  const key = keyring.keys[envelope.key_id];
  if (!key) throw new Error("凭据使用的加密密钥不可用");
  if (envelope.credential_version !== context.credentialVersion)
    throw new Error("凭据版本不匹配");
  const nonce = Buffer.from(envelope.nonce, "base64");
  const packed = Buffer.from(envelope.ciphertext, "base64");
  if (nonce.length !== 12 || packed.length < 17)
    throw new Error("凭据密文无效");
  const encrypted = packed.subarray(0, -16);
  const tag = packed.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(additionalData(context));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  const value = JSON.parse(plaintext.toString("utf8")) as DeliveryCredentials;
  if (!value.accessKeyId || !value.accessKeySecret)
    throw new Error("凭据内容无效");
  if (
    value.sessionToken !== undefined &&
    (typeof value.sessionToken !== "string" || !value.sessionToken.trim())
  )
    throw new Error("凭据内容无效");
  return value;
}
