export const directMailRegions = [
  "cn-hangzhou",
  "ap-southeast-1",
  "us-east-1",
  "eu-central-1",
] as const;

export type DirectMailRegion = (typeof directMailRegions)[number];

export type DeliveryRequest = {
  taskId: string;
  from: { address: string; alias: string };
  replyTo?: string;
  to: string;
  subject: string;
  textBody: string;
};

export type DeliveryResult = {
  provider: "aliyun_directmail" | "amazon_ses";
  requestId: string;
  acceptanceId: string;
  acceptedAt: string;
};

export type DeliveryErrorCategory =
  | "authentication"
  | "configuration"
  | "rate_limit"
  | "temporary"
  | "permanent"
  | "unknown";

export type DeliveryAdapter = {
  capabilities: {
    supportsOpenTracking: boolean;
    supportsClickTracking: boolean;
    requiresHtmlForTracking: boolean;
    supportsLinkTrackingOptOut: boolean;
    requiresWebhookSubscriptionConfirmation: boolean;
  };
  send(request: DeliveryRequest): Promise<DeliveryResult>;
  classifyError(error: unknown): DeliveryAdapterError;
  parseWebhookEvent(input: unknown): unknown[];
  verifyWebhookSignature(input: unknown): Promise<boolean>;
};

export class DeliveryAdapterError extends Error {
  readonly category: DeliveryErrorCategory;

  constructor(category: DeliveryErrorCategory, message: string) {
    super(message);
    this.name = "DeliveryAdapterError";
    this.category = category;
  }
}

const directMailEndpoints: Record<DirectMailRegion, string> = {
  "cn-hangzhou": "dm.aliyuncs.com",
  "ap-southeast-1": "dm.ap-southeast-1.aliyuncs.com",
  "us-east-1": "dm.us-east-1.aliyuncs.com",
  "eu-central-1": "dm.eu-central-1.aliyuncs.com",
};

export function directMailEndpointForRegion(region: DirectMailRegion) {
  return directMailEndpoints[region];
}

export function createFakeDeliveryAdapter(
  outcome: DeliveryResult | DeliveryAdapterError,
): DeliveryAdapter {
  return {
    capabilities: {
      supportsOpenTracking: true,
      supportsClickTracking: true,
      requiresHtmlForTracking: true,
      supportsLinkTrackingOptOut: true,
      requiresWebhookSubscriptionConfirmation: false,
    },
    async send() {
      if (outcome instanceof DeliveryAdapterError) throw outcome;
      return outcome;
    },
    classifyError(error) {
      return error instanceof DeliveryAdapterError
        ? error
        : new DeliveryAdapterError("unknown", "未知服务商错误");
    },
    parseWebhookEvent(input) {
      return [input];
    },
    async verifyWebhookSignature() {
      return true;
    },
  };
}
