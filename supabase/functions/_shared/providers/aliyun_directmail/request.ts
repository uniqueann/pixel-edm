export type DirectMailRequestInput = {
  senderAddress: string;
  senderAlias: string;
  replyToAddress?: string | null;
  recipientEmail: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  trackingTagName?: string;
  headers?: Record<string, string>;
};

export function buildDirectMailRequest(input: DirectMailRequestInput) {
  const trackingEnabled = Boolean(input.trackingTagName);
  if (trackingEnabled && !input.htmlBody)
    throw new Error("TRACKING_HTML_BODY_REQUIRED");
  return {
    accountName: input.senderAddress,
    addressType: 1,
    replyToAddress: Boolean(input.replyToAddress),
    replyAddress: input.replyToAddress || undefined,
    toAddress: input.recipientEmail,
    fromAlias: input.senderAlias,
    subject: input.subject,
    textBody: trackingEnabled ? undefined : input.textBody,
    htmlBody: trackingEnabled ? input.htmlBody : undefined,
    tagName: trackingEnabled ? input.trackingTagName : undefined,
    headers: input.headers ? JSON.stringify(input.headers) : undefined,
    clickTrace: trackingEnabled ? "1" : "0",
    unSubscribeLinkType: "disabled",
    unSubscribeFilterLevel: "disabled",
  };
}
