import { getContext } from "@/lib/workspace";
import {
  getCampaignEditorOptions,
  listCampaigns,
} from "@/features/campaigns/actions";
import { Campaigns } from "@/features/campaigns/campaigns";
import type { CampaignEditorOptions } from "@/features/campaigns/model";
import { listDeliveryChannels } from "@/features/channels/actions";
import type { SendReadinessContext } from "@/features/campaigns/send-readiness";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";
import { planUsageFromDeliveryPlan } from "@/features/workspace/plan-usage";

const emptyOptions: CampaignEditorOptions = { templates: [], tags: [] };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const exportError =
    typeof raw.export_error === "string" ? raw.export_error : null;
  const filters = Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[0] !== "export_error",
    ),
  );
  const context = await getContext();
  const canEdit = context.role !== "viewer";
  const canSend = context.role === "admin";
  const [data, options, deliveryPlan, channels] = await Promise.all([
    listCampaigns(filters),
    canEdit ? getCampaignEditorOptions() : Promise.resolve(emptyOptions),
    getWorkspaceDeliveryPlan(context.workspace.id),
    listDeliveryChannels(context.workspace.id),
  ]);
  const maxRecipientsPerCampaign =
    deliveryPlan?.max_recipients_per_campaign ?? 500;
  const primaryChannel = channels.find((channel) => channel.is_primary);
  const sendReadiness: SendReadinessContext | null = canSend
    ? {
        primaryChannel: primaryChannel
          ? {
              display_name: primaryChannel.display_name,
              status: primaryChannel.status,
              sender_address: primaryChannel.sender_address,
              credential_configured: primaryChannel.credential_configured,
            }
          : null,
        mailingAddress: context.workspace.mailing_address,
        quota: deliveryPlan
          ? {
              daily_send_quota: deliveryPlan.daily_send_quota,
              usage_today: deliveryPlan.usage_today,
              quota_timezone: deliveryPlan.quota_timezone,
            }
          : null,
        maxRecipientsPerCampaign,
      }
    : null;

  return (
    <Campaigns
      key={context.workspace.id}
      workspace={context.workspace.id}
      workspaceName={context.workspace.name}
      memberName={context.member.display_name}
      mailingAddress={context.workspace.mailing_address}
      senderAlias={primaryChannel?.sender_alias ?? ""}
      senderAddress={primaryChannel?.sender_address ?? ""}
      canEdit={canEdit}
      canSend={canSend}
      maxRecipientsPerCampaign={maxRecipientsPerCampaign}
      sendReadiness={sendReadiness}
      planUsage={planUsageFromDeliveryPlan(deliveryPlan)}
      data={data}
      editorOptions={options}
      filters={filters}
      initialExportError={exportError}
    />
  );
}
