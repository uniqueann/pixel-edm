import type { NormalizedDeliveryEvent, VerifiedWebhook } from "../types.ts";

type RecordValue = Record<string, unknown>;

function record(value: unknown, code = "SES_EVENT_INVALID"): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(code);
  return value as RecordValue;
}

function optionalRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.map(string).filter((item): item is string => Boolean(item))
    : [];
}

function timestamp(value: unknown) {
  const source = string(value);
  if (!source) throw new Error("SES_EVENT_TIME_INVALID");
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) throw new Error("SES_EVENT_TIME_INVALID");
  return parsed.toISOString();
}

function recipient(value: unknown) {
  const email = string(value)?.toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254)
    throw new Error("SES_EVENT_RECIPIENT_INVALID");
  return email;
}

function recipientRecords(value: unknown, key: string) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = record(item);
    return { row, email: recipient(row[key]) };
  });
}

function recipientsForEvent(event: RecordValue, mail: RecordValue) {
  const eventType = string(event.eventType ?? event.notificationType);
  if (eventType === "Bounce") {
    const bounce = record(event.bounce);
    return recipientRecords(bounce.bouncedRecipients, "emailAddress");
  }
  if (eventType === "Complaint") {
    const complaint = record(event.complaint);
    return recipientRecords(complaint.complainedRecipients, "emailAddress");
  }
  if (eventType === "Delivery") {
    const delivery = record(event.delivery);
    const values = strings(delivery.recipients);
    return values.map((email) => ({ row: delivery, email: recipient(email) }));
  }
  const values = strings(mail.destination);
  return values.map((email) => ({ row: {}, email: recipient(email) }));
}

function eventProjection(event: RecordValue) {
  const eventType = string(event.eventType ?? event.notificationType);
  if (!eventType) throw new Error("SES_EVENT_TYPE_UNSUPPORTED");
  if (eventType === "Delivery") {
    const detail = record(event.delivery);
    return {
      eventType,
      event_type: "delivery_succeeded" as const,
      detail,
      occurredAt: detail.timestamp,
      providerStatus: "delivered",
    };
  }
  if (eventType === "Bounce") {
    const detail = record(event.bounce);
    const bounceType = string(detail.bounceType) ?? "Undetermined";
    return {
      eventType,
      event_type: "delivery_failed" as const,
      detail,
      occurredAt: detail.timestamp,
      providerStatus: bounceType,
      failureType: string(detail.bounceSubType),
      failureClass:
        bounceType === "Permanent"
          ? ("hard_bounce" as const)
          : bounceType === "Transient"
            ? ("soft_bounce" as const)
            : ("undetermined" as const),
    };
  }
  if (eventType === "Complaint") {
    const detail = record(event.complaint);
    return {
      eventType,
      event_type: "fbl_complaint" as const,
      detail,
      occurredAt: detail.timestamp,
      providerStatus: string(detail.complaintFeedbackType) ?? "complaint",
      failureClass: "complaint" as const,
    };
  }
  if (eventType === "Open" || eventType === "Click") {
    const detail = record(event[eventType.toLowerCase()]);
    return {
      eventType,
      event_type:
        eventType === "Open" ? ("opened" as const) : ("clicked" as const),
      detail,
      occurredAt: detail.timestamp,
      providerStatus: eventType.toLowerCase(),
    };
  }
  if (eventType === "DeliveryDelay") {
    const detail = record(event.deliveryDelay);
    return {
      eventType,
      event_type: "delivery_failed" as const,
      detail,
      occurredAt: detail.timestamp,
      providerStatus: "DeliveryDelay",
      failureType: string(detail.delayType),
      failureClass: "soft_bounce" as const,
    };
  }
  if (eventType === "Reject" || eventType === "Rendering Failure") {
    const detail =
      optionalRecord(event.reject) ??
      optionalRecord(event.failure) ??
      ({} as RecordValue);
    return {
      eventType,
      event_type: "delivery_failed" as const,
      detail,
      occurredAt: detail.timestamp,
      providerStatus: eventType,
      failureType: string(detail.reason),
      failureClass: "undetermined" as const,
    };
  }
  throw new Error("SES_EVENT_TYPE_UNSUPPORTED");
}

export function parseSesEvent(
  input: VerifiedWebhook,
): NormalizedDeliveryEvent[] {
  if (input.kind !== "notification")
    throw new Error("SES_EVENT_TYPE_UNSUPPORTED");
  const event = record(input.payload);
  const mail = record(event.mail);
  const messageId = string(mail.messageId);
  if (!messageId || messageId.length > 255)
    throw new Error("SES_EVENT_MESSAGE_ID_INVALID");
  const sentAt = timestamp(mail.timestamp);
  const senderAddress = string(mail.source)?.toLowerCase();
  const projection = eventProjection(event);
  const occurredAt = timestamp(projection.occurredAt ?? mail.timestamp);
  const recipients = recipientsForEvent(event, mail);
  if (!recipients.length) throw new Error("SES_EVENT_RECIPIENT_INVALID");
  const baseEventId = input.providerEventId ?? messageId;

  return recipients.map(({ row, email }, index) => ({
    provider_event_id:
      recipients.length === 1 ? baseEventId : `${baseEventId}:${index}`,
    provider_event_type: `ses:${projection.eventType}`,
    event_type: projection.event_type,
    // 兼容现有投递尝试匹配列；SES 的值始终是 MessageId，不冒充 EnvId。
    provider_env_id: messageId,
    provider_message_id: messageId,
    sender_address: senderAddress,
    recipient_email: email,
    provider_status: projection.providerStatus,
    error_code:
      string(row.status) ??
      string(row.diagnosticCode) ??
      string(projection.detail.reason),
    failure_type: projection.failureType,
    failure_class: projection.failureClass,
    occurred_at: occurredAt,
    provider_sent_at: sentAt,
  }));
}
