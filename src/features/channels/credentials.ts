import "server-only";
import {
  parseCredentialKeyring,
  sealCredentialPayload,
  type CredentialEnvelope,
} from "./crypto-core";
import type { DeliveryProviderName } from "./registry";

function environmentKeyring() {
  const source = process.env.EDM_CREDENTIAL_KEYRING;
  if (!source) throw new Error("服务器尚未配置 EDM 凭据加密密钥");
  return parseCredentialKeyring(source);
}

export function credentialStorageReady() {
  try {
    environmentKeyring();
    return true;
  } catch {
    return false;
  }
}

export function sealProviderCredentials(input: {
  provider: DeliveryProviderName;
  workspaceId: string;
  channelId: string;
  credentialVersion: number;
  accessKeyId: string;
  accessKeySecret: string;
  sessionToken?: string;
}): CredentialEnvelope {
  return sealCredentialPayload(
    environmentKeyring(),
    {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      credentialVersion: input.credentialVersion,
      provider: input.provider,
    },
    {
      accessKeyId: input.accessKeyId,
      accessKeySecret: input.accessKeySecret,
      ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
    },
  );
}

/** @deprecated 使用 sealProviderCredentials */
export function sealDirectMailCredentials(input: {
  workspaceId: string;
  channelId: string;
  credentialVersion: number;
  accessKeyId: string;
  accessKeySecret: string;
}): CredentialEnvelope {
  return sealProviderCredentials({
    provider: "aliyun_directmail",
    ...input,
  });
}
