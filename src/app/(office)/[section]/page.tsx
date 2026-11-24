import { PageHeader } from "@/components/page-header";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { getContext } from "@/lib/workspace";
import { ROOT_CLIENT_NAMESPACES } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";
import { serverClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { SettingsForm } from "@/components/settings-form";
import { SettingsSectionNav } from "@/components/settings-section-nav";
import { MemberProfileForm } from "@/components/member-profile-form";
import { SETTINGS_SECTION_IDS } from "@/features/settings/anchors";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listContacts } from "@/features/contacts/actions";
import { listTemplates } from "@/features/templates/actions";
import { listActivityLogs } from "@/features/audit/actions";
import { activityLabel } from "@/features/audit/model";
import { getWorkspaceCampaignStatistics } from "@/features/campaigns/actions";
import { listCampaigns } from "@/features/campaigns/actions";
import { campaignStatusLabels } from "@/features/campaigns/model";
import {
  getDeliveryChannel,
  getDeliveryTestSummary,
  listDeliveryChannels,
  listDeliveryProviders,
} from "@/features/channels/actions";
import { ChannelSettings } from "@/features/channels/channel-settings";
import { credentialStorageReady } from "@/features/channels/credentials";
import { listTeam } from "@/features/team/actions";
import { TeamManager } from "@/features/team/team-manager";
import { HelpGuide } from "@/features/help/help-guide";
import { getWorkspaceBillingStatus } from "@/features/workspace/billing";
import { BillingUpgrade } from "@/features/workspace/billing-upgrade";
import { CheckoutSuccessToast } from "@/features/workspace/checkout-toast";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";
import { edmCheckoutAvailability } from "@/lib/billing/edm-product-config";
import { ThemeSegmented } from "@/components/theme-toggle";
import { LocaleSegmented } from "@/components/locale-switcher";
import { mailingAddressProblem } from "@/lib/mailing-address";
import { isMemberSenderNameCustomized } from "@/lib/sender-name";
import { LocalDate } from "@/components/local-date";
import { channelSetupCopy } from "@/features/channels/channel-presentation";
import { PreparationGuide } from "@/features/onboarding/preparation-guide";
import { preparationHref } from "@/features/onboarding/links";
import {
  preparationWritePermission,
  type PreparationFacts,
} from "@/features/onboarding/model";
import styles from "@/features/onboarding/preparation.module.css";

function available<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}
const pages: Record<
  string,
  { title: string; description: string; empty: string }
> = {
  contacts: {
    title: "客户名单",
    description: "支持名单导入、标签筛选和订阅状态管理。",
    empty: "暂无客户，添加或导入第一批联系人",
  },
  templates: {
    title: "邮件模板库",
    description: "支持纯文本模板与动态变量插入，快速复用。",
    empty: "暂无模板，创建你的第一套邮件模板",
  },
  campaigns: {
    title: "发信活动",
    description: "支持准备草稿、受众预览、锁定名单与正式发送。",
    empty: "暂无发信活动，创建一份新活动草稿",
  },
  logs: {
    title: "操作记录",
    description: "记录工作区内的关键操作动态与审计日志。",
    empty: "暂无操作记录，产生业务变动后将在此记录",
  },
};
export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<Metadata> {
  const { section } = await params;
  if (section === "dashboard") {
    const t = await getTranslations("dashboard");
    return { title: t("title") };
  }
  if (section === "settings") {
    const t = await getTranslations("settings");
    return { title: t("pageTitle") };
  }
  if (section === "team") {
    const t = await getTranslations("team");
    return { title: t("title") };
  }
  if (section === "help") {
    const t = await getTranslations("help");
    return { title: t("title") };
  }
  if (section === "contacts") {
    const t = await getTranslations("contacts");
    return { title: t("title") };
  }
  if (section === "templates") {
    const t = await getTranslations("templates");
    return { title: t("title") };
  }
  if (section === "campaigns") {
    const t = await getTranslations("campaigns");
    return { title: t("title") };
  }
  if (section === "logs") {
    const t = await getTranslations("audit");
    return { title: t("title") };
  }
  return {};
}

