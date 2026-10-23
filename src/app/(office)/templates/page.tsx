import { getContext } from "@/lib/workspace";
import { listTemplates } from "@/features/templates/actions";
import { Templates } from "@/features/templates/templates";
import { listDeliveryChannels } from "@/features/channels/actions";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";
import { planUsageFromDeliveryPlan } from "@/features/workspace/plan-usage";

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
  const [data, deliveryPlan, channels] = await Promise.all([
    listTemplates(filters),
    getWorkspaceDeliveryPlan(context.workspace.id),
    listDeliveryChannels(context.workspace.id),
  ]);
  const primaryChannel = channels.find((channel) => channel.is_primary);
  return (
    <Templates
      key={context.workspace.id}
      workspace={context.workspace.id}
      workspaceName={context.workspace.name}
      memberName={context.member.display_name}
      mailingAddress={context.workspace.mailing_address}
      senderAlias={primaryChannel?.sender_alias ?? ""}
      senderAddress={primaryChannel?.sender_address ?? ""}
      canEdit={context.role !== "viewer"}
      customTemplateQuota={
        planUsageFromDeliveryPlan(deliveryPlan)?.customTemplates ?? null
      }
      data={data}
      filters={filters}
    />
  );
}
