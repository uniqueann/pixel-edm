import {
  directMailRegionLabels,
  type DeliveryProviderCapabilities,
  type DeliveryProviderName,
} from "./model";
import { directMailRegions, type DirectMailRegion } from "./provider";

export type { DeliveryProviderCapabilities, DeliveryProviderName };

export type DeliveryProviderRecord = {
  provider: DeliveryProviderName;
  display_name: string;
  enabled: boolean;
  sender_alias_max_length: number;
  requires_sender_domain: boolean;
  supports_open_tracking: boolean;
  supports_click_tracking: boolean;
  requires_html_for_tracking: boolean;
  supports_link_tracking_opt_out: boolean;
  requires_webhook_subscription_confirmation: boolean;
  default_rate_per_second: number;
  default_daily_quota: number;
  quota_timezone: string;
};

export type DeliveryChannelSummary = {
  id: string;
  workspace_id: string;
  provider: DeliveryProviderName;
  display_name: string;
  status: "incomplete" | "configured" | "verified" | "error" | "disconnected";
  is_primary: boolean;
  region?: string;
  sender_domain?: string;
  sender_address: string;
  sender_alias: string;
  credential_configured: boolean;
  credential_hint?: string;
  tracking_enabled: boolean;
  version: number;
  updated_at: string;
};

const awsRegionPattern = /^[a-z]{2}(-gov)?-[a-z]+-[0-9]$/;

const providerUiCopy: Record<
  DeliveryProviderName,
  {
    tagline: string;
    credentialIdLabel: string;
    credentialSecretLabel: string;
    acceptedTestLabel: string;
    sandboxNotice?: string;
  }
> = {
  aliyun_directmail: {
    tagline: "每个工作区使用自己的阿里云账号与发件域名。",
    credentialIdLabel: "AccessKey ID",
    credentialSecretLabel: "AccessKey Secret",
    acceptedTestLabel: "DirectMail 已接收",
  },
  amazon_ses: {
    tagline: "每个工作区使用自己的 AWS 账号与 SES 发信身份。",
    credentialIdLabel: "AWS 访问密钥 ID",
    credentialSecretLabel: "AWS 秘密访问密钥",
    acceptedTestLabel: "SES 已接收",
    sandboxNotice:
      "新 SES 账号默认处于沙箱：仅可向已验证邮箱发送，约 200 封/日、1 封/秒。生产权限需单独向 AWS 申请，沙箱限制不是配置错误。",
  },
};

export function mergeProviderRecord(
  record: DeliveryProviderRecord,
): DeliveryProviderRecord & (typeof providerUiCopy)[DeliveryProviderName] {
  return { ...record, ...providerUiCopy[record.provider] };
}

export function directMailRegionLabel(region: string | undefined) {
  if (!region) return "未设置";
  return directMailRegionLabels[region as DirectMailRegion] ?? region;
}

export function regionFieldKind(provider: DeliveryProviderName) {
  return provider === "aliyun_directmail" ? "select" : "text";
}

export function directMailRegionOptions() {
  return directMailRegions.map((region) => ({
    value: region,
    label: directMailRegionLabels[region],
  }));
}

export function validateProviderRegion(
  provider: DeliveryProviderName,
  region: string,
) {
  if (provider === "aliyun_directmail") {
    return (directMailRegions as readonly string[]).includes(region);
  }
  return awsRegionPattern.test(region);
}

export function capabilityRows(
  provider: DeliveryProviderRecord | DeliveryProviderCapabilities,
) {
  const source =
    "supports_open_tracking" in provider && "display_name" in provider
      ? provider
      : provider;
  return [
    {
      label: "打开追踪",
      supported: source.supports_open_tracking,
    },
    {
      label: "点击追踪",
      supported: source.supports_click_tracking,
    },
    {
      label: "追踪需 HTML 正文",
      supported: source.requires_html_for_tracking,
    },
    {
      label: "退订链接免追踪",
      supported: source.supports_link_tracking_opt_out,
    },
    {
      label: "Webhook 订阅握手",
      supported: source.requires_webhook_subscription_confirmation,
    },
  ];
}

export function providerQuotaHint(provider: DeliveryProviderRecord) {
  return `默认限速 ${provider.default_rate_per_second} 封/秒、${provider.default_daily_quota} 封/日（${provider.quota_timezone} 日界）`;
}

export function trackingFieldLabel(provider: DeliveryProviderName) {
  return provider === "aliyun_directmail"
    ? "DirectMail 标签"
    : "SES 配置集名称";
}

export function trackingFieldHelp(provider: DeliveryProviderName) {
  return provider === "aliyun_directmail"
    ? "标签须先在当前阿里云邮件推送账号中创建，仅支持字母、数字和下划线。"
    : "配置集须已在 SES 控制台创建并启用事件发布，仅支持字母、数字、下划线和连字符。";
}

export function trackingDisabledReason(
  capabilities: DeliveryProviderCapabilities,
) {
  if (
    capabilities.supports_open_tracking ||
    capabilities.supports_click_tracking
  ) {
    return null;
  }
  return `${capabilities.display_name} 不支持打开或点击追踪。`;
}
