import { notFound } from "next/navigation";
import { getContext } from "@/lib/workspace";
import { serverClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { SettingsForm } from "@/components/settings-form";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  const { member, workspace, role, user } = await getContext();
  if (section === "settings")
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
        <div className="mt-7">
          <h2>发信通道</h2>
          <p className="hint mt-2">
            后续可连接你自己的发信账号，验证发件人并发送测试邮件。
          </p>
          <Badge variant="outline">尚未接入</Badge>
        </div>
      </>
    );
  if (section === "dashboard" || section === "team") {
    const db = await serverClient();
    const { data: members, error } = await db
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("status", "active");
    if (error) throw new Error("成员信息加载失败，请重试。");
    if (section === "team")
      return (
        <>
          <div className="section-heading">
            <h1>团队成员</h1>
            <span className="hint m-0">{members.length} 人</span>
          </div>
          <Card>
            <CardContent className="pt-3">
              {members.map((m) => (
                <div key={m.user_id} className="member-row">
                  <span className="avatar">
                    {m.user_id === user.id
                      ? member.display_name.slice(0, 2)
                      : "成"}
                  </span>
                  <div className="flex-1">
                    <p>
                      {m.user_id === user.id
                        ? member.display_name
                        : "工作区成员"}
                    </p>
                    <p className="hint m-0">
                      {m.user_id === user.id ? "当前账号" : "已加入工作区"}
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {{ admin: "管理员", editor: "运营", viewer: "查看者" }[
                      m.role
                    ] ?? m.role}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <p className="hint mt-4">成员邀请和角色管理将在团队协作阶段开放。</p>
        </>
      );
    return (
      <>
        <div className="welcome">
          <span className="eyebrow">你的客户联络小站</span>
          <h1>{workspace.name}</h1>
          <p>从一份名单、一封邮件，开始长久的联络。</p>
        </div>
        <div className="stat-grid">
          {[
            ["客户数", "—"],
            ["模板数", "—"],
            ["工作区成员", String(members.length)],
            ["平均打开率", "—"],
          ].map(([label, value]) => (
            <Card key={label} className="stat-card">
              <CardContent>
                <span>{label}</span>
                <strong>{value}</strong>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="hint">客户、模板和回执尚未接入，暂无对应统计。</p>
        <div className="section-heading">
          <h2>最近动态</h2>
        </div>
        <EmptyState
          title="邮局已经准备好了"
          description="账号和工作区已连接。客户、模板与发信活动将逐步加入这里。"
        />
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
