"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  changeWorkspaceMemberRole,
  createWorkspaceInvitation,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
} from "./actions";
import {
  roleNames,
  teamRoles,
  type TeamData,
  type TeamMember,
  type TeamRole,
} from "./model";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
  toast.success("邀请链接已复制");
}

function MemberRow({
  member,
  workspaceId,
  currentUserId,
  canManage,
  pending,
  onRefresh,
}: {
  member: TeamMember;
  workspaceId: string;
  currentUserId: string;
  canManage: boolean;
  pending: boolean;
  onRefresh: () => void;
}) {
  const [busy, startTransition] = useTransition();
  const isSelf = member.user_id === currentUserId;
  const changeRole = (nextRole: TeamRole) => {
    startTransition(async () => {
      const result = await changeWorkspaceMemberRole({
        workspace_id: workspaceId,
        user_id: member.user_id,
        role: nextRole,
        expected_version: member.version,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("成员角色已更新");
        onRefresh();
      }
    });
  };
  const remove = () => {
    if (
      !window.confirm(
        `确定移除 ${member.display_name} 吗？历史业务数据会保留。`,
      )
    )
      return;
    startTransition(async () => {
      const result = await removeWorkspaceMember({
        workspace_id: workspaceId,
        user_id: member.user_id,
        expected_version: member.version,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("成员已移除");
        onRefresh();
      }
    });
  };
  const transfer = () => {
    if (!window.confirm(`确定将工作区所有权转移给 ${member.display_name} 吗？`))
      return;
    startTransition(async () => {
      const result = await transferWorkspaceOwnership({
        workspace_id: workspaceId,
        new_owner_id: member.user_id,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("工作区所有权已转移");
        onRefresh();
      }
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0">
      <span className="avatar">{member.display_name.slice(0, 2)}</span>
      <div className="min-w-[180px] flex-1">
        <p className="font-medium">
          {member.display_name}{" "}
          {isSelf && <span className="hint">（当前账号）</span>}
        </p>
        <p className="hint m-0">{member.email}</p>
      </div>
      {member.is_owner && <span className="role-pill admin">所有者</span>}
      {canManage && !member.is_owner ? (
        <Select
          value={member.role}
          disabled={busy || pending}
          onValueChange={changeRole}
        >
          <SelectTrigger
            aria-label={`${member.display_name}的角色`}
            className="w-[108px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {teamRoles.map((item) => (
              <SelectItem key={item} value={item}>
                {roleNames[item]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="role-pill">{roleNames[member.role]}</span>
      )}
      {canManage && !member.is_owner && !isSelf && (
        <div className="flex gap-2">
          {member.role === "admin" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || pending}
              onClick={transfer}
            >
              转移所有权
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || pending}
            onClick={remove}
          >
            移除
          </Button>
        </div>
      )}
    </div>
  );
}

export function TeamManager({
  initialData,
  currentUserId,
  canManage,
}: {
  initialData: TeamData;
  currentUserId: string;
  canManage: boolean;
}) {
  const data = initialData;
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("editor");
  const [inviteUrl, setInviteUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const refresh = () => router.refresh();
  const submitInvite = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await createWorkspaceInvitation({
        workspace_id: data.workspace.id,
        email,
        role: inviteRole,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setInviteUrl(result.inviteUrl);
      setEmail("");
      toast.success("邀请已创建，链接只显示一次");
    });
  };
  const resend = (id: string) => {
    startTransition(async () => {
      const result = await resendWorkspaceInvitation({
        workspace_id: data.workspace.id,
        id,
      });
      if ("error" in result) toast.error(result.error);
      else {
        setInviteUrl(result.inviteUrl);
        setLinkOpen(true);
        refresh();
      }
    });
  };
  const revoke = (id: string) => {
    if (!window.confirm("确定撤销这条邀请吗？旧链接会立即失效。")) return;
    startTransition(async () => {
      const result = await revokeWorkspaceInvitation({
        workspace_id: data.workspace.id,
        id,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("邀请已撤销");
        refresh();
      }
    });
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="hint m-0">
            {canManage
              ? "邀请链接有效 7 天；管理员可随时重发或撤销。"
              : "你可以查看团队成员和当前角色。"}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>邀请成员</Button>
        )}
      </div>
      <section>
        <h2>活动成员（{data.members.length}）</h2>
        <div className="mt-2 rounded-xl border bg-card px-5">
          {data.members.map((member) => (
            <MemberRow
              key={member.user_id}
              member={member}
              workspaceId={data.workspace.id}
              currentUserId={currentUserId}
              canManage={canManage}
              pending={busy}
              onRefresh={refresh}
            />
          ))}
        </div>
      </section>
      {canManage && (
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h2>待处理邀请（{data.invitations.length}）</h2>
            <span className="hint m-0">
              仅展示邮箱掩码，不保存可再次复制的明文链接。
            </span>
          </div>
          <div className="mt-2 rounded-xl border bg-card px-5">
            {data.invitations.length ? (
              data.invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0"
                >
                  <div className="min-w-[180px] flex-1">
                    <p className="font-medium">{invitation.email_hint}</p>
                    <p className="hint m-0">
                      {roleNames[invitation.role]} · 过期于{" "}
                      {formatDate(invitation.expires_at)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => resend(invitation.id)}
                  >
                    重新生成链接
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => revoke(invitation.id)}
                  >
                    撤销
                  </Button>
                </div>
              ))
            ) : (
              <p className="hint py-4 m-0">暂无待处理邀请。</p>
            )}
          </div>
        </section>
      )}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) {
            setInviteUrl("");
            refresh();
          }
        }}
      >
        <DialogContent>
          {inviteUrl ? (
            <>
              <DialogHeader>
                <DialogTitle>复制邀请链接</DialogTitle>
                <DialogDescription>
                  关闭后不能再次查看此链接；需要新链接时请在待处理邀请中重发。
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border bg-muted p-3 text-xs break-all">
                {inviteUrl}
              </div>
              <DialogFooter>
                <Button onClick={() => copyText(inviteUrl)}>复制链接</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>邀请团队成员</DialogTitle>
                <DialogDescription>
                  链接只显示一次，请复制后通过安全渠道分享给对方。
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submitInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="team-invite-email">受邀邮箱</Label>
                  <Input
                    id="team-invite-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-invite-role">加入角色</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(value) => setInviteRole(value as TeamRole)}
                  >
                    <SelectTrigger id="team-invite-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {teamRoles.map((item) => (
                        <SelectItem key={item} value={item}>
                          {roleNames[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={busy || !email.trim()}>
                    生成邀请链接
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open);
          if (!open) {
            setInviteUrl("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>复制邀请链接</DialogTitle>
            <DialogDescription>
              关闭后不能再次查看此链接；需要新链接时请在待处理邀请中重发。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted p-3 text-xs break-all">
            {inviteUrl}
          </div>
          <DialogFooter>
            <Button onClick={() => copyText(inviteUrl)}>复制链接</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
