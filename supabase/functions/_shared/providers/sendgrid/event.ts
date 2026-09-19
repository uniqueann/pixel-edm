import type { NormalizedDeliveryEvent, VerifiedWebhook } from "../types.ts";

type RecordValue = Record<string, unknown>;

function record(value: unknown, code = "SENDGRID_EVENT_INVALID"): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(code);
  return value as RecordValue;
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recipient(value: unknown) {
  const email = string(value)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254)
    throw new Error("SENDGRID_EVENT_RECIPIENT_INVALID");
  return email;
}

function occurredAt(value: unknown) {
  let seconds: number;
  if (typeof value === "number") seconds = value;
  else if (typeof value === "string" && /^\d+$/.test(value.trim()))
    seconds = Number(value.trim());
  else throw new Error("SENDGRID_EVENT_TIME_INVALID");
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error("SENDGRID_EVENT_TIME_INVALID");
  return new Date(seconds * 1000).toISOString();
}

function failureClassForBounce(event: RecordValue) {
  const bounceType = string(event.type)?.toLowerCase();
  const reason = string(event.reason)?.toLowerCase() ?? "";
  const classification =
    string(event.bounce_classification)?.toLowerCase() ?? "";
  if (
    bounceType === "blocked" ||
    reason.includes("invalid") ||
    classification.includes("invalid")
  )
    return "hard_bounce" as const;
  if (bounceType === "expired") return "soft_bounce" as const;
  if (bounceType === "bounce") {
    if (classification.includes("invalid")) return "hard_bounce" as const;
    return "soft_bounce" as const;
  }
  return "undetermined" as const;
}

function mapEventType(eventName: string) {
  switch (eventName) {
    case "delivered":
      return {
        event_type: "delivery_succeeded" as const,
        providerStatus: "delivered",
      };
    case "bounce":
      return {
        event_type: "delivery_failed" as const,
        providerStatus: "bounce",
      };
    case "dropped":
      return {
        event_type: "delivery_failed" as const,
        providerStatus: "dropped",
      };
    case "spamreport":
      return {
        event_type: "fbl_complaint" as const,
        providerStatus: "spamreport",
        failureClass: "complaint" as const,
      };
    case "unsubscribe":
    case "group_unsubscribe":
      return {
        event_type: "provider_unsubscribed" as const,
        providerStatus: eventName,
      };
    case "group_resubscribe":
      return {
        event_type: "provider_resubscribed" as const,
        providerStatus: eventName,
      };
    case "open":
      return { event_type: "opened" as const, providerStatus: "open" };
    case "click":
      return { event_type: "clicked" as const, providerStatus: "click" };
    case "processed":
    case "deferred":
      return null;
    default:
      throw new Error("SENDGRID_EVENT_TYPE_UNSUPPORTED");
  }
}

function parseSendGridEventItem(raw: unknown): NormalizedDeliveryEvent | null {
  const event = record(raw);
  const eventName = string(event.event)?.toLowerCase();
  if (!eventName) throw new Error("SENDGRID_EVENT_TYPE_UNSUPPORTED");
  const projection = mapEventType(eventName);
  if (!projection) return null;

  const messageId = string(event.sg_message_id);
  if (!messageId || messageId.length > 255)
    throw new Error("SENDGRID_EVENT_MESSAGE_ID_INVALID");
  const providerEventId =
    string(event.sg_event_id) ?? `${messageId}:${eventName}`;
  const email = recipient(event.email);

  let failureClass = projection.failureClass;
  let failureType = string(event.type);
  if (projection.event_type === "delivery_failed") {
    if (eventName === "dropped") {
      failureClass = "hard_bounce";
      failureType = failureType ?? "dropped";
    } else if (eventName === "bounce") {
      failureClass = failureClassForBounce(event);
    }
  }

  return {
    provider_event_id: providerEventId,
    provider_event_type: `sendgrid:${eventName}`,
    event_type: projection.event_type,
    provider_message_id: messageId,
    recipient_email: email,
    provider_status: projection.providerStatus,
    error_code: string(event.reason) ?? string(event.status),
    failure_type: failureType,
    failure_class: failureClass,
    occurred_at: occurredAt(event.timestamp),
  };
}

export function parseSendGridEvent(
  input: VerifiedWebhook,
): NormalizedDeliveryEvent[] {
  if (input.kind !== "notification")
    throw new Error("SENDGRID_EVENT_TYPE_UNSUPPORTED");
  const payload = input.payload;
  const items = Array.isArray(payload) ? payload : [payload];
  if (!items.length) throw new Error("SENDGRID_EVENT_INVALID");
  const normalized: NormalizedDeliveryEvent[] = [];
  for (const item of items) {
    const event = parseSendGridEventItem(item);
    if (event) normalized.push(event);
  }
  return normalized;
}
