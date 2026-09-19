import { z } from "zod";
import { directMailRegions, type DirectMailRegion } from "./provider";

export type DeliveryProviderName =
  | "aliyun_directmail"
  | "amazon_ses"
  | "sendgrid";

const sendGridDataCenters = ["global", "eu"] as const;

export type DeliveryProviderCapabilities = {
  display_name: string;
  sender_alias_max_length: number;
  requires_sender_domain: boolean;
  supports_open_tracking: boolean;
  supports_click_tracking: boolean;
  requires_html_for_tracking: boolean;
  supports_link_tracking_opt_out: boolean;
  requires_webhook_subscription_confirmation: boolean;
};

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
const awsRegionPattern = /^[a-z]{2}(-gov)?-[a-z]+-[0-9]$/;
const sesConfigSetPattern = /^[A-Za-z0-9_-]+$/;
const snsTopicArnPattern =
  /^arn:(aws|aws-cn|aws-us-gov):sns:[a-z0-9-]+:[0-9]{12}:[A-Za-z0-9_-]+$/;

export function createDeliveryChannelInput(options: {
  provider: DeliveryProviderName;
  senderAliasMaxLength: number;
  requiresSenderDomain: boolean;
}) {
  return z
    .object({
      workspace_id: z.string().uuid(),
      provider: z.enum(["aliyun_directmail", "amazon_ses", "sendgrid"]),
      id: z.string().uuid().optional(),
      expected_version: z.number().int().positive().optional(),
      region: z.string().trim().min(1, "请输入区域"),
      sender_domain: z.string().trim().toLowerCase().max(253),
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
        .max(
          options.senderAliasMaxLength,
          `发件人名称最多 ${options.senderAliasMaxLength} 个字符`,
        ),
      reply_to_address: z
        .string()
        .trim()
        .toLowerCase()
        .max(254)
        .refine(
          (value) => !value || z.string().email().safeParse(value).success,
          { message: "回复地址格式无效" },
        ),
      sns_topic_arn: z.string().trim().max(2048).optional(),
      event_webhook_public_key: z.string().trim().max(8192).optional(),
      access_key_id: z.string().trim().max(128).optional(),
      access_key_secret: z.string().max(512).optional(),
    })
    .superRefine((value, context) => {
      if (value.id && value.expected_version === undefined) {
        context.addIssue({
          code: "custom",
          path: ["expected_version"],
          message: "缺少通道版本，请重新加载后重试",
        });
      }
      if (options.provider === "aliyun_directmail") {
        if (!(directMailRegions as readonly string[]).includes(value.region)) {
          context.addIssue({
            code: "custom",
            path: ["region"],
            message: "阿里云区域无效",
          });
        }
      } else if (options.provider === "sendgrid") {
        if (!(sendGridDataCenters as readonly string[]).includes(value.region)) {
          context.addIssue({
            code: "custom",
            path: ["region"],
            message: "SendGrid 数据中心无效",
          });
        }
      } else if (!awsRegionPattern.test(value.region)) {
        context.addIssue({
          code: "custom",
          path: ["region"],
          message: "AWS 区域格式无效",
        });
      }

      if (options.requiresSenderDomain) {
        if (value.sender_domain.length < 3) {
          context.addIssue({
            code: "custom",
            path: ["sender_domain"],
            message: "请输入发件域名",
          });
        } else if (!domainPattern.test(value.sender_domain)) {
          context.addIssue({
            code: "custom",
            path: ["sender_domain"],
            message: "发件域名格式无效",
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
      }

      if (
        value.sns_topic_arn &&
        !snsTopicArnPattern.test(value.sns_topic_arn)
      ) {
        context.addIssue({
          code: "custom",
          path: ["sns_topic_arn"],
          message: "SNS Topic ARN 格式无效",
        });
      }

      const hasId = Boolean(value.access_key_id);
      const hasSecret = Boolean(value.access_key_secret);
      const credentialLabel =
        options.provider === "amazon_ses"
          ? "AWS 访问密钥"
          : options.provider === "sendgrid"
            ? "API Key"
            : "AccessKey";
      if (options.provider === "sendgrid") {
        if (!value.id && !hasSecret) {
          context.addIssue({
            code: "custom",
            path: ["access_key_secret"],
            message: "首次连接必须填写 SendGrid API Key",
          });
        }
        if (hasSecret && (value.access_key_secret?.length ?? 0) < 20) {
          context.addIssue({
            code: "custom",
            path: ["access_key_secret"],
            message: "API Key 长度无效",
          });
        }
      } else {
        if (hasId !== hasSecret) {
          context.addIssue({
            code: "custom",
            path: hasId ? ["access_key_secret"] : ["access_key_id"],
            message: `${credentialLabel} ID 和 Secret 必须同时填写`,
          });
        }
        if (!value.id && (!hasId || !hasSecret)) {
          context.addIssue({
            code: "custom",
            path: ["access_key_id"],
            message: `首次连接必须填写完整 ${credentialLabel}`,
          });
        }
        if (hasId && (value.access_key_id?.length ?? 0) < 8) {
          context.addIssue({
            code: "custom",
            path: ["access_key_id"],
            message: "访问密钥 ID 长度无效",
          });
        }
        if (hasSecret && (value.access_key_secret?.length ?? 0) < 8) {
          context.addIssue({
            code: "custom",
            path: ["access_key_secret"],
            message: "访问密钥 Secret 长度无效",
          });
        }
      }
    });
}

export type DeliveryChannelInput = z.infer<
  ReturnType<typeof createDeliveryChannelInput>
>;

/** DirectMail 默认校验，供测试与向后兼容 */
export const deliveryChannelInput = createDeliveryChannelInput({
  provider: "aliyun_directmail",
  senderAliasMaxLength: 14,
  requiresSenderDomain: true,
});

export function createDeliveryTrackingInput(provider: DeliveryProviderName) {
  return z
    .object({
      workspace_id: z.string().uuid(),
      channel_id: z.string().uuid(),
      expected_version: z.number().int().positive(),
      tracking_enabled: z.boolean(),
      tracking_tag_name: z.string().trim().max(128),
      configuration_set_name: z.string().trim().max(64),
    })
    .superRefine((value, context) => {
      if (!value.tracking_enabled) return;
      if (provider === "aliyun_directmail") {
        if (!value.tracking_tag_name) {
          context.addIssue({
            code: "custom",
            path: ["tracking_tag_name"],
            message: "开启追踪前请填写阿里云标签",
          });
        } else if (!/^[A-Za-z0-9_]+$/.test(value.tracking_tag_name)) {
          context.addIssue({
            code: "custom",
            path: ["tracking_tag_name"],
            message: "阿里云标签仅支持字母、数字和下划线",
          });
        }
      } else if (provider === "sendgrid") {
        return;
      } else {
        if (!value.configuration_set_name) {
          context.addIssue({
            code: "custom",
            path: ["configuration_set_name"],
            message: "开启追踪前请填写 SES 配置集名称",
          });
        } else if (
          !sesConfigSetPattern.test(value.configuration_set_name) ||
          value.configuration_set_name.length < 1
        ) {
          context.addIssue({
            code: "custom",
            path: ["configuration_set_name"],
            message:
              "SES 配置集名称仅支持 1 至 64 位字母、数字、下划线和连字符",
          });
        }
      }
    });
}

export const deliveryTrackingInput =
  createDeliveryTrackingInput("aliyun_directmail");

export type DeliveryTrackingInput = z.infer<
  ReturnType<typeof createDeliveryTrackingInput>
>;

export type DeliveryChannel = {
  id: string;
  workspace_id: string;
  provider: DeliveryProviderName;
  status: DeliveryChannelStatus;
  region: string;
  provider_config?: Record<string, unknown>;
  is_primary?: boolean;
  sender_domain?: string;
  sender_address: string;
  sender_alias: string;
  reply_to_address?: string;
  credential_configured: boolean;
  credential_hint?: string;
  access_key_hint?: string;
  credential_version?: number;
  tracking_enabled: boolean;
  tracking_tag_name?: string;
  configuration_set_name?: string;
  last_verified_at?: string;
  last_error_code?: string;
  disconnected_at?: string;
  created_at: string;
  updated_at: string;
  version: number;
  capabilities?: DeliveryProviderCapabilities;
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

/** @deprecated 仅 DirectMail E2E 与旧测试使用 */
export type DirectMailRegionLegacy = DirectMailRegion;
