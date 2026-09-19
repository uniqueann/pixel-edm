import type { NormalizedDeliveryEvent } from "../types.ts";

const supportedTypes = {
  "dm:Deliver:Succeed": "delivery_succeeded",
  "dm:Deliver:Fail": "delivery_failed",
  "dm:Feedback:FblReport": "fbl_complaint",
  "dm:Feedback:Subscribe": "provider_resubscribed",
  "dm:Feedback:UnSubscribe": "provider_unsubscribed",
  "dm:Trace:Open": "opened",
  "dm:Trace:Click": "clicked",
} as const;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("DIRECTMAIL_EVENT_INVALID");
  return value as RecordValue;
}

function string(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function timestamp(value: unknown, fallback?: string, defaultSuffix = "Z") {
  const source = string(value) ?? fallback;
  if (!source) throw new Error("DIRECTMAIL_EVENT_TIME_INVALID");
  const zonedSource = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    source,
  )
    ? `${source}${defaultSuffix}`
    : source;
  const numeric = /^\d{10}(?:\.\d+)?$/.test(zonedSource)
    ? new Date(Number(zonedSource) * 1_000)
    : new Date(zonedSource);
  if (Number.isNaN(numeric.getTime()))
    throw new Error("DIRECTMAIL_EVENT_TIME_INVALID");
  return numeric.toISOString();
}

export function parseDirectMailEvent(input: unknown): NormalizedDeliveryEvent {
  if (Array.isArray(input) && input.length !== 1)
    throw new Error("DIRECTMAIL_EVENT_BATCH_UNSUPPORTED");
  const envelope = record(Array.isArray(input) ? input[0] : input);
  const data = record(envelope.data);
  const providerEventType = string(envelope.type);
  const source = string(envelope.source);
  if (
    !providerEventType ||
    !(providerEventType in supportedTypes) ||
    (source !== "acs.dm" && source !== "acs:dm")
  ) {
    throw new Error("DIRECTMAIL_EVENT_TYPE_UNSUPPORTED");
  }
  const recipient =
    string(data.rcpt) ?? string(data.block_email) ?? string(data.email);
  if (
    !recipient ||
    !/^[^\s@]+@[^\s@]+$/.test(recipient) ||
    recipient.length > 254
  )
    throw new Error("DIRECTMAIL_EVENT_RECIPIENT_INVALID");

  const eventFallback = string(envelope.time);
  const eventOffset = eventFallback?.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "Z";
  const occurredSource =
    data.deliver_time ?? data.operate_time ?? data.block_time ?? envelope.time;
  return {
    provider_event_id: string(envelope.id),
    provider_event_type: providerEventType,
    event_type:
      supportedTypes[providerEventType as keyof typeof supportedTypes],
    provider_env_id: string(data.env_id) ?? string(data.envid),
    provider_message_id: string(data.msg_id) ?? string(data.message_id),
    sender_address: (
      string(data.from) ?? string(data.send_email)
    )?.toLowerCase(),
    recipient_email: recipient.toLowerCase(),
    provider_status: string(data.status),
    error_code: string(data.err_code),
    failure_type: string(data.failed_type),
    occurred_at: timestamp(
      occurredSource,
      eventFallback,
      providerEventType.includes("Feedback:") ? "Z" : eventOffset,
    ),
    provider_sent_at: string(data.send_time)
      ? timestamp(data.send_time, undefined, eventOffset)
      : undefined,
    region: string(data.region) ?? string(envelope.aliyunregionid),
  };
}
