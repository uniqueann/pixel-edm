import { getContext } from "@/lib/workspace";
import { listTemplates } from "@/features/templates/actions";
import { Templates } from "@/features/templates/templates";

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
  const data = await listTemplates(filters);
  return (
    <Templates
      key={context.workspace.id}
      workspace={context.workspace.id}
      workspaceName={context.workspace.name}
      memberName={context.member.display_name}
      canEdit={context.role !== "viewer"}
      data={data}
      filters={filters}
    />
  );
}
