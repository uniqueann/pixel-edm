"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChannelDetail } from "./channel-detail";
import { ChannelFormDialog } from "./channel-form-dialog";
import type { DeliveryChannel, DeliveryTestAttempt } from "./model";
import { mergeProviderRecord, type DeliveryChannelSummary } from "./registry";
import { saveDeliveryChannel } from "./actions";
import { settingsSectionHref } from "@/features/settings/anchors";
import { DEFAULT_LOCALE, normalizeLocale } from "@/i18n/config";
import { compareLocalized } from "@/i18n/format";
import { useErrorMessage } from "@/i18n/use-resolvers";
import {
  useChannelOperation,
  type ChannelOperation,
} from "./use-channel-operation";
import styles from "./channel-setup.module.css";

export function ChannelSettings({
  workspaceId,
  workspaceName,
  providers,
  initialChannels,
  initialChannelDetails,
  initialTests,
  testRecipient,
  canEdit,
  canStoreCredentials,
  storeReady,
  signatureReady,
}: {
  workspaceId: string;
  workspaceName: string;
  providers: ReturnType<typeof mergeProviderRecord>[];
  initialChannels: DeliveryChannelSummary[];
  initialChannelDetails: DeliveryChannel[];
  initialTests: Record<string, DeliveryTestAttempt | null>;
  testRecipient: string;
  canEdit: boolean;
  canStoreCredentials: boolean;
  storeReady: boolean;
  signatureReady: boolean;
}) {
  const t = useTranslations("channels");
  const locale = normalizeLocale(useLocale()) ?? DEFAULT_LOCALE;
  const resolveError = useErrorMessage();
  const router = useRouter();
  const operation = useChannelOperation();
  const addOperation = useRef<ChannelOperation | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const [source, setSource] = useState(initialChannels);
  const [channels, setChannels] = useState(initialChannels);
  const [details, setDetails] = useState(
    Object.fromEntries(initialChannelDetails.map((row) => [row.id, row])),
  );
  const [addProvider, setAddProvider] = useState<ReturnType<
    typeof mergeProviderRecord
  > | null>(null);
  const [addError, setAddError] = useState("");

  // 服务端刷新后同步同一份事实；编辑期间保留当前表单与快照。
  if (source !== initialChannels && !operation.busy) {
    setSource(initialChannels);
    // 避免先前刷新返回的旧版本覆盖刚保存的新版本。
    setChannels((current) => {
      const merged = initialChannels.map((row) => {
        const local = current.find((item) => item.id === row.id);
        return local && local.version > row.version ? local : row;
      });
      return [
        ...merged,
        ...current.filter(
          (row) => !initialChannels.some((item) => item.id === row.id),
        ),
      ];
    });
    setDetails((current) => {
      const merged = { ...current };
      for (const row of initialChannelDetails) {
        if (!merged[row.id] || merged[row.id].version <= row.version)
          merged[row.id] = row;
      }
      return merged;
    });
  }

  function closeAdd() {
    setAddProvider(null);
    setAddError("");
    addOperation.current?.finish();
    addOperation.current = null;
  }

  function replaceChannels(rows: DeliveryChannelSummary[]) {
    setChannels(rows);
    setDetails((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, detail]) => {
          const summary = rows.find((row) => row.id === id);
          return [
            id,
            summary
              ? {
                  ...detail,
                  is_primary: summary.is_primary,
                  version: summary.version,
                }
              : detail,
          ];
        }),
      ),
    );
  }

  const providersById = useMemo(
    () => Object.fromEntries(providers.map((row) => [row.provider, row])),
    [providers],
  );

  const configuredProviders = new Set(channels.map((row) => row.provider));
  const addableProviders = providers.filter(
    (row) => row.enabled && !configuredProviders.has(row.provider),
  );
  const disabledProviders = providers.filter((row) => !row.enabled);

  function refreshList() {
    router.refresh();
  }

  function updateDetail(channel: DeliveryChannel | null, providerId: string) {
    if (!channel) {
      setDetails((current) => {
        const next = { ...current };
        const existing = channels.find((row) => row.provider === providerId);
        if (existing) delete next[existing.id];
        return next;
      });
      setChannels((current) =>
        current.filter((row) => row.provider !== providerId),
      );
      return;
    }
    setDetails((current) => ({ ...current, [channel.id]: channel }));
    setChannels((current) => {
      const summary: DeliveryChannelSummary = {
        id: channel.id,
        workspace_id: channel.workspace_id,
        provider: channel.provider,
        display_name:
          providersById[channel.provider]?.display_name ?? channel.provider,
        status: channel.status,
        is_primary: Boolean(channel.is_primary),
        region: channel.region,
        sender_domain: channel.sender_domain,
        sender_address: channel.sender_address,
        sender_alias: channel.sender_alias,
        credential_configured: channel.credential_configured,
        credential_hint: channel.credential_hint,
        tracking_enabled: channel.tracking_enabled,
        version: channel.version,
        updated_at: channel.updated_at,
      };
      const index = current.findIndex((row) => row.id === channel.id);
      if (index === -1) return [...current, summary];
      return current.map((row, idx) => (idx === index ? summary : row));
    });
  }

  const orderedChannels = [...channels].sort((left, right) => {
    if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
    return compareLocalized(
      t(`providers.${left.provider}.name`),
      t(`providers.${right.provider}.name`),
      locale,
    );
  });

  const nextStep = (
    <section className={styles.continuation} data-channel-next-step>
      <h3>{t("nextStep.title")}</h3>
      <p className={styles.supporting}>{t("nextStep.description")}</p>
      <div className={styles.actions}>
        {!storeReady && (
          <Button asChild variant="outline">
            <Link href={settingsSectionHref("store")}>
              {t("nextStep.completeAddress")}
            </Link>
          </Button>
        )}
        {!signatureReady && (
          <Button asChild variant="outline">
            <Link href={settingsSectionHref("profile")}>
              {t("nextStep.setSignature")}
            </Link>
          </Button>
        )}
        <Button asChild>
          <Link href="/dashboard#onboarding">
            {t("nextStep.backToDashboard")}
          </Link>
        </Button>
        {storeReady && (
          <Button asChild variant="outline">
            <Link href="/campaigns">{t("nextStep.goToCampaigns")}</Link>
          </Button>
        )}
      </div>
    </section>
  );

  return (
    <div className={styles.settings} data-channel-settings>
      {channels.length === 0 && (
        <div className={styles.intro}>
          <h3>{t("intro.title")}</h3>
          <p className={styles.supporting}>{t("intro.subtitle")}</p>
          <ul className={styles.preparation}>
            <li>
              <strong>{t("intro.senderTitle")}</strong>
              <span>{t("intro.senderBody")}</span>
            </li>
            <li>
              <strong>{t("intro.regionTitle")}</strong>
              <span>{t("intro.regionBody")}</span>
            </li>
            <li>
              <strong>{t("intro.credentialTitle")}</strong>
              <span>{t("intro.credentialBody")}</span>
            </li>
          </ul>
          <p className={styles.supporting}>{t("intro.footnote")}</p>
        </div>
      )}
      {!canEdit && (
        <p className={styles.supporting} role="status">
          {t("readOnlyNotice")}
        </p>
      )}
      {canEdit && !canStoreCredentials && (
        <div role="alert" className={styles.result}>
          <strong>{t("credentialKeyringUnavailableTitle")}</strong>
          <p className={styles.supporting}>
            {t("credentialKeyringUnavailableBody")}
          </p>
        </div>
      )}
      {orderedChannels.map((summary) => {
        const provider = providersById[summary.provider];
        if (!provider) return null;
        const detail =
          details[summary.id] ??
          ({
            ...summary,
            reply_to_address: "",
            credential_configured: summary.credential_configured,
            tracking_enabled: summary.tracking_enabled,
            created_at: summary.updated_at,
            capabilities: {
              display_name: provider.display_name,
              sender_alias_max_length: provider.sender_alias_max_length,
              requires_sender_domain: provider.requires_sender_domain,
              supports_open_tracking: provider.supports_open_tracking,
              supports_click_tracking: provider.supports_click_tracking,
              requires_html_for_tracking: provider.requires_html_for_tracking,
              supports_link_tracking_opt_out:
                provider.supports_link_tracking_opt_out,
              requires_webhook_subscription_confirmation:
                provider.requires_webhook_subscription_confirmation,
            },
          } as DeliveryChannel);
        return (
          <ChannelDetail
            key={summary.id}
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            provider={provider}
            channel={detail}
            initialTest={initialTests[summary.id] ?? null}
            testRecipient={testRecipient}
            canEdit={canEdit}
            canStoreCredentials={canStoreCredentials}
            operation={operation}
            nextStep={
              summary.is_primary &&
              summary.status === "verified" &&
              summary.credential_configured
                ? nextStep
                : null
            }
            onChannelsReplace={replaceChannels}
            onChannelChange={(channel) =>
              updateDetail(channel, summary.provider)
            }
            onChannelsListChange={refreshList}
          />
        );
      })}

      {canEdit && addableProviders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {addableProviders.map((provider) => (
            <Button
              key={provider.provider}
              variant="outline"
              disabled={!canStoreCredentials || operation.busy}
              onClick={(event) => {
                const request = operation.acquire();
                if (!request) return;
                addOperation.current = request;
                returnFocus.current = event.currentTarget;
                setAddError("");
                setAddProvider(provider);
              }}
            >
              <Plus aria-hidden="true" />
              {t("addProviderButton", {
                provider: t(`providers.${provider.provider}.addLabel`),
              })}
            </Button>
          ))}
        </div>
      )}

      {disabledProviders.length > 0 && (
        <div className="rounded-xl border border-dashed p-4">
          <p className="text-sm font-medium">{t("comingSoon")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {disabledProviders.map((provider) => (
              <Badge key={provider.provider} variant="secondary">
                {t("comingSoonItem", {
                  provider: t(`providers.${provider.provider}.name`),
                })}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {addProvider && (
        <ChannelFormDialog
          open={Boolean(addProvider)}
          onOpenChange={(open) => {
            if (!open) closeAdd();
          }}
          onReturnFocus={() =>
            requestAnimationFrame(() => {
              if (returnFocus.current?.isConnected) returnFocus.current.focus();
              else
                document
                  .querySelector<HTMLButtonElement>("[data-channel-primary]")
                  ?.focus();
            })
          }
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          provider={addProvider}
          channel={null}
          connected={false}
          error={addError}
          onError={setAddError}
          onSubmit={async (values) => {
            const request = addOperation.current;
            if (!request?.isCurrent()) return;
            try {
              const result = await saveDeliveryChannel(values);
              if (!request.isCurrent()) return;
              if ("error" in result) {
                setAddError(resolveError(result));
                return;
              }
              updateDetail(result.data, addProvider.provider);
              closeAdd();
              toast.success(t("toast.savedNeedTest"));
              refreshList();
            } catch {
              if (request.isCurrent())
                setAddError(t("toast.saveRequestIncomplete"));
            }
          }}
        />
      )}
    </div>
  );
}
