import { getContext } from "@/lib/workspace";
import { listContacts } from "@/features/contacts/actions";
import { Contacts } from "@/features/contacts/contacts";
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
  const data = await listContacts(filters);
  return (
    <Contacts
      key={context.workspace.id}
      workspace={context.workspace.id}
      canEdit={context.role !== "viewer"}
      data={data}
      filters={filters}
    />
  );
}
