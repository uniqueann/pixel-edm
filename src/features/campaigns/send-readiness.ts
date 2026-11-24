/** 正式发送前置检查：仅复用 start_campaign_delivery 已有的校验条件，不新增规则。 */

/** 与 `features/settings/anchors` 中锚点 id 保持一致（供 Node 单测直接加载本模块）。 */
const settingsLinks = {
  channels: "/settings#settings-channels",
  store: "/settings#settings-store",
  billing: "/settings#settings-billing",
} as const;

export type SendReadinessChannel = {
  provider?: string;
  display_name: string;
  status: string;
  sender_address: string;
  credential_configured: boolean;
};

export type SendReadinessQuota = {
  daily_send_quota: number;
  usage_today: number;
  quota_timezone: string;
};

export type SendReadinessContext = {
  /** 当前主通道；没有主通道时为 null。 */
  primaryChannel: SendReadinessChannel | null;
  mailingAddress: string;
  /** 无法读取套餐时为 null，此时额度项交由提交时校验。 */
  quota: SendReadinessQuota | null;
  maxRecipientsPerCampaign: number;
};

export type SendReadinessItem = {
  key: "channel" | "sender" | "footer" | "quota" | "recipients";
  label: string;
  ok: boolean;
  detail: string;
  href?: string;
  linkLabel?: string;
};

export type SendReadiness = { items: SendReadinessItem[]; ready: boolean };

export type SendReadinessMessages = {
  channelName: (channel: SendReadinessChannel) => string;
  channelLabel: string;
  channelMissing: string;
  channelVerified: (name: string) => string;
  channelMissingCredential: (name: string) => string;
  channelNotVerified: (name: string, status: string) => string;
  channelStatusLabel: (status: string) => string;
  goToChannels: string;
  senderLabel: string;
  senderMissing: string;
  footerLabel: string;
  footerMissing: string;
  goToStore: string;
  quotaLabel: string;
  quotaOk: (
    used: number,
    limit: number,
    remaining: number,
    reset: string,
  ) => string;
  quotaInsufficient: (
    used: number,
    limit: number,
    remaining: number,
    needed: number,
    reset: string,
  ) => string;
  quotaUnavailable: string;
  quotaResetNote: (timezone: string) => string;
  viewPlan: string;
  recipientsLabel: string;
  recipientsEmpty: string;
  recipientsOk: (count: number, max: number) => string;
  recipientsExceeded: (count: number, max: number) => string;
};

const channelStatusLabels: Record<string, string> = {
  incomplete: "配置未完成",
  configured: "已配置，尚未验证",
  error: "验证出错",
  disconnected: "已断开",
};

const defaultZhMessages: SendReadinessMessages = {
  channelName: (channel) => channel.display_name,
  channelLabel: "主发信通道",
  channelMissing: "尚未设置主发信通道",
  channelVerified: (name) => `${name}已验证`,
  channelMissingCredential: (name) => `${name}凭据不存在，请重新保存凭据`,
  channelNotVerified: (name, status) => `${name}${status}，请先连接并验证`,
  channelStatusLabel: (status) => channelStatusLabels[status] ?? "尚未验证",
  goToChannels: "前往发信通道",
  senderLabel: "发件地址",
  senderMissing: "主通道尚未填写发件地址",
  footerLabel: "页脚联系地址",
  footerMissing: "尚未填写邮件页脚实体地址，正式邮件无法发出",
  goToStore: "前往店铺信息",
  quotaLabel: "今日剩余额度",
  quotaOk: (used, limit, remaining, reset) =>
    `今日已用 ${used} / ${limit} 封，剩余 ${remaining} 封（${reset}）`,
  quotaInsufficient: (used, limit, remaining, needed, reset) =>
    `今日已用 ${used} / ${limit} 封，剩余 ${remaining} 封，本次需要 ${needed} 封；${reset}，或升级套餐`,
  quotaUnavailable: "暂时无法读取今日额度，提交时将由系统校验",
  quotaResetNote: (timezone) =>
    timezone === "Asia/Shanghai" ? "北京时间每日 00:00 重置" : "次日重置",
  viewPlan: "查看套餐",
  recipientsLabel: "收件人数",
  recipientsEmpty: "名单中没有收件人",
  recipientsOk: (count, max) => `${count} 位，未超过套餐单活动上限 ${max}`,
  recipientsExceeded: (count, max) => `${count} 位，超过套餐单活动上限 ${max}`,
};

