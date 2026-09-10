import { redirect } from "next/navigation";
import { getContext } from "@/lib/workspace";
import {
  getContactImport,
  listContactImports,
} from "@/features/contacts/import-actions";
import { ContactImporter } from "@/features/contacts/contact-importer";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; page?: string }>;
}) {
  const context = await getContext();
  if (context.role === "viewer") redirect("/contacts");
  const params = await searchParams;
  const [history, selected] = await Promise.all([
    listContactImports(context.workspace.id),
    params.id
      ? getContactImport({
          workspace_id: context.workspace.id,
          id: params.id,
          page: Math.max(1, Number.parseInt(params.page ?? "1") || 1),
        })
      : Promise.resolve(undefined),
  ]);
  const initialJob = selected && "data" in selected ? selected.data : undefined;
  return (
    <ContactImporter
      workspace={context.workspace.id}
      history={history}
      initialJob={initialJob}
    />
  );
}