export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (
    !["dashboard", "team", "settings", "help", ...Object.keys(pages)].includes(
      section,
    )
  )
    notFound();
  const { workspace, role, user, member } = await getContext();
  if (section === "help") {
    const [locale, messages, tHelp] = await Promise.all([
      getLocale(),
      getMessages(),
      getTranslations("help"),
    ]);
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={pickMessages(messages, [...ROOT_CLIENT_NAMESPACES, "help"])}
      >
        <PageHeader
          title={tHelp("title")}
          meta={<Badge variant="secondary">{tHelp("badge")}</Badge>}
        />
        <HelpGuide role={role} />
      </NextIntlClientProvider>
    );
  }
  if (section === "settings") {
    const [providers, channelSummaries, deliveryPlan, billingStatus] =
      await Promise.all([
        listDeliveryProviders(),
        listDeliveryChannels(workspace.id),
        getWorkspaceDeliveryPlan(workspace.id),
        role === "admin"
          ? getWorkspaceBillingStatus(workspace.id)
          : Promise.resolve(null),
      ]);
    const channelDetails = await Promise.all(
      channelSummaries.map((summary) => getDeliveryChannel(summary.id)),
    );
    const initialTests: Record<
      string,
      Awaited<ReturnType<typeof getDeliveryTestSummary>> | null
    > = {};
    if (role === "admin") {
      await Promise.all(
        channelSummaries.map(async (summary) => {
          initialTests[summary.id] = await getDeliveryTestSummary(summary.id);
        }),
      );
    }
    const [locale, messages, tSettings] = await Promise.all([
      getLocale(),
      getMessages(),
      getTranslations("settings"),
    ]);
    const settingsClientMessages = pickMessages(messages, [
      ...ROOT_CLIENT_NAMESPACES,
      "settings",
      "billing",
      "channels",
    ]);
    return (
      <NextIntlClientProvider locale={locale} messages={settingsClientMessages}>
        <PageHeader
          title={tSettings("pageTitle")}
          meta={
            <Badge variant="secondary">{tSettings("workspaceBadge")}</Badge>
          }
        />
        <Suspense fallback={null}>
          <CheckoutSuccessToast />
        </Suspense>
        <SettingsSectionNav showBilling={Boolean(deliveryPlan)} />
        <section id={SETTINGS_SECTION_IDS.store} className="settings-section">
          <Card>
            <CardContent>
              <h2 className="mb-2">{tSettings("store.title")}</h2>
              <p className="hint">{tSettings("store.description")}</p>
              <SettingsForm
                key={workspace.id}
                name={workspace.name}
                address={workspace.mailing_address}
                canEdit={role === "admin"}
              />
            </CardContent>
          </Card>
          <Card className="mt-4" id={SETTINGS_SECTION_IDS.profile}>
            <CardContent>
              <h2 className="mb-2">{tSettings("profile.title")}</h2>
              <p className="hint">{tSettings("profile.description")}</p>
              <MemberProfileForm
                key={`${member.display_name}:${member.display_name_customized}`}
                displayName={member.display_name}
                displayNameCustomized={member.display_name_customized}
              />
            </CardContent>
          </Card>
        </section>
        <section
          id={SETTINGS_SECTION_IDS.channels}
          className="settings-section mt-7 space-y-3"
        >
          <div>
            <h2>{tSettings("channels.title")}</h2>
            <p className="hint mt-2 mb-0">
              {tSettings("channels.descriptionPrefix")}{" "}
              <Link
                href="/help#help-directmail-setup"
                className="inline-flex min-h-11 items-center underline underline-offset-2"
              >
                {tSettings("channels.directmailGuide")}
              </Link>
              {tSettings("channels.descriptionSuffix")}
            </p>
          </div>
          <ChannelSettings
            key={`${workspace.id}:${user.id}:${role}`}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            providers={providers}
            initialChannels={channelSummaries}
            initialChannelDetails={channelDetails.filter(
              (channel): channel is NonNullable<typeof channel> =>
                channel !== null,
            )}
            initialTests={initialTests}
            testRecipient={user.email ?? ""}
            canEdit={role === "admin"}
            canStoreCredentials={credentialStorageReady()}
            storeReady={
              Boolean(workspace.mailing_address.trim()) &&
              !mailingAddressProblem(workspace.mailing_address)
            }
            signatureReady={isMemberSenderNameCustomized(member)}
          />
        </section>
        {deliveryPlan && (
          <section
            id={SETTINGS_SECTION_IDS.billing}
            className="settings-section mt-7"
          >
            <BillingUpgrade
              workspaceId={workspace.id}
              deliveryPlan={deliveryPlan}
              billing={billingStatus}
              canUpgrade={role === "admin"}
              checkoutAvailability={edmCheckoutAvailability()}
            />
          </section>
        )}
        <section
          id={SETTINGS_SECTION_IDS.appearance}
          className="settings-section mt-7"
        >
          <Card>
            <CardContent className="space-y-6">
              <div>
                <h2 className="mb-2">{tSettings("appearance.title")}</h2>
                <p className="hint mb-4">
                  {tSettings("appearance.description")}
                </p>
                <ThemeSegmented />
              </div>
              <div className="border-t border-border/70 pt-5">
                <h3 className="mb-2 text-base font-semibold">
                  {tSettings("appearance.languageTitle")}
                </h3>
                <p className="hint mb-4">
                  {tSettings("appearance.languageDescription")}
                </p>
                <LocaleSegmented />
              </div>
            </CardContent>
          </Card>
        </section>
      </NextIntlClientProvider>
    );
  }
  if (section === "dashboard" || section === "team") {
    const db = await serverClient();
    const { data: members, error } = await db
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("status", "active");
    if (error && section === "team")
      throw new Error("成员信息加载失败，请重试。");
    const deliveryPlan = await getWorkspaceDeliveryPlan(workspace.id);
    if (section === "team") {
      const tTeam = await getTranslations("team");
      if (!deliveryPlan?.allows_team_collaboration) {
        return (
          <>
            <PageHeader title={tTeam("title")} />
            <EmptyState
              kind="restricted"
              title={tTeam("restricted.title")}
              description={tTeam("restricted.description")}
            >
              {role === "admin" && (
                <Button asChild>
                  <Link href="/settings">
                    {tTeam("restricted.upgradeAction")}
                  </Link>
                </Button>
              )}
            </EmptyState>
          </>
        );
      }
      const [team, teamDeliveryPlan, locale, messages] = await Promise.all([
        listTeam(workspace.id),
        getWorkspaceDeliveryPlan(workspace.id),
        getLocale(),
        getMessages(),
      ]);
      const memberCapNote =
        teamDeliveryPlan &&
        teamDeliveryPlan.active_members > teamDeliveryPlan.max_active_members
          ? tTeam("memberCapNote")
          : null;
      return (
        <NextIntlClientProvider
          locale={locale}
          messages={pickMessages(messages, [...ROOT_CLIENT_NAMESPACES, "team"])}
        >
          <PageHeader
            title={tTeam("title")}
            meta={tTeam("metaCount", { count: team.members.length })}
            description={
              team.workspace.type === "team"
                ? tTeam("descriptionTeam")
                : tTeam("descriptionPersonal")
            }
          />
          <TeamManager
            initialData={team}
            currentUserId={user.id}
            canManage={role === "admin"}
            memberCapNote={memberCapNote}
          />
        </NextIntlClientProvider>
      );
    }
    const canViewLogs =
      role === "admin" &&
      deliveryPlan !== null &&
      deliveryPlan.activity_log_retention_days !== 0;
    const [
      contactsResult,
      subscribedResult,
      templatesResult,
      statisticsResult,
      activityResult,
      campaignsResult,
      channelsResult,
    ] = await Promise.allSettled([
      listContacts({}),
      listContacts({ subscription: "subscribed" }),
      listTemplates({}),
      getWorkspaceCampaignStatistics(),
      canViewLogs ? listActivityLogs({ pageSize: 8 }) : Promise.resolve(null),
      listCampaigns({ page: "1" }),
      listDeliveryChannels(workspace.id),
    ]);
    const contactSummary = available(contactsResult);
    const subscribedSummary = available(subscribedResult);
    const templateSummary = available(templatesResult);
    const campaignStatistics = available(statisticsResult);
    const recentActivity = available(activityResult);
    const recentCampaigns = available(campaignsResult);
    const channelSummaries = available(channelsResult);
    const statsAvailable = deliveryPlan?.allows_campaign_statistics ?? false;
    const weightedOpenRate =
      statsAvailable && campaignStatistics?.delivered
        ? `${Math.round(
            (campaignStatistics.opened / campaignStatistics.delivered) * 100,
          )}%`
        : "—";
    const primaryChannel =
      channelSummaries?.find((channel) => channel.is_primary) ?? null;
    const hasVerifiedPrimaryChannel = Boolean(
      primaryChannel?.status === "verified" &&
      primaryChannel.credential_configured,
    );
    const canWrite = preparationWritePermission(role, deliveryPlan);
    // 页头动作与空态卡头共用同一目标：无模板时先建模板，避免落到无法新建的活动页。
    const createTarget: "templates" | "campaigns" | null =
      canWrite === true
        ? templateSummary?.active_count === 0
          ? "templates"
          : "campaigns"
        : null;
    const [locale, messages, tDash, tAudit] = await Promise.all([
      getLocale(),
      getMessages(),
      getTranslations("dashboard"),
      getTranslations("audit"),
    ]);
    const dashboardClientMessages = pickMessages(messages, [
      ...ROOT_CLIENT_NAMESPACES,
      "dashboard",
    ]);
    const auditActionText = (action: string) => {
      const key = `actions.${action.replaceAll(".", "_")}`;
      if (tAudit.has(key as never)) return tAudit(key as never);
      return activityLabel(action);
    };
    const createLabel =
      createTarget === "templates"
        ? tDash("createTemplate")
        : tDash("createCampaign");
    const facts: PreparationFacts = {
      role,
      canWrite,
      storeReady:
        Boolean(workspace.mailing_address.trim()) &&
        !mailingAddressProblem(workspace.mailing_address),
      signatureReady: isMemberSenderNameCustomized(member),
      channel:
        channelSummaries === null
          ? null
          : {
              ready: hasVerifiedPrimaryChannel,
              detail: primaryChannel
                ? channelSetupCopy(primaryChannel).detail
                : channelSummaries.length
                  ? tDash("channelSelectPrimary")
                  : channelSetupCopy(null).detail,
            },
      contacts:
        contactSummary && subscribedSummary
          ? {
              active: contactSummary.active_count,
              subscribed: subscribedSummary.total,
            }
          : null,
      templates: templateSummary?.active_count ?? null,
      campaigns: recentCampaigns?.total ?? null,
    };
    const hasCampaigns = (recentCampaigns?.total ?? 0) > 0;
    const guide = (
      <PreparationGuide
        key={`${workspace.id}:${user.id}:${role}`}
        facts={facts}
        userId={user.id}
        workspaceId={workspace.id}
        otherDataUnavailable={
          Boolean(error) ||
          deliveryPlan === null ||
          statisticsResult.status === "rejected" ||
          activityResult.status === "rejected"
        }
      />
    );
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={dashboardClientMessages}
      >
        <PageHeader
          title={workspace.name}
          description={tDash("description")}
          actions={
            createTarget ? (
              <Button asChild>
                <Link href={preparationHref(createTarget)}>
                  <Plus aria-hidden />
                  {createLabel}
                </Link>
              </Button>
            ) : undefined
          }
        />
        {!hasCampaigns && guide}
        <div className="stat-grid">
          {[
            {
              label: tDash("stats.contacts"),
              value: contactSummary ? String(contactSummary.active_count) : "—",
              href: "/contacts",
            },
            {
              label: tDash("stats.templates"),
              value: templateSummary
                ? String(templateSummary.active_count)
                : "—",
              href: "/templates",
            },
            {
              label: tDash("stats.members"),
              value: error ? "—" : String(members?.length ?? 0),
              href: "/team",
            },
            {
              label: tDash("stats.openRate"),
              value: weightedOpenRate,
              href: "/campaigns",
            },
          ].map(({ label, value, href }) => (
            <Link key={label} href={href} className="stat-card-link">
              <Card className="stat-card">
                <CardContent>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        <p className="hint">
          {tDash("summaryPrefix")}
          {subscribedSummary
            ? tDash("subscribedCount", { count: subscribedSummary.total })
            : tDash("subscribedUnknown")}
          {tDash("summaryMiddle")}
          {statsAvailable && campaignStatistics
            ? tDash("openRateFormula", {
                opened: campaignStatistics.opened,
                delivered: campaignStatistics.delivered,
                tracked: campaignStatistics.tracked_campaigns,
              })
            : deliveryPlan === null
              ? tDash("planUnavailable")
              : statsAvailable
                ? tDash("statsUnavailable")
                : tDash("statsPaidOnly")}
        </p>
        <div className={styles.recent}>
          <Card>
            <CardContent>
              <div className="section-heading mb-3">
                <h2>{tDash("recentCampaigns.title")}</h2>
                {recentCampaigns?.items.length ? (
                  <Link
                    href="/campaigns"
                    className="text-xs underline underline-offset-2"
                  >
                    {tDash("recentCampaigns.viewAll")}
                  </Link>
                ) : createTarget ? (
                  <Link
                    href={preparationHref(createTarget)}
                    className="text-xs underline underline-offset-2"
                  >
                    {createLabel}
                  </Link>
                ) : null}
              </div>
              {recentCampaigns?.items.length ? (
                <div className="dashboard-campaign-list">
                  {recentCampaigns.items.slice(0, 5).map((campaign) => (
                    <Link
                      key={campaign.id}
                      href={`/campaigns?q=${encodeURIComponent(campaign.name)}`}
                      className="dashboard-campaign-row"
                    >
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate">
                          {campaign.name}
                        </strong>
                        <span className="hint m-0">
                          {tDash("recentCampaigns.recipients", {
                            count: campaign.recipient_count ?? 0,
                          })}
                        </span>
                      </span>
                      <Badge variant="outline">
                        {tDash.has(`campaignStatus.${campaign.status}` as never)
                          ? tDash(`campaignStatus.${campaign.status}` as never)
                          : campaignStatusLabels[campaign.status]}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="dashboard-success">
                  {recentCampaigns === null
                    ? tDash("recentCampaigns.unavailable")
                    : createTarget === "templates"
                      ? tDash("recentCampaigns.emptyNeedTemplate")
                      : canWrite === true
                        ? tDash("recentCampaigns.emptyCanWrite")
                        : tDash("recentCampaigns.emptyReadOnly")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
        {hasCampaigns && guide}
        <div className="section-heading">
          <h2>{tDash("recentActivity.title")}</h2>
          {canViewLogs && (
            <Link href="/logs" className="text-xs underline underline-offset-2">
              {tDash("recentActivity.viewAll")}
            </Link>
          )}
        </div>
        {recentActivity?.items.length ? (
          <Card>
            <CardContent className="pt-3">
              {recentActivity.items.map((item) => (
                <div className="member-row" key={item.id}>
                  <span className="avatar">{item.actor_name.slice(0, 2)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {auditActionText(item.action)}
                      {item.target_label ? ` · ${item.target_label}` : ""}
                    </p>
                    <p className="hint m-0">
                      {item.actor_name} · <LocalDate value={item.created_at} />
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : canViewLogs && activityResult.status === "rejected" ? (
          <p className="hint">{tDash("recentActivity.unavailable")}</p>
        ) : canViewLogs ? (
          <EmptyState
            title={tDash("recentActivity.emptyTitle")}
            description={tDash("recentActivity.emptyDescription")}
          />
        ) : (
          <EmptyState
            kind="restricted"
            title={
              role === "admin"
                ? deliveryPlan === null
                  ? tDash("recentActivity.planCheckTitle")
                  : tDash("recentActivity.noLogsTitle")
                : tDash("recentActivity.adminOnlyTitle")
            }
            description={
              role === "admin"
                ? deliveryPlan === null
                  ? tDash("recentActivity.planCheckDescription")
                  : tDash("recentActivity.noLogsDescription")
                : tDash("recentActivity.adminOnlyDescription")
            }
          >
            {role === "admin" && (
              <Button asChild variant="outline">
                <Link href="/settings">{tDash("recentActivity.viewPlan")}</Link>
              </Button>
            )}
          </EmptyState>
        )}
      </NextIntlClientProvider>
    );
  }
  const page = pages[section];
  return (
    <>
      <PageHeader
        title={page.title}
        meta={<Badge variant="outline">待接入</Badge>}
      />
      <EmptyState title={page.empty} description={page.description} />
    </>
  );
}