export function evaluateSendReadiness(
  context: SendReadinessContext,
  recipientCount: number,
  messages: SendReadinessMessages = defaultZhMessages,
): SendReadiness {
  const channel = context.primaryChannel;
  const items: SendReadinessItem[] = [];

  const channelVerified =
    channel !== null &&
    channel.status === "verified" &&
    channel.credential_configured;
  const displayName = channel ? messages.channelName(channel) : "";
  items.push({
    key: "channel",
    label: messages.channelLabel,
    ok: channelVerified,
    detail:
      channel === null
        ? messages.channelMissing
        : channelVerified
          ? messages.channelVerified(displayName)
          : channel.status === "verified"
            ? messages.channelMissingCredential(displayName)
            : messages.channelNotVerified(
                displayName,
                messages.channelStatusLabel(channel.status),
              ),
    ...(channelVerified
      ? {}
      : {
          href: settingsLinks.channels,
          linkLabel: messages.goToChannels,
        }),
  });

  const senderAddress = channel?.sender_address.trim() ?? "";
  items.push({
    key: "sender",
    label: messages.senderLabel,
    ok: senderAddress.length > 0,
    detail: senderAddress.length > 0 ? senderAddress : messages.senderMissing,
    ...(senderAddress.length > 0
      ? {}
      : {
          href: settingsLinks.channels,
          linkLabel: messages.goToChannels,
        }),
  });

  const footerAddress = context.mailingAddress.trim();
  items.push({
    key: "footer",
    label: messages.footerLabel,
    ok: footerAddress.length > 0,
    detail: footerAddress.length > 0 ? footerAddress : messages.footerMissing,
    ...(footerAddress.length > 0
      ? {}
      : {
          href: settingsLinks.store,
          linkLabel: messages.goToStore,
        }),
  });

  if (context.quota) {
    const { daily_send_quota: limit, usage_today: used } = context.quota;
    const remaining = Math.max(limit - used, 0);
    const quotaOk = used + recipientCount <= limit;
    const reset = messages.quotaResetNote(context.quota.quota_timezone);
    items.push({
      key: "quota",
      label: messages.quotaLabel,
      ok: quotaOk,
      detail: quotaOk
        ? messages.quotaOk(used, limit, remaining, reset)
        : messages.quotaInsufficient(
            used,
            limit,
            remaining,
            recipientCount,
            reset,
          ),
      ...(quotaOk
        ? {}
        : { href: settingsLinks.billing, linkLabel: messages.viewPlan }),
    });
  } else {
    items.push({
      key: "quota",
      label: messages.quotaLabel,
      ok: true,
      detail: messages.quotaUnavailable,
    });
  }

  const recipientsOk =
    recipientCount >= 1 && recipientCount <= context.maxRecipientsPerCampaign;
  items.push({
    key: "recipients",
    label: messages.recipientsLabel,
    ok: recipientsOk,
    detail:
      recipientCount < 1
        ? messages.recipientsEmpty
        : recipientsOk
          ? messages.recipientsOk(
              recipientCount,
              context.maxRecipientsPerCampaign,
            )
          : messages.recipientsExceeded(
              recipientCount,
              context.maxRecipientsPerCampaign,
            ),
    ...(recipientsOk
      ? {}
      : { href: settingsLinks.billing, linkLabel: messages.viewPlan }),
  });

  return { items, ready: items.every((item) => item.ok) };
}
