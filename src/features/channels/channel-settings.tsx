"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChannelDetail } from "./channel-detail";
import { ChannelFormDialog } from "./channel-form-dialog";
import type { DeliveryChannel, DeliveryTestAttempt } from "./model";
import {
  mergeProviderRecord,
  type DeliveryChannelSummary,
} from "./registry";
import { saveDeliveryChannel } from "./actions";

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
}) {
  const router = useRouter();
  const [channels, setChannels] = useState(initialChannels);
  const [details, setDetails] = useState(
    Object.fromEntries(initialChannelDetails.map((row) => [row.id, row])),
  );
  const [addProvider, setAddProvider] = useState<
    ReturnType<typeof mergeProviderRecord> | null
  >(null);
  const [addError, setAddError] = useState("");

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
    return left.display_name.localeCompare(right.display_name, "zh-CN");
  });

  return (
    <div className="space-y-4">
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
              disabled={!canStoreCredentials}
              onClick={() => {
                setAddError("");
                setAddProvider(provider);
              }}
            >
              <Plus aria-hidden="true" />
              添加 {provider.display_name}
            </Button>
          ))}
        </div>
      )}

      {disabledProviders.length > 0 && (
        <div className="rounded-xl border border-dashed p-4">
          <p className="text-sm font-medium">即将支持</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {disabledProviders.map((provider) => (
              <Badge key={provider.provider} variant="secondary">
                {provider.display_name}（尚未开放）
              </Badge>
            ))}
          </div>
        </div>
      )}

      {addProvider && (
        <ChannelFormDialog
          open={Boolean(addProvider)}
          onOpenChange={(open) => {
            if (!open) setAddProvider(null);
          }}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          provider={addProvider}
          channel={null}
          connected={false}
          error={addError}
          onError={setAddError}
          onSubmit={async (values) => {
            const result = await saveDeliveryChannel(values);
            if ("error" in result) {
              setAddError(result.error);
              return;
            }
            updateDetail(result.data, addProvider.provider);
            setAddProvider(null);
            toast.success(`${addProvider.display_name} 发信通道已连接`);
            refreshList();
          }}
        />
      )}

    </div>
  );
}
