import { notFound } from "next/navigation";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { SettingsForm } from "@/components/settings-form";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listContacts } from "@/features/contacts/actions";
import { listTemplates } from "@/features/templates/actions";
import { listActivityLogs } from "@/features/audit/actions";
import { activityLabels } from "@/features/audit/model";
import { getWorkspaceCampaignStatistics } from "@/features/campaigns/actions";
import {
  getDeliveryChannel,
  getDeliveryTestSummary,
} from "@/features/channels/actions";
import { ChannelSettings } from "@/features/channels/channel-settings";
import { credentialStorageReady } from "@/features/channels/credentials";
import { listTeam } from "@/features/team/actions";
import { TeamManager } from "@/features/team/team-manager";
const pages: Record<
  string,
  { title: string; description: string; empty: string }
> = {
  contacts: {
    title: "客户名单",
    description: "客户管理将在下一批接入，支持名单导入、标签和订阅状态。",
    empty: "为第一位客户留个位置",
  },
  templates: {
    title: "邮件模板库",
    description: "下一批将接入纯文本模板、变量插入和六套起步模板。",
    empty: "好的邮件，从一份模板开始",
  },
  campaigns: {
    title: "发信活动",
    description: "活动管理将在下一批接入，届时可准备草稿、预览和导出邮件。",
    empty: "为下一次联络做好准备",
  },
  logs: {
    title: "操作记录",
    description: "业务操作接入后，这里将展示真实的操作记录。",
    empty: "这里会记住每一次用心",
  },
};
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (
    !["dashboard", "team", "settings", ...Object.keys(pages)].includes(section)
  )
    notFound();
  const { workspace, role, user } = await getContext();
  if (section === "settings") {
    const deliveryChannel = await getDeliveryChannel();
    const deliveryTest = deliveryChannel
      ? await getDeliveryTestSummary(deliveryChannel.id)
      : null;
    return (
      <>
        <div className="section-heading">
          <h1>邮局设置</h1>
          <Badge variant="secondary">工作区</Badge>
        </div>
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-2">店铺信息</h2>
            <p className="hint">让每一封邮件，都带着你的名字。</p>
            <SettingsForm
              key={workspace.id}
              name={workspace.name}
              address={workspace.mailing_address}
              canEdit={role === "admin"}
            />
          </CardContent>
        </Card>
        <div className="mt-7 space-y-3">
          <div>
            <h2>发信通道</h2>
            <p className="hint mt-2 mb-0">
              保存工作区自己的阿里云 DirectMail
              配置，并向当前管理员的已验证邮箱发送测试邮件。
            </p>
          </div>
          <ChannelSettings
            key={workspace.id}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            initialChannel={deliveryChannel}
            initialTest={deliveryTest}
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
    if (section === "team") {
      const team = await listTeam(workspace.id);
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
          />
        </>
      );
    }
    const [
      contactSummary,
      templateSummary,
      campaignStatistics,
      recentActivity,
    ] = await Promise.all([
      listContacts({}),
      listTemplates({}),
      getWorkspaceCampaignStatistics(),
      role === "admin"
        ? listActivityLogs({ pageSize: 5 })
        : Promise.resolve(null),
    ]);
    const weightedOpenRate = campaignStatistics.delivered
      ? `${Math.round(
          (campaignStatistics.opened / campaignStatistics.delivered) * 100,
        )}%`
      : "—";
    return (
      <>
        <div className="welcome">
          <span className="eyebrow">你的客户联络小站</span>
          <h1>{workspace.name}</h1>
          <p>从一份名单、一封邮件，开始长久的联络。</p>
        </div>
        <div className="stat-grid">
          {[
            ["客户数", String(contactSummary.active_count)],
            ["模板数", String(templateSummary.active_count)],
            ["工作区成员", String(members.length)],
            ["近 30 天打开率", weightedOpenRate],
          ].map(([label, value]) => (
            <Card key={label} className="stat-card">
              <CardContent>
                <span>{label}</span>
                <strong>{value}</strong>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="hint">
          客户数与模板数仅包含未归档记录；打开率按近 30
          天启用追踪活动的已送达收件人加权计算（
          {campaignStatistics.opened} / {campaignStatistics.delivered}，共{" "}
          {campaignStatistics.tracked_campaigns} 个活动）。
        </p>
        <div className="section-heading">
          <h2>最近动态</h2>
        </div>
        {recentActivity?.items.length ? (
          <Card>
            <CardContent className="pt-3">
              {recentActivity.items.map((item) => (
                <div className="member-row" key={item.id}>
                  <span className="avatar">{item.actor_name.slice(0, 2)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {activityLabels[item.action] ?? item.action}
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
        ) : (
          <EmptyState
            title={role === "admin" ? "还没有操作记录" : "动态仅管理员可见"}
            description={
              role === "admin"
                ? "完成客户、导入或模板操作后，记录会出现在这里。"
                : "管理员可以在总览和日志页查看业务审计。"
            }
          />
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
