import {
  buildDirectMailRequest,
  type DirectMailRequestInput,
} from "./providers/aliyun_directmail/request.ts";
import {
  classifyDirectMailError,
  sendDirectMail,
} from "./providers/aliyun_directmail/adapter.ts";

export { buildDirectMailRequest, classifyDirectMailError };

export type DirectMailMessageInput = DirectMailRequestInput & {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
};

export async function sendDirectMailMessage(input: DirectMailMessageInput) {
  const receipt = await sendDirectMail({
    credentials: {
      accessKeyId: input.accessKeyId,
      accessKeySecret: input.accessKeySecret,
    },
    providerConfig: {
      region: input.region,
      tracking_tag_name: input.trackingTagName,
    },
    senderAddress: input.senderAddress,
    senderAlias: input.senderAlias,
    replyToAddress: input.replyToAddress,
    recipientEmail: input.recipientEmail,
    subject: input.subject,
    textBody: input.textBody,
    htmlBody: input.htmlBody,
    trackingEnabled: Boolean(input.trackingTagName),
    headers: input.headers,
  });
  return {
    requestId: receipt.providerRequestId,
    envId: receipt.providerAcceptanceId,
  };
}

export async function sendDirectMailTest(
  input: Omit<
    Parameters<typeof sendDirectMailMessage>[0],
    "subject" | "textBody"
  >,
) {
  return sendDirectMailMessage({
    ...input,
    subject: "[卖家邮局] DirectMail 发信通道测试",
    textBody:
      "这是一封由卖家邮局发送的 DirectMail 通道测试邮件。收到此邮件表示 AccessKey、区域与发件身份已通过实际发送验证。",
  });
}
