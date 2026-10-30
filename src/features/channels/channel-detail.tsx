"use client";

import {
  useRef,
  useState,
  useTransition,
  type TransitionStartFunction,
  type ReactNode,
} from "react";
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
  getDeliveryChannel,
  getDeliveryTestSummary,
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
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ChannelTestResult } from "./channel-test-result";
import {
  channelSetupCopy,
  isTestPending,
  latestTestSnapshot,
} from "./channel-presentation";
import type {
  ChannelOperation,
  ChannelOperationGate,
} from "./use-channel-operation";
import type { DeliveryChannelSummary } from "./registry";
import styles from "./channel-setup.module.css";
import { deliveryProviderErrorToast } from "@/lib/delivery-provider-error";
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
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
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
  operation,
  onChannelsReplace,
  nextStep,
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
  operation: ChannelOperationGate;
  nextStep: ReactNode;
  onChannelsReplace: (rows: DeliveryChannelSummary[]) => void;
}) {
  const router = useRouter();
  const [lastTest, setLastTest] = useState(initialTest);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [testError, setTestError] = useState("");
  const [confirmRetest, setConfirmRetest] = useState(false);
  const [refreshingTest, startRefreshTest] = useTransition();
  const editOperation = useRef<ChannelOperation | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const [testSource, setTestSource] = useState(initialTest);
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

  if (testSource !== initialTest && !operation.busy) {
    setTestSource(initialTest);
    setLastTest((current) => latestTestSnapshot(current, initialTest));
  }
  const testPending = isTestPending(lastTest?.status);
  const mutationBlocked = operation.busy || testPending;
  const setupCopy = channelSetupCopy(channel, lastTest?.status);

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

  function closeForm() {
    setFormOpen(false);
    setError("");
    editOperation.current?.finish();
    editOperation.current = null;
  }

  async function submitChannel(values: DeliveryChannelInput) {
    const request = editOperation.current;
    if (!request?.isCurrent()) return;
    try {
      const result = await saveDeliveryChannel(values);
      if (!request.isCurrent()) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onChannelChange(result.data);
      testIdempotency.current = null;
      setTestError("");
      closeForm();
      toast.success(
        connected
          ? "配置已更新，请核对当前验证状态"
          : "配置已保存，下一步发送测试邮件",
      );
      onChannelsListChange?.();
      router.refresh();
    } catch {
      if (request.isCurrent())
        setError("保存请求未完成，请核对网络与通道状态后重试。");
    }
  }

  function perform(
    start: TransitionStartFunction,
    task: (request: ChannelOperation) => Promise<void>,
  ) {
    // 先同步锁定界面，再启动可延迟的结果更新，避免等待期间按钮仍可操作。
    const request = operation.acquire();
    if (!request) return;
    setActionError("");
    start(async () => {
      try {
        await task(request);
      } catch {
        if (request.isCurrent())
          setActionError(
            "操作结果暂时无法确认。请刷新页面核对当前状态，再决定是否重试。",
          );
      } finally {
        request.finish();
      }
    });
  }

  function disconnect() {
    if (
      !channel ||
      mutationBlocked ||
      !window.confirm("确认断开发信通道？已保存的凭据密文会被删除。")
    )
      return;
    perform(startDisconnect, async (request) => {
      const result = await disconnectDeliveryChannel({
        workspace_id: workspaceId,
        id: channel.id,
        expected_version: channel.version,
      });
      if (!request.isCurrent()) return;
      if ("error" in result) {
        setActionError(result.error);
        return;
      }
      onChannelChange(result.data);
      testIdempotency.current = null;
      setTestError("");
      toast.success("发信通道已断开，凭据已删除");
      onChannelsListChange?.();
      router.refresh();
    });
  }

  function sendTest() {
    if (!channel || mutationBlocked) return;
    const idempotencyKey = testIdempotency.current ?? crypto.randomUUID();
    testIdempotency.current = idempotencyKey;
    setTestError("");
    perform(startTesting, async (request) => {
      try {
        const result = await sendDeliveryChannelTest({
          workspace_id: workspaceId,
          channel_id: channel.id,
          expected_version: channel.version,
          idempotency_key: idempotencyKey,
        });
        if (!request.isCurrent()) return;
        if ("error" in result) {
          setTestError(result.error);
          return;
        }
        if (
          result.data.workspace_id !== workspaceId ||
          result.data.channel_id !== channel.id
        ) {
          setTestError("测试结果与当前通道不一致，请刷新核对。");
          return;
        }
        if (!isTestPending(result.data.status)) testIdempotency.current = null;
        setLastTest(result.data);
        if (result.channel) onChannelChange(result.channel);
        if (result.data.status === "accepted")
          toast.success(
            `${provider.provider === "aliyun_directmail" ? "DirectMail" : provider.display_name} 已接收测试邮件`,
          );
        else if (result.data.status === "unknown")
          toast.warning("发送结果未知，请先核对邮箱和服务商控制台");
        else if (result.data.status === "failed") {
          const copy = deliveryProviderErrorToast(result.data);
          toast.error(copy.title, { description: copy.description });
        }
        router.refresh();
      } catch {
        if (request.isCurrent())
          setTestError("请求中断，暂时无法确认本次发送结果。");
      }
    });
  }

  function refreshTest() {
    if (!channel || operation.busy) return;
    perform(startRefreshTest, async (request) => {
      const [attempt, latestChannel] = await Promise.all([
        getDeliveryTestSummary(channel.id),
        getDeliveryChannel(channel.id),
      ]);
      if (!request.isCurrent()) return;
      if (
        attempt &&
        (attempt.workspace_id !== workspaceId ||
          attempt.channel_id !== channel.id)
      ) {
        setTestError("测试结果与当前通道不一致，请刷新核对。");
        return;
      }
      setLastTest(attempt);
      if (latestChannel) onChannelChange(latestChannel);
      if (attempt && !isTestPending(attempt.status)) {
        testIdempotency.current = null;
        setTestError("");
      }
      toast.success(
        attempt ? "已刷新测试结果" : "暂未查到测试记录，请先核对邮箱与控制台",
      );
      router.refresh();
    });
  }

  function configureWebhook() {
    if (!channel || mutationBlocked) return;
    perform(startWebhookUpdate, async (request) => {
      const result = await configureDeliveryWebhook({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_token_version: channel.webhook?.token_version,
      });
      if (!request.isCurrent()) return;
      if ("error" in result) {
        setActionError(result.error);
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
      mutationBlocked ||
      !window.confirm("确认停用回执 Webhook？服务商后续事件将被拒绝。")
    )
      return;
    perform(startWebhookUpdate, async (request) => {
      const result = await revokeDeliveryWebhook({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_token_version: channel.webhook?.token_version,
      });
      if (!request.isCurrent()) return;
      if ("error" in result) {
        setActionError(result.error);
        return;
      }
      onChannelChange(result.data);
      setWebhookToken(null);
      toast.success("回执 Webhook 已停用");
      router.refresh();
    });
  }

  function saveTracking() {
    if (!channel || mutationBlocked || trackingDisabled) return;
    setTrackingError("");
    perform(startTrackingUpdate, async (request) => {
      const result = await configureDeliveryTracking({
        provider: provider.provider,
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_version: channel.version,
        tracking_enabled: trackingEnabled,
        tracking_tag_name: trackingTagName,
        configuration_set_name: configurationSetName,
      });
      if (!request.isCurrent()) return;
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
    if (!channel || mutationBlocked || channel.is_primary) return;
    perform(startSetPrimary, async (request) => {
      const result = await setPrimaryDeliveryChannel({
        workspace_id: workspaceId,
        channel_id: channel.id,
        expected_version: channel.version,
      });
      if (!request.isCurrent()) return;
      if ("error" in result) {
        setActionError(result.error);
        return;
      }
      onChannelsReplace(result.data);
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
    <Card data-channel-provider={provider.provider}>
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
            {channel
              ? channel.status === "verified" && !channel.credential_configured
                ? "配置未完成（缺少凭据）"
                : deliveryChannelStatusLabels[channel.status]
              : "未连接"}
          </Badge>
        </div>

        {provider.sandboxNotice && connected && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            {provider.sandboxNotice}
          </div>
        )}

        <div className={styles.status}>
          <h3>{setupCopy.title}</h3>
          <p className={styles.supporting}>{setupCopy.detail}</p>
          {connected && (
            <p className={styles.supporting}>
              测试收件人：{testRecipient || "当前管理员的已验证邮箱"}
              。测试只发给当前管理员，不会发给客户名单。
            </p>
          )}
          {testPending && (
            <p className={styles.supporting} role="status">
              已有测试尚未完成。请刷新本次结果，完成后再更新配置或进行其他操作。
            </p>
          )}
          {canEdit && (
            <div className={styles.actions}>
              {connected &&
                channel.credential_configured &&
                channel.status !== "incomplete" && (
                  <Button
                    data-channel-primary
                    variant={
                      channel.status === "verified" ? "outline" : "default"
                    }
                    disabled={operation.busy}
                    onClick={() => {
                      if (testPending) refreshTest();
                      else if (lastTest?.status === "unknown")
                        setConfirmRetest(true);
                      else sendTest();
                    }}
                  >
                    <Send aria-hidden="true" />
                    {testing
                      ? "测试发送中…"
                      : refreshingTest
                        ? "刷新中…"
                        : testPending
                          ? "刷新本次测试结果"
                          : testError
                            ? "恢复本次测试"
                            : "发送测试邮件"}
                  </Button>
                )}
              <Button
                variant={
                  connected && channel.credential_configured
                    ? "outline"
                    : "default"
                }
                disabled={!canStoreCredentials || mutationBlocked}
                onClick={(event) => {
                  const request = operation.acquire();
                  if (!request) return;
                  editOperation.current = request;
                  returnFocus.current = event.currentTarget;
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
              {connected && !channel.is_primary && (
                <Button
                  variant="outline"
                  disabled={mutationBlocked}
                  onClick={makePrimary}
                >
                  <Star aria-hidden="true" />
                  {settingPrimary ? "切换中…" : "设为主通道"}
                </Button>
              )}
            </div>
          )}
          {formOpen && (
            <ChannelFormDialog
              open={formOpen}
              onOpenChange={(open) => {
                if (!open) closeForm();
              }}
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              provider={provider}
              channel={channel}
              connected={Boolean(connected)}
              error={error}
              onError={setError}
              onSubmit={submitChannel}
              onReturnFocus={() =>
                requestAnimationFrame(() => returnFocus.current?.focus())
              }
            />
          )}
        </div>

        {testing && (
          <p role="status" className={styles.supporting}>
            正在向服务商提交本次测试，请保持页面打开。
          </p>
        )}
        {testError && (
          <div className={styles.result} role="alert" data-tone="error">
            <h3 className="text-sm font-semibold">本次测试结果暂时无法确认</h3>
            <p className={styles.supporting}>{testError}</p>
            <p className={styles.supporting}>
              请先核对邮箱与服务商控制台。恢复本次测试会沿用同一请求标识；如果上次尚未提交，服务端仍可能发送一封邮件。
            </p>
            <Button
              variant="outline"
              disabled={operation.busy}
              onClick={refreshTest}
            >
              只刷新测试结果
            </Button>
          </div>
        )}
        {actionError && (
          <p role="alert" className="field-error">
            {actionError}
          </p>
        )}
        {lastTest && (
          <ChannelTestResult
            attempt={lastTest}
            acceptedLabel={acceptedLabel}
            historical={
              lastTest.status === "accepted" &&
              (channel?.status !== "verified" || !channel.credential_configured)
            }
          />
        )}
        {lastTest?.status === "unknown" && canEdit && (
          <Button
            variant="outline"
            disabled={operation.busy}
            onClick={refreshTest}
          >
            只刷新测试结果
          </Button>
        )}
        <ConfirmDialog
          contentClassName={styles.confirmation}
          open={confirmRetest}
          onOpenChange={setConfirmRetest}
          title="核对后重新发送测试？"
          description="上次结果未知，邮件可能已经发出。请先核对管理员邮箱与服务商控制台；继续将使用新的请求标识，可能再发送一封邮件。"
          confirmLabel="已核对，重新测试"
          cancelLabel="继续核对"
          onConfirm={sendTest}
        />

        {nextStep}

        {channel ? (
          <dl className={styles.identity}>
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
          </dl>
        ) : (
          <div className="rounded-xl border border-dashed p-4">
            <p className="text-sm">尚未配置此发信通道。</p>
            <p className="hint m-0">
              保存区域、已验证发件身份和专用访问密钥后即可测试发送。
            </p>
          </div>
        )}

        {channel && canEdit && channel.webhook && (
          <details className={styles.disclosure} data-channel-webhook>
            <summary>
              投递回执配置{" "}
              <span>
                {channel.webhook.configured ? "已生成令牌" : "未配置"} ·
                首次测试无需配置
              </span>
            </summary>
            <div className={`space-y-4 ${styles.disclosureBody}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Webhook className="mt-0.5 size-5" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold">投递回执 Webhook</h3>
                    <p className="hint mt-1 mb-0">
                      {provider.provider === "amazon_ses"
                        ? "通过 SNS 接收 SES 事件；首次通知系统将自动完成订阅确认。"
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
                    acs.directmail。阿里云控制台中建议开启重试机制。
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
                  请在通道配置中保存 SendGrid 控制台提供的 Signed Webhook
                  公钥，否则回执事件会被拒绝。
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={channel.webhook.configured ? "outline" : "default"}
                  disabled={mutationBlocked}
                  onClick={configureWebhook}
                >
                  {channel.webhook.configured && (
                    <RotateCw aria-hidden="true" />
                  )}
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
                    disabled={mutationBlocked}
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
          </details>
        )}

        {connected && canEdit && (
          <details className={styles.disclosure} data-channel-tracking>
            <summary>
              打开与点击追踪 <span>{trackingDetail} · 按需开启</span>
            </summary>
            <div className={`space-y-4 ${styles.disclosureBody}`}>
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
                        ? "开启后，新邮件将统计打开与点击行为；历史活动数据不受影响。"
                        : provider.provider === "sendgrid"
                          ? "开启后，新邮件将通过 SendGrid 统计打开与点击行为；历史活动数据不受影响。"
                          : "开启后，新邮件将使用 SES Configuration Set 统计打开与点击行为；历史活动数据不受影响。"}
                    </p>
                  </div>
                </div>
                <Badge variant="outline">
                  {channel.tracking_enabled ? "已开启" : "未开启"}
                </Badge>
              </div>
              {trackingDisabled && (
                <p className="hint m-0">{trackingDisabled}</p>
              )}
              <label className="flex items-start gap-3 rounded-lg bg-muted p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={trackingEnabled}
                  disabled={Boolean(trackingDisabled) || mutationBlocked}
                  onChange={(event) => setTrackingEnabled(event.target.checked)}
                />
                <span>
                  <span className="block font-medium">
                    为未来正式活动开启追踪
                  </span>
                  <span className="hint m-0 block">
                    统计邮件打开与链接点击数据。部分客户端（如 Apple
                    邮件隐私保护）可能影响统计准确度。
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
                    disabled={Boolean(trackingDisabled) || mutationBlocked}
                    aria-label={trackingFieldName}
                    onChange={(event) =>
                      provider.provider === "aliyun_directmail"
                        ? setTrackingTagName(event.target.value)
                        : setConfigurationSetName(event.target.value)
                    }
                  />
                </div>
              ) : (
                <p className="hint m-0">
                  {trackingFieldHelp(provider.provider)}
                </p>
              )}
              {trackingFieldName && (
                <p className="hint m-0">
                  {trackingFieldHelp(provider.provider)}
                </p>
              )}
              {trackingError && (
                <p role="alert" className="field-error">
                  {trackingError}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    Boolean(trackingDisabled) ||
                    mutationBlocked ||
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
                {trackingEnabled &&
                  ((provider.provider === "aliyun_directmail" &&
                    !trackingTagName.trim()) ||
                    (provider.provider === "amazon_ses" &&
                      !configurationSetName.trim())) && (
                    <span className="hint">请先填写追踪标签名称</span>
                  )}
              </div>
            </div>
          </details>
        )}

        <div className="flex items-start gap-2 rounded-xl bg-muted p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="hint m-0">
            {channel?.credential_configured
              ? "访问凭据已加密保存，页面不回显明文。"
              : "当前通道尚未保存发信凭据。"}
          </p>
        </div>

        {!canStoreCredentials && canEdit && (
          <p role="alert" className="field-error">
            服务器尚未配置凭据加密密钥，发信通道暂时只能查看。
          </p>
        )}
        {!canEdit && (
          <p className="hint m-0">仅管理员可以连接或修改发信通道。</p>
        )}

        <details className={styles.disclosure}>
          <summary>服务商能力与默认限额</summary>
          <div className={styles.disclosureBody}>
            <p className="mb-2 text-sm font-medium">服务商能力</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {capabilityRows(provider).map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm"
                >
                  <span>{row.label}</span>
                  <Badge variant={row.supported ? "outline" : "secondary"}>
                    {row.value}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="hint mt-2 mb-0">{providerQuotaHint(provider)}</p>
          </div>
        </details>
        {canEdit && connected && (
          <div className={styles.actions}>
            <Button
              variant="outline"
              disabled={mutationBlocked}
              onClick={disconnect}
            >
              {disconnecting ? "断开中…" : "断开发信通道"}
            </Button>
            <p className={styles.supporting}>
              断开将删除发信凭据，不会自动停用投递回执。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
