import { getContext } from "@/lib/workspace";
import { listContacts } from "@/features/contacts/actions";
import { Contacts } from "@/features/contacts/contacts";
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
    listContacts(filters),
    getWorkspaceDeliveryPlan(context.workspace.id),
  ]);
  return (
    <Contacts
      key={context.workspace.id}
      workspace={context.workspace.id}
      canEdit={context.role !== "viewer"}
      contactQuota={
        planUsageFromDeliveryPlan(deliveryPlan)?.billableContacts ?? null
      }
      data={data}
      filters={filters}
    />
  );
}
