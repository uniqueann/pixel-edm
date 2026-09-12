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
  provider: "directmail";
  requestId: string;
  envId: string;
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
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
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
    async deliver() {
      if (outcome instanceof DeliveryAdapterError) throw outcome;
      return outcome;
    },
  };
}
