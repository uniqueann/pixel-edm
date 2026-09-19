export type DeliveryProviderName = "aliyun_directmail" | "amazon_ses";

export type DeliveryErrorCategory =
  | "authentication"
  | "configuration"
  | "rate_limit"
  | "temporary"
  | "permanent"
  | "unknown";

export type DeliveryFailure = {
  status: "failed" | "unknown";
  error_category: DeliveryErrorCategory;
  error_code: string;
};

export type DeliveryCapabilities = {
  supportsOpenTracking: boolean;
  supportsClickTracking: boolean;
  requiresHtmlForTracking: boolean;
  supportsLinkTrackingOptOut: boolean;
  requiresWebhookSubscriptionConfirmation: boolean;
};

export type DeliveryCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  sessionToken?: string;
};

export type DeliverySendInput = {
  credentials: DeliveryCredentials;
  providerConfig: Record<string, unknown>;
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

export type DeliveryReceipt = {
  providerRequestId: string;
  providerAcceptanceId: string;
};

export type NormalizedDeliveryEvent = {
  provider_event_id?: string;
  provider_event_type: string;
  event_type:
    | "delivery_succeeded"
    | "delivery_failed"
    | "fbl_complaint"
    | "provider_unsubscribed"
    | "provider_resubscribed"
    | "opened"
    | "clicked";
  provider_env_id?: string;
  provider_message_id?: string;
  sender_address?: string;
  recipient_email: string;
  provider_status?: string;
  error_code?: string;
  failure_type?: string;
  failure_class?: "hard_bounce" | "soft_bounce" | "complaint" | "undetermined";
  occurred_at: string;
  provider_sent_at?: string;
  region?: string;
};

export type VerifiedWebhook =
  | {
      kind: "notification";
      providerEventId?: string;
      payload: unknown;
    }
  | {
      kind: "subscription_confirmation";
      providerEventId: string;
      subscribeUrl: string;
      topicArn: string;
      payload: unknown;
    };

export type VerifyWebhookInput = {
  requestUrl: string;
  canonicalUrls?: string[];
  headers: Headers;
  rawBody: string;
  providerConfig: Record<string, unknown>;
  fetcher?: typeof fetch;
  now?: number;
};

export type DeliveryAdapter = {
  provider: DeliveryProviderName;
  capabilities: DeliveryCapabilities;
  send(input: DeliverySendInput): Promise<DeliveryReceipt>;
  classifyError(error: unknown): DeliveryFailure;
  parseWebhookEvent(input: VerifiedWebhook): NormalizedDeliveryEvent[];
  verifyWebhookSignature(input: VerifyWebhookInput): Promise<VerifiedWebhook>;
};
