import { z } from "zod";
import { directMailRegions, type DirectMailRegion } from "./provider";

export const deliveryChannelStatuses = [
  "incomplete",
  "configured",
  "verified",
  "error",
  "disconnected",
] as const;

export type DeliveryChannelStatus = (typeof deliveryChannelStatuses)[number];

export const deliveryChannelStatusLabels: Record<
  DeliveryChannelStatus,
  string
> = {
  incomplete: "未完成",
  configured: "已配置，待验证",
  verified: "已验证",
  error: "配置异常",
  disconnected: "已断开",
};

export const directMailRegionLabels: Record<DirectMailRegion, string> = {
  "cn-hangzhou": "中国（杭州）",
  "ap-southeast-1": "新加坡",
  "us-east-1": "美国（弗吉尼亚）",
  "eu-central-1": "德国（法兰克福）",
};

const domainPattern =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const deliveryChannelInput = z
  .object({
    workspace_id: z.string().uuid(),
    id: z.string().uuid().optional(),
    expected_version: z.number().int().positive().optional(),
    region: z.enum(directMailRegions),
    sender_domain: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "请输入发件域名")
      .max(253)
      .regex(domainPattern, "发件域名格式无效"),
    sender_address: z
      .string()
      .trim()
      .toLowerCase()
      .email("发件地址格式无效")
      .max(254),
    sender_alias: z
      .string()
      .trim()
      .min(1, "请输入发件人名称")
      .max(14, "发件人名称最多 14 个字符"),
    reply_to_address: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .refine(
        (value) => !value || z.string().email().safeParse(value).success,
        {
          message: "回复地址格式无效",
        },
      ),
    access_key_id: z.string().trim().max(128).optional(),
    access_key_secret: z.string().max(256).optional(),
  })
  .superRefine((value, context) => {
    if (value.id && value.expected_version === undefined) {
      context.addIssue({
        code: "custom",
        path: ["expected_version"],
        message: "缺少通道版本，请重新加载后重试",
      });
    }
    const senderDomain = value.sender_address.split("@")[1];
    if (senderDomain && senderDomain !== value.sender_domain) {
      context.addIssue({
        code: "custom",
        path: ["sender_address"],
        message: "发件地址必须属于所填发件域名",
      });
    }
    const hasId = Boolean(value.access_key_id);
    const hasSecret = Boolean(value.access_key_secret);
    if (hasId !== hasSecret) {
      context.addIssue({
        code: "custom",
        path: hasId ? ["access_key_secret"] : ["access_key_id"],
        message: "AccessKey ID 和 Secret 必须同时填写",
      });
    }
    if (!value.id && (!hasId || !hasSecret)) {
      context.addIssue({
        code: "custom",
        path: ["access_key_id"],
        message: "首次连接必须填写完整 AccessKey",
      });
    }
    if (hasId && (value.access_key_id?.length ?? 0) < 8) {
      context.addIssue({
        code: "custom",
        path: ["access_key_id"],
        message: "AccessKey ID 长度无效",
      });
    }
    if (hasSecret && (value.access_key_secret?.length ?? 0) < 8) {
      context.addIssue({
        code: "custom",
        path: ["access_key_secret"],
        message: "AccessKey Secret 长度无效",
      });
    }
  });

export type DeliveryChannelInput = z.infer<typeof deliveryChannelInput>;

export type DeliveryChannel = {
  id: string;
  workspace_id: string;
  provider: "aliyun_directmail";
  status: DeliveryChannelStatus;
  region: DirectMailRegion;
  sender_domain: string;
  sender_address: string;
  sender_alias: string;
  reply_to_address?: string;
  credential_configured: boolean;
  access_key_hint?: string;
  credential_version?: number;
  last_verified_at?: string;
  last_error_code?: string;
  disconnected_at?: string;
  created_at: string;
  updated_at: string;
  version: number;
  webhook?: {
    configured: boolean;
    endpoint: string;
    token_hint?: string;
    token_version?: number;
    configured_at?: string;
    last_authenticated_at?: string;
    last_event_at?: string;
    revoked_at?: string;
  };
};

export const deliveryTestStatuses = [
  "pending",
  "processing",
  "accepted",
  "failed",
  "unknown",
] as const;

export type DeliveryTestStatus = (typeof deliveryTestStatuses)[number];

export type DeliveryTestAttempt = {
  id: string;
  workspace_id: string;
  channel_id: string;
  status: DeliveryTestStatus;
  recipient_hint?: string;
  provider_request_hint?: string;
  provider_event_hint?: string;
  error_category?: string;
  error_code?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
};
