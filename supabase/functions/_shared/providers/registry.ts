import type { DeliveryAdapter, DeliveryProviderName } from "./types.ts";

export function isDeliveryProvider(
  value: unknown,
): value is DeliveryProviderName {
  return value === "aliyun_directmail" || value === "amazon_ses";
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
  const { sesAdapter } = await import("./amazon_ses/adapter.ts");
  return sesAdapter;
}
