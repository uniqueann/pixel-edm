import type { DeliveryAdapter, DeliveryProviderName } from "./types.ts";

export function isDeliveryProvider(
  value: unknown,
): value is DeliveryProviderName {
  return (
    value === "aliyun_directmail" ||
    value === "amazon_ses" ||
    value === "sendgrid"
  );
}

export async function getDeliveryAdapter(
  provider: unknown,
): Promise<DeliveryAdapter> {
  if (!isDeliveryProvider(provider))
    throw new Error("DELIVERY_PROVIDER_UNSUPPORTED");
  if (provider === "aliyun_directmail") {
    const { directMailAdapter } =
      await import("./aliyun_directmail/adapter.ts");
    return directMailAdapter;
  }
  if (provider === "amazon_ses") {
    const { sesAdapter } = await import("./amazon_ses/adapter.ts");
    return sesAdapter;
  }
  const { sendGridAdapter } = await import("./sendgrid/adapter.ts");
  return sendGridAdapter;
}
