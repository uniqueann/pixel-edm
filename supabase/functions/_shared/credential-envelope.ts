export type CredentialEnvelope = {
  key_id: string;
  nonce: string;
  ciphertext: string;
  credential_version: number;
};

export type DeliveryCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  sessionToken?: string;
};

type CredentialContext = {
  workspaceId: string;
  channelId: string;
  credentialVersion: number;
  provider?: "aliyun_directmail" | "amazon_ses" | "sendgrid";
};

type SerializedKeyring = {
  active: string;
  keys: Record<string, string>;
};

function bytesFromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseKeyring(source: string): SerializedKeyring {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("CREDENTIAL_KEYRING_INVALID");
  }
  if (!value || typeof value !== "object")
    throw new Error("CREDENTIAL_KEYRING_INVALID");
  const keyring = value as Partial<SerializedKeyring>;
  if (
    typeof keyring.active !== "string" ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(keyring.active) ||
    !keyring.keys ||
    typeof keyring.keys !== "object" ||
    typeof keyring.keys[keyring.active] !== "string"
  )
    throw new Error("CREDENTIAL_KEYRING_INVALID");
  return keyring as SerializedKeyring;
}

function providerAadSegment(provider?: CredentialContext["provider"]) {
  if (provider === "amazon_ses") return "amazon-ses";
  if (provider === "sendgrid") return "sendgrid";
  return "aliyun-directmail";
}

function additionalData(context: CredentialContext) {
  const provider = providerAadSegment(context.provider);
  return new TextEncoder().encode(
    [
      "pixel-edm",
      provider,
      "v1",
      context.workspaceId,
      context.channelId,
      String(context.credentialVersion),
    ].join(":"),
  );
}

export async function openCredentialEnvelope(input: {
  keyringSource: string;
  context: CredentialContext;
  envelope: CredentialEnvelope;
}): Promise<DeliveryCredentials> {
  const { context, envelope } = input;
  if (envelope.credential_version !== context.credentialVersion)
    throw new Error("CREDENTIAL_VERSION_MISMATCH");
  const keyring = parseKeyring(input.keyringSource);
  const encodedKey = keyring.keys[envelope.key_id];
  if (!encodedKey) throw new Error("CREDENTIAL_KEY_UNAVAILABLE");

  const keyBytes = bytesFromBase64(encodedKey);
  const nonce = bytesFromBase64(envelope.nonce);
  const ciphertext = bytesFromBase64(envelope.ciphertext);
  if (keyBytes.length !== 32 || nonce.length !== 12 || ciphertext.length < 17)
    throw new Error("CREDENTIAL_ENVELOPE_INVALID");

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: additionalData(context),
        tagLength: 128,
      },
      key,
      ciphertext,
    );
  } catch {
    throw new Error("CREDENTIAL_DECRYPT_FAILED");
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("CREDENTIAL_PAYLOAD_INVALID");
  }
  const credentials = value as Partial<DeliveryCredentials>;
  if (!credentials.accessKeyId || !credentials.accessKeySecret)
    throw new Error("CREDENTIAL_PAYLOAD_INVALID");
  if (
    credentials.sessionToken !== undefined &&
    (typeof credentials.sessionToken !== "string" ||
      !credentials.sessionToken.trim())
  )
    throw new Error("CREDENTIAL_PAYLOAD_INVALID");
  return credentials as DeliveryCredentials;
}
