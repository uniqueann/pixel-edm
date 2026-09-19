export type SendGridRequestInput = {
  senderAddress: string;
  senderAlias: string;
  replyToAddress?: string | null;
  recipientEmail: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  trackingEnabled: boolean;
  headers?: Record<string, string>;
};

export function resolveSendGridApiBaseUrl(apiHost: unknown) {
  const host = typeof apiHost === "string" ? apiHost.trim() : "global";
  if (host === "eu") return "https://api.eu.sendgrid.com";
  if (host === "global") return "https://api.sendgrid.com";
  throw new Error("SENDGRID_API_HOST_INVALID");
}

function mailHeaders(headers?: Record<string, string>) {
  if (!headers) return undefined;
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (
      !/^[A-Za-z0-9-]{1,126}$/.test(name) ||
      !value ||
      value.length > 870 ||
      /[\r\n]/.test(value)
    )
      throw new Error("SENDGRID_HEADER_INVALID");
    result[name] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

export function buildSendGridMailPayload(input: SendGridRequestInput) {
  if (input.trackingEnabled && !input.htmlBody)
    throw new Error("TRACKING_HTML_BODY_REQUIRED");

  const content = [{ type: "text/plain", value: input.textBody }];
  if (input.htmlBody)
    content.push({ type: "text/html", value: input.htmlBody });

  const payload: Record<string, unknown> = {
    personalizations: [
      {
        to: [{ email: input.recipientEmail }],
        subject: input.subject,
      },
    ],
    from: { email: input.senderAddress, name: input.senderAlias },
    content,
  };
  if (input.replyToAddress) payload.reply_to = { email: input.replyToAddress };
  const headers = mailHeaders(input.headers);
  if (headers) payload.headers = headers;
  if (input.trackingEnabled) {
    payload.tracking_settings = {
      click_tracking: { enable: true },
      open_tracking: { enable: true },
    };
  }
  return payload;
}
