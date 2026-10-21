import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { SettingsForm } from "@/components/settings-form";
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
  const { workspace, role, user } = await getContext();
  if (section === "help") {
    return (
      <>
        <div className="section-heading">
          <h1>使用帮助</h1>
          <Badge variant="secondary">文档</Badge>
        </div>
        <HelpGuide role={role} />
      </>
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
    return (
      <>
        <div className="section-heading">
          <h1>邮局设置</h1>
          <Badge variant="secondary">工作区</Badge>
        </div>
        <Suspense fallback={null}>
          <CheckoutSuccessToast />
        </Suspense>
        {deliveryPlan && (
          <div className="mb-4">
            <BillingUpgrade
              workspaceId={workspace.id}
              deliveryPlan={deliveryPlan}
              billing={billingStatus}
              canUpgrade={role === "admin"}
              checkoutAvailability={edmCheckoutAvailability()}
            />
          </div>
        )}
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-2">店铺信息</h2>
            <p className="hint">用于邮件页脚落款与发件人默认信息。</p>
            <SettingsForm
              key={workspace.id}
              name={workspace.name}
              address={workspace.mailing_address}
              canEdit={role === "admin"}
            />
          </CardContent>
        </Card>
        <Card className="mt-4">
          <CardContent className="pt-6">
            <h2 className="mb-2">界面外观</h2>
            <p className="hint mb-4">
              选择适合你的视觉风格，支持浅色、深色或随系统自动切换。
            </p>
            <ThemeSegmented />
          </CardContent>
        </Card>
        <div className="mt-7 space-y-3">
          <div>
            <h2>发信通道</h2>
            <p className="hint mt-2 mb-0">
              为工作区配置发信服务商与主通道，保存后可发送测试邮件验证连通性。首次开通请参考{" "}
              <Link
                href="/help#help-directmail-setup"
                className="underline underline-offset-2"
              >
                DirectMail 图文教程
              </Link>
              。
            </p>
          </div>
          <ChannelSettings
            key={workspace.id}
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
          />
        </div>
      </>
    );
  }
  if (section === "dashboard" || section === "team") {
    const db = await serverClient();
    const { data: members, error } = await db
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("status", "active");
    if (error) throw new Error("成员信息加载失败，请重试。");
    const deliveryPlan = await getWorkspaceDeliveryPlan(workspace.id);
    if (section === "team") {
      if (!deliveryPlan?.allows_team_collaboration) {
        return (
          <>
            <div className="section-heading">
              <h1>团队成员</h1>
            </div>
            <EmptyState
              title="多人协作仅在团队版可用"
              description="升级团队版后可邀请成员协同管理、分配角色权限并查看完整操作记录。"
            >
              {role === "admin" && (
                <Button asChild>
                  <Link href="/settings">前往升级团队版</Link>
                </Button>
              )}
            </EmptyState>
          </>
        );
      }
      const [team, teamDeliveryPlan] = await Promise.all([
        listTeam(workspace.id),
        getWorkspaceDeliveryPlan(workspace.id),
      ]);
      const memberCapNote =
        teamDeliveryPlan &&
        teamDeliveryPlan.active_members > teamDeliveryPlan.max_active_members
          ? "当前活跃成员数已超出套餐席位。成员仍会保留，但运营人员的操作权限已暂停。管理员可移除多余成员或升级套餐以恢复。"
          : null;
      return (
        <>
          <div className="section-heading">
            <div>
              <h1>团队成员</h1>
              <p className="hint mt-1 mb-0">
                {team.workspace.type === "team"
                  ? "邀请同事协作管理客户、模板和活动草稿。"
                  : "创建第一条邀请后，个人工作区会转换为团队工作区。"}
              </p>
            </div>
            <span className="hint m-0">{team.members.length} 人</span>
          </div>
          <TeamManager
            initialData={team}
            currentUserId={user.id}
            canManage={role === "admin"}
            memberCapNote={memberCapNote}
          />
        </>
      );
    }
    const canViewLogs =
      role === "admin" &&
      deliveryPlan !== null &&
      deliveryPlan.activity_log_retention_days !== 0;
    const [
      contactSummary,
      templateSummary,
      campaignStatistics,
      recentActivity,
      recentCampaigns,
      channelSummaries,
    ] = await Promise.all([
      listContacts({}),
      listTemplates({}),
      getWorkspaceCampaignStatistics(),
      canViewLogs ? listActivityLogs({ pageSize: 5 }) : Promise.resolve(null),
      listCampaigns({ page: "1" }),
      listDeliveryChannels(workspace.id),
    ]);
    const statsAvailable = deliveryPlan?.allows_campaign_statistics ?? false;
    const weightedOpenRate =
      statsAvailable && campaignStatistics.delivered
        ? `${Math.round(
            (campaignStatistics.opened / campaignStatistics.delivered) * 100,
          )}%`
        : "—";
    const canEdit = role !== "viewer";
    const hasVerifiedPrimaryChannel = channelSummaries.some(
      (channel) => channel.is_primary && channel.status === "verified",
    );
    const setupItems = [
      !workspace.mailing_address
        ? { label: "补充发件人联系地址", href: "/settings" }
        : null,
      !hasVerifiedPrimaryChannel
        ? { label: "连接并验证发信通道", href: "/settings" }
        : null,
      contactSummary.active_count === 0
        ? { label: "添加第一批客户", href: "/contacts" }
        : null,
      templateSummary.active_count === 0
        ? { label: "创建第一套模板", href: "/templates" }
        : null,
    ].filter((item): item is { label: string; href: string } => item !== null);
    return (
      <>
        <div className="welcome">
          <span className="eyebrow">卖家邮局</span>
          <h1>{workspace.name}</h1>
          <p>管理客户、设计模板并高效发送营销邮件。</p>
        </div>
        <div className="stat-grid">
          {[
            {
              label: "客户数",
              value: String(contactSummary.active_count),
              href: "/contacts",
            },
            {
              label: "模板数",
              value: String(templateSummary.active_count),
              href: "/templates",
            },
            {
              label: "工作区成员",
              value: String(members.length),
              href: "/team",
            },
            {
              label: "近 30 天打开率",
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
          客户数与模板数仅包含未归档记录。
          {statsAvailable
            ? `打开率按近 30 天启用追踪活动的已送达收件人加权计算（${campaignStatistics.opened} / ${campaignStatistics.delivered}，共 ${campaignStatistics.tracked_campaigns} 个活动）。`
            : "打开/点击统计需专业版或团队版。"}
        </p>
        <div className="dashboard-columns">
          <Card>
            <CardContent className="pt-5">
              <div className="section-heading mb-3">
                <div>
                  <h2>下一步</h2>
                  <p className="hint m-0">完成这些准备，就可以开始发信。</p>
                </div>
              </div>
              {setupItems.length ? (
                <ul className="dashboard-checklist">
                  {setupItems.map((item) => (
                    <li key={item.label}>
                      <span className="checklist-dot" aria-hidden="true" />
                      <Link href={item.href}>{item.label}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dashboard-success">
                  基础配置已完成，可以创建发信活动。
                </p>
              )}
              {canEdit && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild>
                    <Link href="/campaigns">查看活动</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/contacts">管理客户</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="section-heading mb-3">
                <h2>最近活动</h2>
                <Link
                  href="/campaigns"
                  className="text-xs underline underline-offset-2"
                >
                  查看全部
                </Link>
              </div>
              {recentCampaigns.items.length ? (
                <div className="dashboard-campaign-list">
                  {recentCampaigns.items.slice(0, 3).map((campaign) => (
                    <Link
                      key={campaign.id}
                      href="/campaigns"
                      className="dashboard-campaign-row"
                    >
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate">
                          {campaign.name}
                        </strong>
                        <span className="hint m-0">
                          {campaign.recipient_count ?? 0} 位收件人 ·{" "}
                          {campaignStatusLabels[campaign.status]}
                        </span>
                      </span>
                      <Badge variant="outline">
                        {campaignStatusLabels[campaign.status]}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="dashboard-success">
                  还没有活动，创建第一份草稿吧。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="section-heading">
          <h2>最近动态</h2>
          {canViewLogs && (
            <Link href="/logs" className="text-xs underline underline-offset-2">
              查看全部
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
                      {activityLabel(item.action)}
                      {item.target_label ? ` · ${item.target_label}` : ""}
                    </p>
                    <p className="hint m-0">
                      {item.actor_name} ·{" "}
                      {new Intl.DateTimeFormat("zh-CN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Shanghai",
                      }).format(new Date(item.created_at))}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : canViewLogs ? (
          <EmptyState
            title="还没有操作记录"
            description="完成客户、导入、模板或活动操作后，记录会出现在这里。"
          />
        ) : (
          <EmptyState
            title={
              role === "admin" ? "当前套餐不含操作日志" : "动态仅管理员可见"
            }
            description={
              role === "admin"
                ? "升级套餐后可在总览和日志页查看业务审计。"
                : "管理员可以在总览和日志页查看业务审计。"
            }
          >
            {role === "admin" && (
              <Button asChild variant="outline">
                <Link href="/settings">查看套餐详情</Link>
              </Button>
            )}
          </EmptyState>
        )}
      </>
    );
  }
  const page = pages[section];
  return (
    <>
      <div className="section-heading">
        <h1>{page.title}</h1>
        <Badge variant="outline">待接入</Badge>
      </div>
      <EmptyState title={page.empty} description={page.description} />
    </>
  );
}
