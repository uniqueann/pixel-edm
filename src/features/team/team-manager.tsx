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
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  isRoleDemotion,
  roleNames,
  teamRoles,
  type TeamData,
  type TeamMember,
  type TeamRole,
} from "./model";
import { inviteRoleBlurb } from "./role-descriptions";

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
  const [removeOpen, setRemoveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [roleConfirm, setRoleConfirm] = useState<{
    nextRole: TeamRole;
    step: 1 | 2;
  }>();
  const isSelf = member.user_id === currentUserId;

  const applyRole = (nextRole: TeamRole) => {
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

  const changeRole = (nextRole: TeamRole) => {
    if (nextRole === member.role) return;
    if (!isRoleDemotion(member.role, nextRole)) {
      applyRole(nextRole);
      return;
    }
    setRoleConfirm({ nextRole, step: 1 });
  };

  const confirmRoleChange = (): boolean | void => {
    if (!roleConfirm) return;
    const { nextRole, step } = roleConfirm;
    if (member.role === "admin" && step === 1) {
      setRoleConfirm({ nextRole, step: 2 });
      return false;
    }
    setRoleConfirm(undefined);
    applyRole(nextRole);
  };

  const remove = () => {
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

  const roleConfirmDescription =
    roleConfirm &&
    (roleConfirm.step === 2 ? (
      <>
        最后确认：将 {member.display_name} 从管理员调整为
        {roleNames[roleConfirm.nextRole]}。对方将失去成员与账单管理权限。
      </>
    ) : (
      <>
        将 {member.display_name} 的角色从 {roleNames[member.role]} 调整为
        {roleNames[roleConfirm.nextRole]}？
        {member.role === "admin" && (
          <>
            {" "}
            管理员降级后可能无法管理成员、账单与正式发送；需再次确认后才会生效。
          </>
        )}
      </>
    ));

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
              onClick={() => setTransferOpen(true)}
            >
              转移所有权
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || pending}
            onClick={() => setRemoveOpen(true)}
          >
            移除
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="移除成员"
        description={
          <>
            确定移除 {member.display_name}{" "}
            吗？对方将无法再访问此工作区，历史业务数据会保留。
          </>
        }
        confirmLabel="移除"
        variant="destructive"
        loading={busy}
        onConfirm={remove}
      />

      <ConfirmDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title="转移工作区所有权"
        description={
          <>
            <p className="m-0">
              确定将工作区所有权转移给 {member.display_name} 吗？
            </p>
            <p className="m-0">
              转移后，{member.display_name}{" "}
              将成为工作区所有者并负责账单与套餐；你仍会保留管理员身份，但不再拥有所有者专属权限。
            </p>
          </>
        }
        confirmLabel="转移所有权"
        variant="destructive"
        loading={busy}
        onConfirm={transfer}
      />

      <ConfirmDialog
        open={Boolean(roleConfirm)}
        onOpenChange={(open) => {
          if (!open) setRoleConfirm(undefined);
        }}
        title={roleConfirm?.step === 2 ? "再次确认角色降级" : "调整成员角色"}
        description={roleConfirmDescription ?? ""}
        confirmLabel={roleConfirm?.step === 2 ? "确认降级" : "更新角色"}
        variant="destructive"
        loading={busy}
        onConfirm={confirmRoleChange}
      />
    </div>
  );
}

export function TeamManager({
  initialData,
  currentUserId,
  canManage,
  memberCapNote,
}: {
  initialData: TeamData;
  currentUserId: string;
  canManage: boolean;
  memberCapNote?: string | null;
}) {
  const data = initialData;
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("editor");
  const [inviteUrl, setInviteUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [revokeId, setRevokeId] = useState<string>();
  const [busy, startTransition] = useTransition();
  const refresh = () => router.refresh();
  const submitInvite = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;
    startTransition(async () => {
      const result = await createWorkspaceInvitation({
        workspace_id: data.workspace.id,
        email: cleanEmail,
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
      {memberCapNote ? <p className="hint m-0">{memberCapNote}</p> : null}
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
        <h2>团队成员（{data.members.length}）</h2>
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
              为保障安全，仅显示部分邮箱字符；邀请链接关闭后不可再次查看，失效请重新生成。
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
                    onClick={() => setRevokeId(invitation.id)}
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
            setEmail("");
            refresh();
          }
        }}
      >
        <DialogContent
          placement="bottom"
          className="bottom-sheet max-h-[85vh] overflow-y-auto"
        >
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
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setInviteUrl("");
                    setEmail("");
                    setInviteRole("editor");
                    refresh();
                  }}
                  className="w-full sm:w-auto"
                >
                  继续邀请下一位
                </Button>
                <Button
                  onClick={() => copyText(inviteUrl)}
                  className="w-full sm:w-auto"
                >
                  复制链接
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>邀请团队成员</DialogTitle>
                <DialogDescription>
                  生成受邀链接并分配成员角色与管理权限。
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-border/80 bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">
                  💡 链接时效：
                </span>
                邀请链接有效 7
                天且生成后仅展示一次，可通过即时通讯或企业邮件安全分享。
              </div>
              <form onSubmit={submitInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="team-invite-email">受邀邮箱</Label>
                  <Input
                    id="team-invite-email"
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="email"
                    placeholder="colleague@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    onBlur={() => setEmail((prev) => prev.trim().toLowerCase())}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-invite-role">加入角色</Label>
                  <select
                    id="team-invite-role"
                    className="list-filter w-full"
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(event.target.value as TeamRole)
                    }
                  >
                    {teamRoles.map((item) => (
                      <option key={item} value={item}>
                        {roleNames[item]}
                      </option>
                    ))}
                  </select>
                  <p className="hint m-0 text-xs">
                    {inviteRoleBlurb(inviteRole)}
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setInviteOpen(false);
                      setEmail("");
                    }}
                    className="w-full sm:w-auto"
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy || !email.trim()}
                    className="w-full sm:w-auto"
                  >
                    {busy ? "生成中…" : "生成邀请链接"}
                  </Button>
                </div>
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
        <DialogContent
          placement="bottom"
          className="bottom-sheet max-h-[85vh] overflow-y-auto"
        >
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
            <Button
              onClick={() => copyText(inviteUrl)}
              className="w-full sm:w-auto"
            >
              复制链接
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(revokeId)}
        onOpenChange={(open) => {
          if (!open) setRevokeId(undefined);
        }}
        title="撤销邀请"
        description="确定撤销这条邀请吗？旧链接会立即失效。"
        confirmLabel="撤销邀请"
        variant="destructive"
        loading={busy}
        onConfirm={() => {
          if (revokeId) revoke(revokeId);
          setRevokeId(undefined);
        }}
      />
    </div>
  );
}
