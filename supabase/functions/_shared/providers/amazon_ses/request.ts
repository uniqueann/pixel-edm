export type SesRequestInput = {
  senderAddress: string;
  senderAlias: string;
  replyToAddress?: string | null;
  recipientEmail: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  trackingEnabled: boolean;
  configurationSetName?: string;
  headers?: Record<string, string>;
};

function encodeDisplayName(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function simpleHeaders(headers?: Record<string, string>) {
  if (!headers) return undefined;
  return Object.entries(headers).map(([name, value]) => {
    if (
      !/^[A-Za-z0-9-]{1,126}$/.test(name) ||
      !value ||
      value.length > 870 ||
      /[\r\n]/.test(value)
    )
      throw new Error("SES_HEADER_INVALID");
    return { Name: name, Value: value };
  });
}

export function buildSesSendEmailInput(input: SesRequestInput) {
  if (input.trackingEnabled && !input.htmlBody)
    throw new Error("TRACKING_HTML_BODY_REQUIRED");
  if (input.trackingEnabled && !input.configurationSetName)
    throw new Error("SES_CONFIGURATION_SET_REQUIRED");

  const headers = simpleHeaders(input.headers);
  return {
    FromEmailAddress: `${encodeDisplayName(input.senderAlias)} <${input.senderAddress}>`,
    Destination: { ToAddresses: [input.recipientEmail] },
    ReplyToAddresses: input.replyToAddress ? [input.replyToAddress] : undefined,
    ConfigurationSetName: input.configurationSetName,
    ConfigurationOverrides: {
      Tracking: {
        OpenTrackingEnabled: input.trackingEnabled ? "ENABLED" : "DISABLED",
        ClickTrackingEnabled: input.trackingEnabled ? "ENABLED" : "DISABLED",
      },
    },
    Content: {
      Simple: {
        Subject: { Charset: "UTF-8", Data: input.subject },
        Body: {
          Text: { Charset: "UTF-8", Data: input.textBody },
          Html: input.htmlBody
            ? { Charset: "UTF-8", Data: input.htmlBody }
            : undefined,
        },
        Headers: headers,
      },
    },
    // 不设置 ListManagementOptions，自建 RFC 8058 退订继续作为唯一事实来源。
  };
}
