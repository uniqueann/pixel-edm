"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  ChartNoAxesCombined,
  Copy,
  KeyRound,
  MailCheck,
  RotateCw,
  Send,
  ShieldCheck,
  Star,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  configureDeliveryTracking,
  configureDeliveryWebhook,
  disconnectDeliveryChannel,
  revokeDeliveryWebhook,
  saveDeliveryChannel,
  sendDeliveryChannelTest,
  setPrimaryDeliveryChannel,
} from "./actions";
import { ChannelFormDialog } from "./channel-form-dialog";
import {
  deliveryChannelStatusLabels,
  type DeliveryChannel,
  type DeliveryChannelInput,
  type DeliveryTestAttempt,
} from "./model";
import {
  capabilityRows,
  directMailRegionLabel,
  mergeProviderRecord,
  providerQuotaHint,
  sendGridDataCenterLabel,
  trackingDisabledReason,
  trackingFieldHelp,
  trackingFieldLabel,
} from "./registry";

const directMailEventPattern = JSON.stringify(
  {
    source: ["acs.dm"],
    type: [
      "dm:Deliver:Succeed",
      "dm:Deliver:Fail",
      "dm:Feedback:FblReport",
      "dm:Feedback:Subscribe",
      "dm:Feedback:UnSubscribe",
      "dm:Trace:Open",
      "dm:Trace:Click",
    ],
  },
  null,
  2,
);

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted px-3 py-2">
      <p className="hint m-0">{label}</p>
      <p className="truncate text-sm" title={value}>
        {value}
      </p>
    </div>
  );
}

