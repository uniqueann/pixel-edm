"use client";
import { Notice } from "@/components/ui/notice";

import {
  useRef,
  useState,
  useTransition,
  type TransitionStartFunction,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { LocalDate } from "@/components/local-date";
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
import type {
  DeliveryChannel,
  DeliveryChannelInput,
  DeliveryTestAttempt,
} from "./model";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ChannelTestResult } from "./channel-test-result";
import {
  channelSetupStateKey,
  isTestPending,
  latestTestSnapshot,
} from "./channel-presentation";
import type {
  ChannelOperation,
  ChannelOperationGate,
} from "./use-channel-operation";
import { directMailRegions } from "./provider";
import type { DeliveryChannelSummary, mergeProviderRecord } from "./registry";
import styles from "./channel-setup.module.css";
import { classifyDeliveryProviderError } from "@/lib/delivery-provider-error";
import { useErrorMessage } from "@/i18n/use-resolvers";

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

function Detail({ label, value }: { label: string; value: ReactNode }) {
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
  const t = useTranslations("channels");
  const tProviderErrors = useTranslations("common.providerErrors");
  const resolveError = useErrorMessage();
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
  const setupState = channelSetupStateKey(channel, lastTest?.status);

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
  const providerDisplayName = t(`providers.${provider.provider}.name`);
  const providerShortName = t(`providers.${provider.provider}.shortName`);
  const acceptedLabel = t(`providers.${provider.provider}.acceptedTestLabel`);
  const sandboxNotice =
    provider.provider === "amazon_ses"
      ? t("providers.amazon_ses.sandboxNotice")
      : provider.provider === "sendgrid"
        ? t("providers.sendgrid.sandboxNotice")
        : null;
  const trackingDisabled =
    capabilities.supports_open_tracking || capabilities.supports_click_tracking
      ? null
      : t("tracking.unsupported", { provider: providerDisplayName });

  function copy(value: string, label: string) {
    void navigator.clipboard.writeText(value).then(
      () => toast.success(t("toast.copied", { label })),
      () => toast.error(t("toast.copyFailed", { label })),
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
        setError(resolveError(result));
        return;
      }
      onChannelChange(result.data);
      testIdempotency.current = null;
      setTestError("");
      closeForm();
      toast.success(
        connected ? t("toast.updatedVerify") : t("toast.savedNeedTest"),
      );
      onChannelsListChange?.();
      router.refresh();
    } catch {
      if (request.isCurrent()) setError(t("toast.saveRequestIncomplete"));
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
          setActionError(t("toast.operationUnconfirmed"));
      } finally {
        request.finish();
      }
    });
  }

  function disconnect() {
    if (
      !channel ||
      mutationBlocked ||
      !window.confirm(t("detail.disconnectConfirm"))
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
        setActionError(resolveError(result));
        return;
      }
      onChannelChange(result.data);
      testIdempotency.current = null;
      setTestError("");
      toast.success(t("toast.disconnected"));
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
          setTestError(resolveError(result));
          return;
        }
        if (
          result.data.workspace_id !== workspaceId ||
          result.data.channel_id !== channel.id
        ) {
          setTestError(t("toast.testMismatch"));
          return;
        }
        if (!isTestPending(result.data.status)) testIdempotency.current = null;
        setLastTest(result.data);
        if (result.channel) onChannelChange(result.channel);
        if (result.data.status === "accepted")
          toast.success(
            t("toast.testAccepted", { provider: providerShortName }),
          );
        else if (result.data.status === "unknown")
          toast.warning(t("toast.testUnknown"));
        else if (result.data.status === "failed") {
          const { key, debugDetail } = classifyDeliveryProviderError(
            result.data,
          );
          const descParts = [tProviderErrors(`${key}.hint`)];
          if (debugDetail && debugDetail !== "UNKNOWN") {
            descParts.push(
              tProviderErrors("technicalInfoPrefix", { detail: debugDetail }),
            );
          }
          toast.error(tProviderErrors(`${key}.message`), {
            description: descParts.join("\n"),
          });
        }
        router.refresh();
      } catch {
        if (request.isCurrent()) setTestError(t("toast.testInterrupted"));
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
        setTestError(t("toast.testMismatch"));
        return;
      }
      setLastTest(attempt);
      if (latestChannel) onChannelChange(latestChannel);
      if (attempt && !isTestPending(attempt.status)) {
        testIdempotency.current = null;
        setTestError("");
      }
      toast.success(
        attempt ? t("toast.testRefreshed") : t("toast.testNoRecord"),
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
        setActionError(resolveError(result));
        return;
      }
      onChannelChange(result.data);
      setWebhookToken(result.token);
      toast.success(
        channel.webhook?.configured
          ? t("toast.webhookRotated")
          : t("toast.webhookGenerated"),
      );
      router.refresh();
    });
  }

  function revokeWebhook() {
    if (
      !channel?.webhook?.configured ||
      !channel.webhook.token_version ||
      mutationBlocked ||
      !window.confirm(t("webhook.revokeConfirm"))
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
        setActionError(resolveError(result));
        return;
      }
      onChannelChange(result.data);
      setWebhookToken(null);
      toast.success(t("toast.webhookRevoked"));
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
        setTrackingError(resolveError(result));
        return;
      }
      onChannelChange(result.data);
      setTrackingEnabled(result.data.tracking_enabled);
      setTrackingTagName(result.data.tracking_tag_name ?? "");
      setConfigurationSetName(result.data.configuration_set_name ?? "");
      toast.success(
        result.data.tracking_enabled
          ? t("toast.trackingEnabled")
          : t("toast.trackingDisabled"),
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
        setActionError(resolveError(result));
        return;
      }
      onChannelsReplace(result.data);
      toast.success(
        t("toast.primaryUpdated", { provider: providerDisplayName }),
      );
      onChannelsListChange?.();
      router.refresh();
    });
  }

  const webhookPublicKeyConfigured = Boolean(
    channel?.provider_config &&
    typeof channel.provider_config.event_webhook_public_key === "string" &&
    channel.provider_config.event_webhook_public_key.trim(),
  );

  const regionLabel = (() => {
    const region = channel?.region;
    if (!region) return t("regions.unset");
    if (
      provider.provider === "aliyun_directmail" &&
      (directMailRegions as readonly string[]).includes(region)
    ) {
      return t(`regions.directmail.${region as "cn-hangzhou"}`);
    }
    if (
      provider.provider === "sendgrid" &&
      (region === "global" || region === "eu")
    ) {
      return t(`regions.sendgrid.${region}`);
    }
    return region;
  })();

  const trackingDetail =
    channel?.tracking_enabled && provider.provider === "aliyun_directmail"
      ? t("detail.trackingEnabledWithTag", {
          value: channel.tracking_tag_name ?? t("detail.trackingTagMissing"),
        })
      : channel?.tracking_enabled && provider.provider === "amazon_ses"
        ? t("detail.trackingEnabledWithTag", {
            value:
              channel.configuration_set_name ??
              t("detail.trackingConfigSetMissing"),
          })
        : channel?.tracking_enabled && provider.provider === "sendgrid"
          ? t("detail.trackingEnabledSimple")
          : t("detail.trackingDisabled");

  const trackingFieldName =
    provider.provider === "aliyun_directmail"
      ? t("providers.aliyun_directmail.trackingFieldLabel")
      : provider.provider === "amazon_ses"
        ? t("providers.amazon_ses.trackingFieldLabel")
        : null;

  const capabilityList = [
    {
      key: "open",
      label: t("capabilities.openTracking"),
      supported: provider.supports_open_tracking,
      value: provider.supports_open_tracking
        ? t("capabilities.supported")
        : t("capabilities.unsupported"),
    },
    {
      key: "click",
      label: t("capabilities.clickTracking"),
      supported: provider.supports_click_tracking,
      value: provider.supports_click_tracking
        ? t("capabilities.supported")
        : t("capabilities.unsupported"),
    },
    {
      key: "html",
      label: t("capabilities.htmlRequired"),
      supported: provider.requires_html_for_tracking,
      value: provider.requires_html_for_tracking
        ? t("capabilities.requiresHtml")
        : t("capabilities.noHtmlNeeded"),
    },
    {
      key: "optOut",
      label: t("capabilities.optOut"),
      supported: provider.supports_link_tracking_opt_out,
      value: provider.supports_link_tracking_opt_out
        ? t("capabilities.supported")
        : t("capabilities.unsupported"),
    },
    {
      key: "webhook",
      label: t("capabilities.webhookConfirm"),
      supported: provider.requires_webhook_subscription_confirmation,
      value: provider.requires_webhook_subscription_confirmation
        ? t("capabilities.requiresHandshake")
        : t("capabilities.noHandshake"),
    },
  ];

  const quotaHintText =
    provider.quota_timezone === "Asia/Shanghai"
      ? t("capabilities.quotaHintBeijing", {
          rate: provider.default_rate_per_second,
          daily: provider.default_daily_quota,
        })
      : t("capabilities.quotaHintTimezone", {
          rate: provider.default_rate_per_second,
          daily: provider.default_daily_quota,
          timezone: provider.quota_timezone,
        });

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
                <h2>{providerDisplayName}</h2>
                {channel?.is_primary && (
                  <Badge variant="secondary">{t("statusBadge.primary")}</Badge>
                )}
              </div>
              <p className="hint m-0">
                {t(`providers.${provider.provider}.tagline`)}
              </p>
            </div>
          </div>
          <Badge
            variant={
              channel?.status === "error"
                ? "destructive"
                : channel?.status === "verified" &&
                    channel.credential_configured
                  ? "success"
                  : "outline"
            }
          >
            {channel
              ? channel.status === "verified" && !channel.credential_configured
                ? t("statusBadge.incompleteMissingCredential")
                : t(`statusBadge.${channel.status}`)
              : t("statusBadge.unconnected")}
          </Badge>
        </div>

        {sandboxNotice && connected && (
          <Notice tone="warning">{sandboxNotice}</Notice>
        )}

        <div className={styles.status}>
          <h3>{t(`setupState.${setupState}.title`)}</h3>
          <p className={styles.supporting}>
            {t(`setupState.${setupState}.detail`)}
          </p>
          {connected && (
            <p className={styles.supporting}>
              {t("detail.testRecipientNote", {
                recipient: testRecipient || t("detail.testRecipientFallback"),
              })}
            </p>
          )}
          {testPending && (
            <p className={styles.supporting} role="status">
              {t("detail.testPendingNotice")}
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
                      ? t("detail.sendingTest")
                      : refreshingTest
                        ? t("detail.refreshingTest")
                        : testPending
                          ? t("detail.refreshPendingTest")
                          : testError
                            ? t("detail.recoverTest")
                            : t("detail.sendTest")}
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
                  ? t("detail.updateChannel")
                  : channel
                    ? t("detail.reconnectChannel")
                    : t("detail.connectChannel")}
              </Button>
              {connected && !channel.is_primary && (
                <Button
                  variant="outline"
                  disabled={mutationBlocked}
                  onClick={makePrimary}
                >
                  <Star aria-hidden="true" />
                  {settingPrimary
                    ? t("detail.settingPrimary")
                    : t("detail.setPrimary")}
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
            {t("detail.submittingTestNotice")}
          </p>
        )}
        {testError && (
          <div className={styles.result} role="alert" data-tone="error">
            <h3 className="text-sm font-semibold">
              {t("detail.testErrorTitle")}
            </h3>
            <p className={styles.supporting}>{testError}</p>
            <p className={styles.supporting}>{t("detail.testErrorGuidance")}</p>
            <Button
              variant="outline"
              disabled={operation.busy}
              onClick={refreshTest}
            >
              {t("detail.refreshOnly")}
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
            {t("detail.refreshOnly")}
          </Button>
        )}
        <ConfirmDialog
          contentClassName={styles.confirmation}
          open={confirmRetest}
          onOpenChange={setConfirmRetest}
          title={t("detail.retestConfirmTitle")}
          description={t("detail.retestConfirmDescription")}
          confirmLabel={t("detail.retestConfirmAction")}
          cancelLabel={t("detail.retestCancelAction")}
          onConfirm={sendTest}
        />

        {nextStep}

        {channel ? (
          <dl className={styles.identity}>
            <Detail label={t("detail.fieldRegion")} value={regionLabel} />
            {channel.sender_domain && (
              <Detail
                label={t("detail.fieldSenderDomain")}
                value={channel.sender_domain}
              />
            )}
            <Detail
              label={t("detail.fieldSenderAddress")}
              value={channel.sender_address}
            />
            <Detail
              label={t("detail.fieldSenderAlias")}
              value={channel.sender_alias}
            />
            <Detail
              label={t("detail.fieldReplyTo")}
              value={
                channel.reply_to_address || t("detail.replyToFollowSender")
              }
            />
            {provider.provider === "sendgrid" && (
              <Detail
                label={t("detail.fieldWebhookPublicKey")}
                value={
                  webhookPublicKeyConfigured
                    ? t("detail.saved")
                    : t("detail.notSaved")
                }
              />
            )}
            <Detail
              label={t(`providers.${provider.provider}.credentialShortLabel`)}
              value={
                channel.credential_configured
                  ? channel.access_key_hint
                    ? `••••${channel.access_key_hint}`
                    : t("detail.savedSecurely")
                  : t("detail.notSaved")
              }
            />
            <Detail
              label={t("detail.fieldLastVerified")}
              value={
                channel.last_verified_at ? (
                  <LocalDate value={channel.last_verified_at} />
                ) : (
                  t("detail.neverVerified")
                )
              }
            />
            <Detail label={t("detail.fieldTracking")} value={trackingDetail} />
          </dl>
        ) : (
          <div className="rounded-xl border border-dashed p-4">
            <p className="text-sm">{t("detail.unconfiguredTitle")}</p>
            <p className="hint m-0">{t("detail.unconfiguredDescription")}</p>
          </div>
        )}

        {channel && canEdit && channel.webhook && (
          <details className={styles.disclosure} data-channel-webhook>
            <summary>
              {t("webhook.summaryTitle")}{" "}
              <span>
                {t("webhook.summaryMeta", {
                  state: channel.webhook.configured
                    ? t("webhook.stateTokenGenerated")
                    : t("webhook.stateNotConfigured"),
                })}
              </span>
            </summary>
            <div className={`space-y-4 ${styles.disclosureBody}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Webhook className="mt-0.5 size-5" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-semibold">
                      {t("webhook.heading")}
                    </h3>
                    <p className="hint mt-1 mb-0">
                      {t(`providers.${provider.provider}.webhookDesc`)}
                    </p>
                  </div>
                </div>
                <Badge variant="outline">
                  {!channel.webhook.configured
                    ? t("webhook.badgeNotConfigured")
                    : channel.webhook.last_event_at
                      ? t("webhook.badgeReceiving")
                      : provider.requires_webhook_subscription_confirmation
                        ? t("webhook.badgeWaitingSns")
                        : t("webhook.badgeWaitingFirst")}
                </Badge>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`webhook-endpoint-${channel.id}`}>
                  {t("webhook.endpointLabel")}
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
                    aria-label={t("webhook.copyEndpointAria")}
                    onClick={() =>
                      copy(
                        channel.webhook!.endpoint,
                        t("webhook.copyEndpointName"),
                      )
                    }
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {webhookToken && (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                  <p className="text-sm font-medium">
                    {t("webhook.tokenOnceNotice")}
                  </p>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={webhookToken}
                      className="bg-background font-mono text-xs"
                      aria-label={t("webhook.tokenAria")}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("webhook.copyTokenAria")}
                      onClick={() =>
                        copy(webhookToken, t("webhook.copyTokenName"))
                      }
                    >
                      <Copy aria-hidden="true" />
                    </Button>
                  </div>
                  <p className="m-0 text-xs">
                    {t(`providers.${provider.provider}.webhookTokenGuide`)}
                  </p>
                </div>
              )}

              {provider.provider === "aliyun_directmail" && (
                <details className="rounded-lg bg-muted p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t("webhook.eventBridgeSummary")}
                  </summary>
                  <p className="hint mt-2 mb-2">
                    {t("webhook.eventBridgeHelp")}
                  </p>
                  <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs">
                    {directMailEventPattern}
                  </pre>
                </details>
              )}

              {provider.provider === "amazon_ses" && (
                <p className="hint m-0">{t("webhook.sesHint")}</p>
              )}

              {provider.provider === "sendgrid" && (
                <p className="hint m-0">{t("webhook.sendgridHint")}</p>
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
                    ? t("webhook.processing")
                    : channel.webhook.configured
                      ? t("webhook.rotateToken")
                      : t("webhook.generateToken")}
                </Button>
                {channel.webhook.configured && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={mutationBlocked}
                    onClick={revokeWebhook}
                  >
                    <Ban aria-hidden="true" />
                    {t("webhook.revoke")}
                  </Button>
                )}
              </div>
              {channel.webhook.configured && (
                <p className="hint m-0">
                  {t("webhook.currentTokenHint", {
                    hint: channel.webhook.token_hint ?? "",
                  })}
                  {provider.provider === "aliyun_directmail" &&
                    ` ${t("webhook.directmailGraceHint")}`}
                </p>
              )}
            </div>
          </details>
        )}

        {connected && canEdit && (
          <details className={styles.disclosure} data-channel-tracking>
            <summary>
              {t("tracking.summaryTitle")}{" "}
              <span>
                {t("tracking.summaryMeta", { detail: trackingDetail })}
              </span>
            </summary>
            <div className={`space-y-4 ${styles.disclosureBody}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <ChartNoAxesCombined
                    className="mt-0.5 size-5"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="text-sm font-semibold">
                      {t("tracking.heading")}
                    </h3>
                    <p className="hint mt-1 mb-0">
                      {t(`providers.${provider.provider}.trackingDesc`)}
                    </p>
                  </div>
                </div>
                <Badge variant="outline">
                  {channel.tracking_enabled
                    ? t("detail.trackingEnabledSimple")
                    : t("detail.trackingDisabled")}
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
                    {t("tracking.toggleTitle")}
                  </span>
                  <span className="hint m-0 block">
                    {t("tracking.toggleHint")}
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
                  {t(`providers.${provider.provider}.trackingFieldHelp`)}
                </p>
              )}
              {trackingFieldName && (
                <p className="hint m-0">
                  {t(`providers.${provider.provider}.trackingFieldHelp`)}
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
                  {updatingTracking
                    ? t("tracking.saving")
                    : t("tracking.saveButton")}
                </Button>
                {trackingEnabled &&
                  ((provider.provider === "aliyun_directmail" &&
                    !trackingTagName.trim()) ||
                    (provider.provider === "amazon_ses" &&
                      !configurationSetName.trim())) && (
                    <span className="hint">{t("tracking.missingTagHint")}</span>
                  )}
              </div>
            </div>
          </details>
        )}

        <div className="flex items-start gap-2 rounded-xl bg-muted p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="hint m-0">
            {channel?.credential_configured
              ? t("detail.credentialEncrypted")
              : t("detail.credentialMissing")}
          </p>
        </div>

        {!canStoreCredentials && canEdit && (
          <p role="alert" className="field-error">
            {t("detail.keyringReadOnlyAlert")}
          </p>
        )}
        {!canEdit && <p className="hint m-0">{t("detail.adminOnlyNotice")}</p>}

        <details className={styles.disclosure}>
          <summary>{t("capabilities.summary")}</summary>
          <div className={styles.disclosureBody}>
            <p className="mb-2 text-sm font-medium">
              {t("capabilities.heading")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {capabilityList.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm"
                >
                  <span>{row.label}</span>
                  <Badge variant={row.supported ? "outline" : "secondary"}>
                    {row.value}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="hint mt-2 mb-0">{quotaHintText}</p>
          </div>
        </details>
        {canEdit && connected && (
          <div className={styles.actions}>
            <Button
              variant="outline"
              disabled={mutationBlocked}
              onClick={disconnect}
            >
              {disconnecting
                ? t("detail.disconnecting")
                : t("detail.disconnect")}
            </Button>
            <p className={styles.supporting}>{t("detail.disconnectNote")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
