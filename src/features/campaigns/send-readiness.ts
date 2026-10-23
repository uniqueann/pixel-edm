/** 正式发送前置检查：仅复用 start_campaign_delivery 已有的校验条件，不新增规则。 */

export type SendReadinessChannel = {
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

const channelStatusLabels: Record<string, string> = {
  incomplete: "配置未完成",
  configured: "已配置，尚未验证",
  error: "验证出错",
  disconnected: "已断开",
};

function quotaResetNote(timezone: string) {
  return timezone === "Asia/Shanghai" ? "北京时间每日 00:00 重置" : "次日重置";
}

export function evaluateSendReadiness(
  context: SendReadinessContext,
  recipientCount: number,
): SendReadiness {
  const channel = context.primaryChannel;
  const items: SendReadinessItem[] = [];

  const channelVerified =
    channel !== null &&
    channel.status === "verified" &&
    channel.credential_configured;
  items.push({
    key: "channel",
    label: "主发信通道",
    ok: channelVerified,
    detail:
      channel === null
        ? "尚未设置主发信通道"
        : channelVerified
          ? `${channel.display_name}已验证`
          : channel.status === "verified"
            ? `${channel.display_name}凭据不存在，请重新保存凭据`
            : `${channel.display_name}${channelStatusLabels[channel.status] ?? "尚未验证"}，请先连接并验证`,
    ...(channelVerified
      ? {}
      : { href: "/settings", linkLabel: "前往发信通道" }),
  });

  const senderAddress = channel?.sender_address.trim() ?? "";
  items.push({
    key: "sender",
    label: "发件地址",
    ok: senderAddress.length > 0,
    detail: senderAddress.length > 0 ? senderAddress : "主通道尚未填写发件地址",
    ...(senderAddress.length > 0
      ? {}
      : { href: "/settings", linkLabel: "前往发信通道" }),
  });

  const footerAddress = context.mailingAddress.trim();
  items.push({
    key: "footer",
    label: "页脚联系地址",
    ok: footerAddress.length > 0,
    detail:
      footerAddress.length > 0
        ? footerAddress
        : "尚未填写邮件页脚实体地址，正式邮件无法发出",
    ...(footerAddress.length > 0
      ? {}
      : { href: "/settings", linkLabel: "前往店铺信息" }),
  });

  if (context.quota) {
    const { daily_send_quota: limit, usage_today: used } = context.quota;
    const remaining = Math.max(limit - used, 0);
    const quotaOk = used + recipientCount <= limit;
    items.push({
      key: "quota",
      label: "今日剩余额度",
      ok: quotaOk,
      detail: quotaOk
        ? `今日已用 ${used} / ${limit} 封，剩余 ${remaining} 封（${quotaResetNote(context.quota.quota_timezone)}）`
        : `今日已用 ${used} / ${limit} 封，剩余 ${remaining} 封，本次需要 ${recipientCount} 封；${quotaResetNote(context.quota.quota_timezone)}，或升级套餐`,
      ...(quotaOk ? {} : { href: "/settings", linkLabel: "查看套餐" }),
    });
  } else {
    items.push({
      key: "quota",
      label: "今日剩余额度",
      ok: true,
      detail: "暂时无法读取今日额度，提交时将由系统校验",
    });
  }

  const recipientsOk =
    recipientCount >= 1 && recipientCount <= context.maxRecipientsPerCampaign;
  items.push({
    key: "recipients",
    label: "收件人数",
    ok: recipientsOk,
    detail:
      recipientCount < 1
        ? "名单中没有收件人"
        : recipientsOk
          ? `${recipientCount} 位，未超过套餐单活动上限 ${context.maxRecipientsPerCampaign}`
          : `${recipientCount} 位，超过套餐单活动上限 ${context.maxRecipientsPerCampaign}`,
    ...(recipientsOk ? {} : { href: "/settings", linkLabel: "查看套餐" }),
  });

  return { items, ready: items.every((item) => item.ok) };
}
