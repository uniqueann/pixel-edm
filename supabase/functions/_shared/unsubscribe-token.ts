const TOKEN_PREFIX = "pixel-edm:unsubscribe:v1:";
const TOKEN_LIMIT = 512;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Keyring = {
  active: string;
  keys: Record<string, string>;
};

export type UnsubscribeTokenClaims = {
  version: 1;
  purpose: "unsubscribe";
  keyId: string;
  taskId: string;
};

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (standard.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(standard + padding);
  } catch {
    throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  }
  const result = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  );
  if (encodeBase64Url(result) !== value)
    throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  return result;
}

function parseKeyring(source: string): Keyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("UNSUBSCRIBE_KEYRING_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("UNSUBSCRIBE_KEYRING_INVALID");
  const candidate = parsed as Partial<Keyring>;
  if (!candidate.active || !KEY_ID_PATTERN.test(candidate.active))
    throw new Error("UNSUBSCRIBE_KEYRING_INVALID");
  if (
    !candidate.keys ||
    typeof candidate.keys !== "object" ||
    Array.isArray(candidate.keys)
  )
    throw new Error("UNSUBSCRIBE_KEYRING_INVALID");
  for (const [keyId, encodedKey] of Object.entries(candidate.keys)) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof encodedKey !== "string")
      throw new Error("UNSUBSCRIBE_KEYRING_INVALID");
    let keyBytes: Uint8Array;
    try {
      keyBytes = Uint8Array.from(atob(encodedKey), (character) =>
        character.charCodeAt(0),
      );
    } catch {
      throw new Error("UNSUBSCRIBE_KEYRING_INVALID");
    }
    if (keyBytes.byteLength !== 32)
      throw new Error("UNSUBSCRIBE_KEYRING_INVALID");
  }
  if (!candidate.keys[candidate.active])
    throw new Error("UNSUBSCRIBE_KEYRING_INVALID");
  return candidate as Keyring;
}

async function importKey(encodedKey: string) {
  const bytes = Uint8Array.from(atob(encodedKey), (character) =>
    character.charCodeAt(0),
  );
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signingBytes(payloadPart: string) {
  return new TextEncoder().encode(TOKEN_PREFIX + payloadPart);
}

export async function signUnsubscribeToken(input: {
  keyringSource: string;
  taskId: string;
}) {
  if (!UUID_PATTERN.test(input.taskId))
    throw new Error("UNSUBSCRIBE_TASK_INVALID");
  const keyring = parseKeyring(input.keyringSource);
  const payload = {
    v: 1,
    p: "unsubscribe",
    k: keyring.active,
    t: input.taskId.toLowerCase(),
  };
  const payloadPart = encodeBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importKey(keyring.keys[keyring.active]),
    signingBytes(payloadPart),
  );
  return `${payloadPart}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyUnsubscribeToken(input: {
  keyringSource: string;
  token: string;
}): Promise<UnsubscribeTokenClaims> {
  if (!input.token || input.token.length > TOKEN_LIMIT)
    throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  const parts = input.token.split(".");
  if (parts.length !== 2) throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  const [payloadPart, signaturePart] = parts;
  const keyring = parseKeyring(input.keyringSource);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart)));
  } catch {
    throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  const payload = parsed as Record<string, unknown>;
  if (
    Object.keys(payload).sort().join(",") !== "k,p,t,v" ||
    payload.v !== 1 ||
    payload.p !== "unsubscribe" ||
    typeof payload.k !== "string" ||
    !KEY_ID_PATTERN.test(payload.k) ||
    typeof payload.t !== "string" ||
    !UUID_PATTERN.test(payload.t)
  )
    throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  const encodedKey = keyring.keys[payload.k];
  if (!encodedKey) throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  const signature = decodeBase64Url(signaturePart);
  if (signature.byteLength !== 32) throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await importKey(encodedKey),
    signature,
    signingBytes(payloadPart),
  );
  if (!valid) throw new Error("UNSUBSCRIBE_TOKEN_INVALID");
  return {
    version: 1,
    purpose: "unsubscribe",
    keyId: payload.k,
    taskId: payload.t.toLowerCase(),
  };
}

export function unsubscribeUrls(siteUrl: string, token: string) {
  let origin: URL;
  try {
    origin = new URL(siteUrl);
  } catch {
    throw new Error("UNSUBSCRIBE_SITE_URL_INVALID");
  }
  const local =
    origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  if (
    (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("UNSUBSCRIBE_SITE_URL_INVALID");
  const encodedToken = encodeURIComponent(token);
  return {
    pageUrl: `${origin.origin}/unsubscribe/${encodedToken}`,
    oneClickUrl: `${origin.origin}/api/unsubscribe/${encodedToken}`,
  };
}

export function appendUnsubscribeFooter(input: {
  body: string;
  workspaceName: string;
  mailingAddress: string;
  pageUrl: string;
}) {
  const workspaceName = input.workspaceName.replace(/[\r\n]+/g, " ").trim();
  const mailingAddress = input.mailingAddress.replace(/[\r\n]+/g, " ").trim();
  if (!workspaceName || !mailingAddress)
    throw new Error("UNSUBSCRIBE_SENDER_INVALID");
  return `${input.body.trimEnd()}\n\n—\n${workspaceName}\nContact address / 联系地址: ${mailingAddress}\nUnsubscribe / 退订: ${input.pageUrl}`;
}

export function unsubscribeHeaders(oneClickUrl: string) {
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
