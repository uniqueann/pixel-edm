import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { getContext } from "@/lib/workspace";
import { listTemplates } from "@/features/templates/actions";
import { Templates } from "@/features/templates/templates";
import { listDeliveryChannels } from "@/features/channels/actions";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";
import { planUsageFromDeliveryPlan } from "@/features/workspace/plan-usage";
import { ROOT_CLIENT_NAMESPACES } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("templates");
  return { title: t("title") };
}

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
  const [data, deliveryPlan, channels, locale, messages] = await Promise.all([
    listTemplates(filters),
    getWorkspaceDeliveryPlan(context.workspace.id),
    listDeliveryChannels(context.workspace.id),
    getLocale(),
    getMessages(),
  ]);
  const primaryChannel = channels.find((channel) => channel.is_primary);
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={pickMessages(messages, [
        ...ROOT_CLIENT_NAMESPACES,
        "templates",
      ])}
    >
      <Templates
        key={context.workspace.id}
        workspace={context.workspace.id}
        workspaceName={context.workspace.name}
        memberName={context.member.display_name}
        memberDisplayNameCustomized={context.member.display_name_customized}
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
    </NextIntlClientProvider>
  );
}
