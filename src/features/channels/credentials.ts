import "server-only";
import {
  parseCredentialKeyring,
  sealCredentialPayload,
  type CredentialEnvelope,
} from "./crypto-core";

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

export function sealDirectMailCredentials(input: {
  workspaceId: string;
  channelId: string;
  credentialVersion: number;
  accessKeyId: string;
  accessKeySecret: string;
}): CredentialEnvelope {
  return sealCredentialPayload(
    environmentKeyring(),
    {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      credentialVersion: input.credentialVersion,
    },
    {
      accessKeyId: input.accessKeyId,
      accessKeySecret: input.accessKeySecret,
    },
  );
}