export function ChannelDetail({
  workspaceId,
  workspaceName,
  provider,
  channel,
  initialTest,
  testRecipient,
  canEdit,
  canStoreCredentials,
  onChannelChange,
  onChannelsListChange,
}: {
  workspaceId: string;
  workspaceName: string;
  provider: ReturnType<typeof mergeProviderRecord>;
  channel: DeliveryChannel | null;
  initialTest: DeliveryTestAttempt | null;
  testRecipient: string;
  canEdit: boolean;
  canStoreCredentials: boolean;
  onChannelChange: (channel: DeliveryChannel | null) => void;
  onChannelsListChange?: () => void;
}) {
  const router = useRouter();
  const [lastTest, setLastTest] = useState(initialTest);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState(
    channel?.tracking_enabled ?? false,
  );
  const [trackingTagName, setTrackingTagName] = useState(
    channel?.tracking_tag_name ?? "",
  );
  const [configurationSetName, setConfigurationSetName] = useState(
    channel?.configuration_set_name ?? "",
  );
  const [trackingError, setTrackingError] = useState("");
  const [disconnecting, startDisconnect] = useTransition();
  const [testing, startTesting] = useTransition();
  const [updatingWebhook, startWebhookUpdate] = useTransition();
  const [updatingTracking, startTrackingUpdate] = useTransition();
  const [settingPrimary, startSetPrimary] = useTransition();
  const testIdempotency = useRef<string | null>(null);

  const connected = channel && channel.status !== "disconnected";
  const capabilities = channel?.capabilities ?? {
    display_name: provider.display_name,
    sender_alias_max_length: provider.sender_alias_max_length,
    requires_sender_domain: provider.requires_sender_domain,
    supports_open_tracking: provider.supports_open_tracking,
    supports_click_tracking: provider.supports_click_tracking,
    requires_html_for_tracking: provider.requires_html_for_tracking,
    supports_link_tracking_opt_out: provider.supports_link_tracking_opt_out,
    requires_webhook_subscription_confirmation:
      provider.requires_webhook_subscription_confirmation,
  };
  const trackingDisabled = trackingDisabledReason(capabilities);
  const acceptedLabel = provider.acceptedTestLabel;
  const headingTitle =
    provider.provider === "aliyun_directmail"
      ? "阿里云邮件推送 DirectMail"
      : provider.display_name;

  function copy(value: string, label: string) {
    void navigator.clipboard.writeText(value).then(
      () => toast.success(`${label}已复制`),
      () => toast.error(`${label}复制失败，请手动复制`),
    );
  }

  async function submitChannel(values: DeliveryChannelInput) {
    const result = await saveDeliveryChannel(values);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onChannelChange(result.data);
    setFormOpen(false);
    toast.success(connected ? "发信通道已更新" : "发信通道已连接");
    onChannelsListChange?.();
    router.refresh();
  }

  function disconnect() {
    if (
      !channel ||
      !window.confirm("确认断开发信通道？已保存的凭据密文会被删除。")
    )
      return;
    startDisconnect(async () => {
      const result = await disconnectDeliveryChannel({
        workspace_id: workspaceId,
        id: channel.id,
        expected_version: channel.version,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onChannelChange(result.data);
      toast.success("发信通道已断开，凭据已删除");
      onChannelsListChange?.();
      router.refresh();
    });
  }

  function sendTest() {
    if (!channel || testing) return;
    const idempotencyKey = testIdempotency.current ?? crypto.randomUUID();
    testIdempotency.current = idempotencyKey;
    startTesting(async () => {
      const result = await sendDeliveryChannelTest({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_version: channel.version,
        idempotency_key: idempotencyKey,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      testIdempotency.current = null;
      setLastTest(result.data);
      if (result.channel) onChannelChange(result.channel);
      if (result.data.status === "accepted")
        toast.success(
          provider.provider === "aliyun_directmail"
            ? "测试邮件已被 DirectMail 接收"
            : `测试邮件已被 ${provider.display_name} 接收`,
        );
      else if (result.data.status === "unknown")
        toast.warning(
          `发送结果未知，请先核对邮箱和 ${provider.display_name} 控制台`,
        );
      else toast.error(`测试发送失败：${result.data.error_code ?? "UNKNOWN"}`);
      router.refresh();
    });
  }

  function configureWebhook() {
    if (!channel || updatingWebhook) return;
    startWebhookUpdate(async () => {
      const result = await configureDeliveryWebhook({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_token_version: channel.webhook?.token_version,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onChannelChange(result.data);
      setWebhookToken(result.token);
      toast.success(
        channel.webhook?.configured
          ? "Webhook 令牌已轮换"
          : "Webhook 令牌已生成",
      );
      router.refresh();
    });
  }

  function revokeWebhook() {
    if (
      !channel?.webhook?.configured ||
      !channel.webhook.token_version ||
      !window.confirm(
        provider.provider === "amazon_ses"
          ? "确认停用回执 Webhook？SNS 后续通知将被拒绝。"
          : provider.provider === "sendgrid"
            ? "确认停用回执 Webhook？SendGrid 后续事件将被拒绝。"
            : "确认停用回执 Webhook？EventBridge 后续请求将被拒绝。",
      )
    )
      return;
    startWebhookUpdate(async () => {
      const result = await revokeDeliveryWebhook({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_token_version: channel.webhook?.token_version,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onChannelChange(result.data);
      setWebhookToken(null);
      toast.success("回执 Webhook 已停用");
      router.refresh();
    });
  }

  function saveTracking() {
    if (!channel || updatingTracking || trackingDisabled) return;
    setTrackingError("");
    startTrackingUpdate(async () => {
      const result = await configureDeliveryTracking({
        provider: provider.provider,
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_version: channel.version,
        tracking_enabled: trackingEnabled,
        tracking_tag_name: trackingTagName,
        configuration_set_name: configurationSetName,
      });
      if ("error" in result) {
        setTrackingError(result.error);
        return;
      }
      onChannelChange(result.data);
      setTrackingEnabled(result.data.tracking_enabled);
      setTrackingTagName(result.data.tracking_tag_name ?? "");
      setConfigurationSetName(result.data.configuration_set_name ?? "");
      toast.success(
        result.data.tracking_enabled ? "行为追踪已开启" : "行为追踪已关闭",
      );
      router.refresh();
    });
  }

  function makePrimary() {
    if (!channel || settingPrimary || channel.is_primary) return;
    startSetPrimary(async () => {
      const result = await setPrimaryDeliveryChannel({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_version: channel.version,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`已将 ${provider.display_name} 设为主发信通道`);
      onChannelsListChange?.();
      router.refresh();
    });
  }

  const webhookPublicKeyConfigured = Boolean(
    channel?.provider_config &&
      typeof channel.provider_config.event_webhook_public_key === "string" &&
      channel.provider_config.event_webhook_public_key.trim(),
  );

  const regionLabel =
    provider.provider === "aliyun_directmail"
      ? directMailRegionLabel(channel?.region)
      : provider.provider === "sendgrid"
        ? sendGridDataCenterLabel(channel?.region)
        : (channel?.region ?? "未设置");

  const trackingDetail =
    channel?.tracking_enabled && provider.provider === "aliyun_directmail"
      ? `已开启 · ${channel.tracking_tag_name ?? "标签缺失"}`
      : channel?.tracking_enabled && provider.provider === "amazon_ses"
        ? `已开启 · ${channel.configuration_set_name ?? "配置集缺失"}`
        : channel?.tracking_enabled && provider.provider === "sendgrid"
          ? "已开启"
          : "未开启";

  const trackingFieldName = trackingFieldLabel(provider.provider);

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary">
              <MailCheck className="size-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2>{headingTitle}</h2>
                {channel?.is_primary && (
                  <Badge variant="secondary">主通道</Badge>
                )}
              </div>
              <p className="hint m-0">{provider.tagline}</p>
            </div>
          </div>
          <Badge
            variant={channel?.status === "error" ? "destructive" : "outline"}
          >
            {channel ? deliveryChannelStatusLabels[channel.status] : "未连接"}
          </Badge>
        </div>

        {provider.sandboxNotice && connected && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            {provider.sandboxNotice}
          </div>
        )}

        <div className="rounded-xl border p-3">
          <p className="mb-2 text-sm font-medium">服务商能力</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {capabilityRows(provider).map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm"
              >
                <span>{row.label}</span>
                <Badge variant={row.supported ? "outline" : "secondary"}>
                  {row.supported ? "支持" : "不支持"}
                </Badge>
              </div>
            ))}
          </div>
          <p className="hint mt-2 mb-0">{providerQuotaHint(provider)}</p>
        </div>

        {channel ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Detail label="区域" value={regionLabel} />
            {channel.sender_domain && (
              <Detail label="发件域名" value={channel.sender_domain} />
            )}
            <Detail label="发件地址" value={channel.sender_address} />
            <Detail label="发件人" value={channel.sender_alias} />
            <Detail
              label="回复地址"
              value={channel.reply_to_address || "跟随发件地址"}
            />
            {provider.provider === "sendgrid" && (
              <Detail
                label="Webhook 验签公钥"
                value={webhookPublicKeyConfigured ? "已保存" : "未保存"}
              />
            )}
            <Detail
              label={
                provider.provider === "amazon_ses"
                  ? "AWS 访问密钥"
                  : provider.provider === "sendgrid"
                    ? "API Key"
                    : "AccessKey"
              }
              value={
                channel.credential_configured
                  ? channel.access_key_hint
                    ? `••••${channel.access_key_hint}`
                    : "已安全保存"
                  : "未保存"
              }
            />
            <Detail
              label="最近验证"
              value={
                channel.last_verified_at
                  ? new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(channel.last_verified_at))
                  : "尚未通过测试发送"
              }
            />
            <Detail label="行为追踪" value={trackingDetail} />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-4">
            <p className="text-sm">尚未配置此发信通道。</p>
            <p className="hint m-0">
              保存区域、已验证发件身份和专用访问密钥后即可测试发送。
            </p>
          </div>
        )}

        {channel && canEdit && channel.webhook && (
          <div className="space-y-4 rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Webhook className="mt-0.5 size-5" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold">投递回执 Webhook</h3>
                  <p className="hint mt-1 mb-0">
                    {provider.provider === "amazon_ses"
                      ? "通过 SNS 接收 SES 事件；首次通知会触发订阅握手。"
                      : provider.provider === "sendgrid"
                        ? "在 SendGrid Event Webhook 中启用 Signed Event，将 HTTPS 目标指向上方地址并填入验签公钥。"
                        : "接收投递、投诉、退订及行为事件；断开发信通道不会自动停用回执。"}
                  </p>
                </div>
              </div>
              <Badge variant="outline">
                {!channel.webhook.configured
                  ? "未配置"
                  : channel.webhook.last_event_at
                    ? "正在接收"
                    : provider.requires_webhook_subscription_confirmation
                      ? "等待 SNS 确认"
                      : "等待首个事件"}
              </Badge>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`webhook-endpoint-${channel.id}`}>
                HTTPS 目标地址
              </Label>
              <div className="flex gap-2">
                <Input
                  id={`webhook-endpoint-${channel.id}`}
                  readOnly
                  value={channel.webhook.endpoint}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="复制 Webhook 地址"
                  onClick={() =>
                    copy(channel.webhook!.endpoint, "Webhook 地址")
                  }
                >
                  <Copy aria-hidden="true" />
                </Button>
              </div>
            </div>

            {webhookToken && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="text-sm font-medium">
                  请立即保存令牌，仅本次显示
                </p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookToken}
                    className="bg-background font-mono text-xs"
                    aria-label="Webhook 令牌"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="复制 Webhook 令牌"
                    onClick={() => copy(webhookToken, "Webhook 令牌")}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                </div>
                <p className="m-0 text-xs">
                  {provider.provider === "amazon_ses"
                    ? "将令牌作为查询参数 token= 或请求头 x-edm-webhook-token 传给 SNS HTTPS 订阅。"
                    : provider.provider === "sendgrid"
                      ? "Webhook URL 须包含 token= 查询参数，或使用请求头 x-edm-webhook-token。"
                      : "在 EventBridge HTTP 目标高级选项中将它填入 Token；请求头名称为 x-eventbridge-signature-token。"}
                </p>
              </div>
            )}

            {provider.provider === "aliyun_directmail" && (
              <details className="rounded-lg bg-muted p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  EventBridge 事件规则
                </summary>
                <p className="hint mt-2 mb-2">
                  事件源请选择 acs.dm，消息体选择“完整事件”，不要选择
                  acs.directmail。生产环境请启用指数退避并配置 MNS 死信队列。
                </p>
                <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
                  {directMailEventPattern}
                </pre>
              </details>
            )}

            {provider.provider === "amazon_ses" && (
              <p className="hint m-0">
                在 SES 配置集中启用 SNS 事件发布，并将 HTTPS
                订阅指向上方地址。Topic ARN
                须与通道配置一致，首次订阅由系统自动确认。
              </p>
            )}

            {provider.provider === "sendgrid" && (
              <p className="hint m-0">
                入口函数为 edm-sendgrid-events；POST JSON
                数组。请在通道配置中保存 SendGrid 控制台提供的 Signed Webhook
                公钥，否则回执会被拒绝。
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={channel.webhook.configured ? "outline" : "default"}
                disabled={updatingWebhook}
                onClick={configureWebhook}
              >
                {channel.webhook.configured && <RotateCw aria-hidden="true" />}
                {updatingWebhook
                  ? "处理中…"
                  : channel.webhook.configured
                    ? "轮换令牌"
                    : "生成令牌"}
              </Button>
              {channel.webhook.configured && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={updatingWebhook}
                  onClick={revokeWebhook}
                >
                  <Ban aria-hidden="true" />
                  停用 Webhook
                </Button>
              )}
            </div>
            {channel.webhook.configured && (
              <p className="hint m-0">
                当前令牌尾号 ••••{channel.webhook.token_hint}。
                {provider.provider === "aliyun_directmail" &&
                  " 轮换后旧令牌保留 15 分钟宽限期，便于无中断更新 EventBridge。"}
              </p>
            )}
          </div>
        )}

        {connected && canEdit && (
          <div className="space-y-4 rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <ChartNoAxesCombined
                  className="mt-0.5 size-5"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="text-sm font-semibold">打开与点击追踪</h3>
                  <p className="hint mt-1 mb-0">
                    {provider.provider === "aliyun_directmail"
                      ? "显式开启后，正式邮件会使用阿里云行为追踪；历史活动口径不受影响。"
                      : provider.provider === "sendgrid"
                        ? "显式开启后，正式邮件会在 Mail Send 请求中启用 SendGrid 打开/点击追踪。"
                        : "显式开启后，正式邮件会使用 SES Configuration Set 追踪；历史活动口径不受影响。"}
                  </p>
                </div>
              </div>
              <Badge variant="outline">
                {channel.tracking_enabled ? "已开启" : "未开启"}
              </Badge>
            </div>
            {trackingDisabled && <p className="hint m-0">{trackingDisabled}</p>}
            <label className="flex items-start gap-3 rounded-lg bg-muted p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={trackingEnabled}
                disabled={Boolean(trackingDisabled)}
                onChange={(event) => setTrackingEnabled(event.target.checked)}
              />
              <span>
                <span className="block font-medium">
                  为未来正式活动开启追踪
                </span>
                <span className="hint m-0 block">
                  会采集供应商打开与点击信号；邮件客户端的隐私代理可能影响准确性。
                </span>
              </span>
            </label>
            {trackingFieldName ? (
              <div className="space-y-2">
                <Label htmlFor={`tracking-field-${channel.id}`}>
                  {trackingFieldName}
                </Label>
                <Input
                  id={`tracking-field-${channel.id}`}
                  value={
                    provider.provider === "aliyun_directmail"
                      ? trackingTagName
                      : configurationSetName
                  }
                  maxLength={
                    provider.provider === "aliyun_directmail" ? 128 : 64
                  }
                  placeholder={
                    provider.provider === "aliyun_directmail"
                      ? "pixel_edm_tracking"
                      : "pixel-edm-tracking"
                  }
                  disabled={Boolean(trackingDisabled)}
                  aria-label={trackingFieldName}
                  onChange={(event) =>
                    provider.provider === "aliyun_directmail"
                      ? setTrackingTagName(event.target.value)
                      : setConfigurationSetName(event.target.value)
                  }
                />
              </div>
            ) : (
              <p className="hint m-0">{trackingFieldHelp(provider.provider)}</p>
            )}
            {trackingFieldName && (
              <p className="hint m-0">{trackingFieldHelp(provider.provider)}</p>
            )}
            {trackingError && (
              <p role="alert" className="field-error">
                {trackingError}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={
                Boolean(trackingDisabled) ||
                updatingTracking ||
                (trackingEnabled &&
                  provider.provider === "aliyun_directmail" &&
                  !trackingTagName.trim()) ||
                (trackingEnabled &&
                  provider.provider === "amazon_ses" &&
                  !configurationSetName.trim()) ||
                (trackingEnabled === channel.tracking_enabled &&
                  provider.provider === "aliyun_directmail" &&
                  trackingTagName.trim() ===
                    (channel.tracking_tag_name ?? "")) ||
                (trackingEnabled === channel.tracking_enabled &&
                  provider.provider === "amazon_ses" &&
                  configurationSetName.trim() ===
                    (channel.configuration_set_name ?? "")) ||
                (trackingEnabled === channel.tracking_enabled &&
                  provider.provider === "sendgrid")
              }
              onClick={saveTracking}
            >
              {updatingTracking ? "保存中…" : "保存追踪设置"}
            </Button>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-xl bg-muted p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="hint m-0">
            访问密钥使用 AES-256-GCM 加密后存入私密 schema，页面不会回显
            Secret。测试邮件只发送到当前管理员的已验证登录邮箱。
          </p>
        </div>

        {lastTest && (
          <div className="rounded-xl border p-4 text-sm">
            <p className="font-medium">
              最近测试：
              {
                {
                  pending: "等待发送",
                  processing: "发送中",
                  accepted: acceptedLabel,
                  failed: "发送失败",
                  unknown: "发送结果未知",
                }[lastTest.status]
              }
            </p>
            <p className="hint mt-1 mb-0">
              {lastTest.recipient_hint &&
                `收件人 ${lastTest.recipient_hint} · `}
              {lastTest.completed_at
                ? new Intl.DateTimeFormat("zh-CN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(lastTest.completed_at))
                : "尚未完成"}
              {lastTest.error_code && ` · ${lastTest.error_code}`}
            </p>
          </div>
        )}

        {!canStoreCredentials && canEdit && (
          <p role="alert" className="field-error">
            服务器尚未配置凭据加密密钥，发信通道暂时只能查看。
          </p>
        )}
        {!canEdit && (
          <p className="hint m-0">仅管理员可以连接或修改发信通道。</p>
        )}

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canStoreCredentials}
              onClick={() => {
                setError("");
                setFormOpen(true);
              }}
            >
              <KeyRound aria-hidden="true" />
              {connected
                ? "更新发信通道"
                : channel
                  ? "重新连接发信通道"
                  : "连接发信通道"}
            </Button>
            <ChannelFormDialog
              open={formOpen}
              onOpenChange={setFormOpen}
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              provider={provider}
              channel={channel}
              connected={Boolean(connected)}
              error={error}
              onError={setError}
              onSubmit={submitChannel}
            />
            {connected && (
              <>
                <Button
                  variant="secondary"
                  disabled={testing || !channel.credential_configured}
                  onClick={sendTest}
                  title={testRecipient ? `发送至 ${testRecipient}` : undefined}
                >
                  <Send aria-hidden="true" />
                  {testing ? "测试发送中…" : "发送测试邮件"}
                </Button>
                {!channel.is_primary && (
                  <Button
                    variant="outline"
                    disabled={settingPrimary}
                    onClick={makePrimary}
                  >
                    <Star aria-hidden="true" />
                    {settingPrimary ? "切换中…" : "设为主通道"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={disconnecting || testing}
                  onClick={disconnect}
                >
                  {disconnecting ? "断开中…" : "断开发信通道"}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
