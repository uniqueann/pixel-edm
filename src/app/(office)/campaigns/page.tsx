import { getContext } from "@/lib/workspace";
import {
  getCampaignEditorOptions,
  listCampaigns,
} from "@/features/campaigns/actions";
import { Campaigns } from "@/features/campaigns/campaigns";
import type { CampaignEditorOptions } from "@/features/campaigns/model";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";

const emptyOptions: CampaignEditorOptions = { templates: [], tags: [] };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const context = await getContext();
  const canEdit = context.role !== "viewer";
  const canSend = context.role === "admin";
  const [data, options, deliveryPlan] = await Promise.all([
    listCampaigns(filters),
    canEdit ? getCampaignEditorOptions() : Promise.resolve(emptyOptions),
    getWorkspaceDeliveryPlan(context.workspace.id),
  ]);

  return (
    <Campaigns
      key={context.workspace.id}
      workspace={context.workspace.id}
      workspaceName={context.workspace.name}
      memberName={context.member.display_name}
      canEdit={canEdit}
      canSend={canSend}
      maxRecipientsPerCampaign={
        deliveryPlan?.max_recipients_per_campaign ?? 500
      }
      data={data}
      editorOptions={options}
      filters={filters}
    />
  );
}
