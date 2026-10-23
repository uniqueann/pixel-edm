import { getContext } from "@/lib/workspace";
import { listTemplates } from "@/features/templates/actions";
import { Templates } from "@/features/templates/templates";
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
  const [data, deliveryPlan] = await Promise.all([
    listTemplates(filters),
    getWorkspaceDeliveryPlan(context.workspace.id),
  ]);
  return (
    <Templates
      key={context.workspace.id}
      workspace={context.workspace.id}
      workspaceName={context.workspace.name}
      memberName={context.member.display_name}
      canEdit={context.role !== "viewer"}
      customTemplateQuota={
        planUsageFromDeliveryPlan(deliveryPlan)?.customTemplates ?? null
      }
      data={data}
      filters={filters}
    />
  );
}
