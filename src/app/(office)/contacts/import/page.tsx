import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getContext } from "@/lib/workspace";
import {
  getContactImport,
  listContactImports,
} from "@/features/contacts/import-actions";
import { ContactImporter } from "@/features/contacts/contact-importer";
import { ROOT_CLIENT_NAMESPACES } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; page?: string }>;
}) {
  const context = await getContext();
  if (context.role === "viewer") redirect("/contacts");
  const params = await searchParams;
  const [history, selected, locale, messages] = await Promise.all([
    listContactImports(context.workspace.id),
    params.id
      ? getContactImport({
          workspace_id: context.workspace.id,
          id: params.id,
          page: Math.max(1, Number.parseInt(params.page ?? "1") || 1),
        })
      : Promise.resolve(undefined),
    getLocale(),
    getMessages(),
  ]);
  const initialJob = selected && "data" in selected ? selected.data : undefined;
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={pickMessages(messages, [...ROOT_CLIENT_NAMESPACES, "contacts"])}
    >
      <ContactImporter
        key={context.workspace.id}
        workspace={context.workspace.id}
        history={history}
        initialJob={initialJob}
        selectedId={params.id}
        initialError={
          selected && "error" in selected ? selected.error : undefined
        }
      />
    </NextIntlClientProvider>
  );
}
