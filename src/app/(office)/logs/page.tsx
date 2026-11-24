import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { listActivityLogs } from "@/features/audit/actions";
import { ActivityLogs } from "@/features/audit/activity-logs";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";
import { ROOT_CLIENT_NAMESPACES } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";
import { getContext } from "@/lib/workspace";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
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
  if (context.role !== "admin") notFound();
  const [plan, tAudit] = await Promise.all([
    getWorkspaceDeliveryPlan(context.workspace.id),
    getTranslations("audit"),
  ]);
  if (!plan || plan.activity_log_retention_days === 0) {
    return (
      <EmptyState
        kind="restricted"
        title={tAudit("restrictedTitle")}
        description={tAudit("restrictedDescription")}
      >
        <Button asChild variant="outline">
          <Link href="/settings">{tAudit("viewPlanDetails")}</Link>
        </Button>
      </EmptyState>
    );
  }
  const [data, locale, messages] = await Promise.all([
    listActivityLogs(filters),
    getLocale(),
    getMessages(),
  ]);
  const clientMessages = pickMessages(messages, [
    ...ROOT_CLIENT_NAMESPACES,
    "audit",
  ]);
  return (
    <NextIntlClientProvider locale={locale} messages={clientMessages}>
      <ActivityLogs data={data} filters={filters} />
    </NextIntlClientProvider>
  );
}
