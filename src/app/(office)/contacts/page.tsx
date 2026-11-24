import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getContext } from "@/lib/workspace";
import { listContacts } from "@/features/contacts/actions";
import { Contacts } from "@/features/contacts/contacts";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";
import { planUsageFromDeliveryPlan } from "@/features/workspace/plan-usage";
import { ROOT_CLIENT_NAMESPACES } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";

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
  const [data, deliveryPlan, locale, messages] = await Promise.all([
    listContacts(filters),
    getWorkspaceDeliveryPlan(context.workspace.id),
    getLocale(),
    getMessages(),
  ]);
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={pickMessages(messages, [...ROOT_CLIENT_NAMESPACES, "contacts"])}
    >
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
    </NextIntlClientProvider>
  );
}
