"use client";
import { Notice } from "@/components/ui/notice";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
  teamRoles,
  type TeamData,
  type TeamMember,
  type TeamRole,
} from "./model";
import { DEFAULT_LOCALE, normalizeLocale } from "@/i18n/config";
import { formatBusinessDateTime } from "@/i18n/format";
import { useErrorMessage } from "@/i18n/use-resolvers";

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
  const t = useTranslations("team");
  const resolveError = useErrorMessage();
  const [busy, startTransition] = useTransition();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [roleConfirm, setRoleConfirm] = useState<{
    nextRole: TeamRole;
    step: 1 | 2;
  }>();
  const isSelf = member.user_id === currentUserId;

  const roleLabel = (role: TeamRole) => t(`roles.${role}`);

  const applyRole = (nextRole: TeamRole) => {
    startTransition(async () => {
      const result = await changeWorkspaceMemberRole({
        workspace_id: workspaceId,
        user_id: member.user_id,
        role: nextRole,
        expected_version: member.version,
      });
      if ("error" in result) toast.error(resolveError(result));
      else {
        toast.success(t("toast.roleUpdated"));
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
      if ("error" in result) toast.error(resolveError(result));
      else {
        toast.success(t("toast.memberRemoved"));
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
      if ("error" in result) toast.error(resolveError(result));
      else {
        toast.success(t("toast.ownershipTransferred"));
        onRefresh();
      }
    });
  };

  const roleConfirmDescription =
    roleConfirm &&
    (roleConfirm.step === 2 ? (
      <>
        {t("confirm.roleStep2Description", {
          name: member.display_name,
          toRole: roleLabel(roleConfirm.nextRole),
        })}
      </>
    ) : (
      <>
        {t("confirm.roleStep1Description", {
          name: member.display_name,
          fromRole: roleLabel(member.role),
          toRole: roleLabel(roleConfirm.nextRole),
        })}
        {member.role === "admin" && <> {t("confirm.roleStep1AdminWarning")}</>}
      </>
    ));

  return (
    <div className="flex flex-wrap items-center gap-3 border-t py-3 first:border-t-0">
      <span className="avatar">{member.display_name.slice(0, 2)}</span>
      <div className="min-w-[180px] flex-1">
        <p className="font-medium">
          {member.display_name}{" "}
          {isSelf && (
            <span className="hint">{t("members.currentAccount")}</span>
          )}
        </p>
        <p className="hint m-0">{member.email}</p>
      </div>
      {member.is_owner && <span className="role-pill">{t("roles.owner")}</span>}
      {canManage && !member.is_owner ? (
        <Select
          value={member.role}
          disabled={busy || pending}
          onValueChange={changeRole}
        >
          <SelectTrigger
            aria-label={t("members.roleSelectAria", {
              name: member.display_name,
            })}
            className="w-[108px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {teamRoles.map((item) => (
              <SelectItem key={item} value={item}>
                {roleLabel(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="role-pill">{roleLabel(member.role)}</span>
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
              {t("members.transferOwnership")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || pending}
            onClick={() => setRemoveOpen(true)}
          >
            {t("members.remove")}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t("confirm.removeTitle")}
        description={t("confirm.removeDescription", {
          name: member.display_name,
        })}
        confirmLabel={t("confirm.removeAction")}
        variant="destructive"
        loading={busy}
        onConfirm={remove}
      />

      <ConfirmDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title={t("confirm.transferTitle")}
        description={
          <>
            <p className="m-0">
              {t("confirm.transferLead", { name: member.display_name })}
            </p>
            <p className="m-0">
              {t("confirm.transferDetail", { name: member.display_name })}
            </p>
          </>
        }
        confirmLabel={t("confirm.transferAction")}
        variant="destructive"
        loading={busy}
        onConfirm={transfer}
      />

      <ConfirmDialog
        open={Boolean(roleConfirm)}
        onOpenChange={(open) => {
          if (!open) setRoleConfirm(undefined);
        }}
        title={
          roleConfirm?.step === 2
            ? t("confirm.roleStep2Title")
            : t("confirm.roleStep1Title")
        }
        description={roleConfirmDescription ?? ""}
        confirmLabel={
          roleConfirm?.step === 2
            ? t("confirm.roleStep2Action")
            : t("confirm.roleStep1Action")
        }
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
  const t = useTranslations("team");
  const tCommon = useTranslations("common");
  const locale = normalizeLocale(useLocale()) ?? DEFAULT_LOCALE;
  const resolveError = useErrorMessage();
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

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(t("toast.linkCopied"));
  };

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
        toast.error(resolveError(result));
        return;
      }
      setInviteUrl(result.inviteUrl);
      setEmail("");
      toast.success(t("toast.invitationCreated"));
    });
  };
  const resend = (id: string) => {
    startTransition(async () => {
      const result = await resendWorkspaceInvitation({
        workspace_id: data.workspace.id,
        id,
      });
      if ("error" in result) toast.error(resolveError(result));
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
      if ("error" in result) toast.error(resolveError(result));
      else {
        toast.success(t("toast.invitationRevoked"));
        refresh();
      }
    });
  };
  return (
    <div className="space-y-6">
      {memberCapNote ? (
        <Notice tone="warning" className="m-0">
          {memberCapNote}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="hint m-0">
            {canManage ? t("hint.admin") : t("hint.readOnly")}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>
            {t("actions.inviteMember")}
          </Button>
        )}
      </div>
      <section>
        <h2>{t("members.sectionTitle", { count: data.members.length })}</h2>
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <h2 className="shrink-0">
              {t("invitations.sectionTitle", {
                count: data.invitations.length,
              })}
            </h2>
            <span className="hint m-0">{t("invitations.securityHint")}</span>
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
                      {t("invitations.expiresAt", {
                        role: t(`roles.${invitation.role}`),
                        date: formatBusinessDateTime(
                          invitation.expires_at,
                          locale,
                        ),
                      })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => resend(invitation.id)}
                  >
                    {t("invitations.regenerate")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRevokeId(invitation.id)}
                  >
                    {t("invitations.revoke")}
                  </Button>
                </div>
              ))
            ) : (
              <p className="hint py-4 m-0">{t("invitations.empty")}</p>
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
                <DialogTitle>{t("inviteDialog.copyTitle")}</DialogTitle>
                <DialogDescription>
                  {t("inviteDialog.copyDescription")}
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
                  {t("actions.inviteAnother")}
                </Button>
                <Button
                  onClick={() => copyText(inviteUrl)}
                  className="w-full sm:w-auto"
                >
                  {t("actions.copyLink")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("inviteDialog.createTitle")}</DialogTitle>
                <DialogDescription>
                  {t("inviteDialog.createDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-border/80 bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">
                  {t("inviteDialog.expiryLabel")}
                </span>
                {t("inviteDialog.expiryHint")}
              </div>
              <form onSubmit={submitInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="team-invite-email">
                    {t("inviteDialog.emailLabel")}
                  </Label>
                  <Input
                    id="team-invite-email"
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="email"
                    placeholder={t("inviteDialog.emailPlaceholder")}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    onBlur={() => setEmail((prev) => prev.trim().toLowerCase())}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-invite-role">
                    {t("inviteDialog.roleLabel")}
                  </Label>
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
                        {t(`roles.${item}`)}
                      </option>
                    ))}
                  </select>
                  <p className="hint m-0 text-xs">
                    {t(`roles.descriptions.${inviteRole}`)}
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
                    {tCommon("actions.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy || !email.trim()}
                    className="w-full sm:w-auto"
                  >
                    {busy ? t("actions.generating") : t("actions.generateLink")}
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
            <DialogTitle>{t("inviteDialog.copyTitle")}</DialogTitle>
            <DialogDescription>
              {t("inviteDialog.copyDescription")}
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
              {t("actions.copyLink")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(revokeId)}
        onOpenChange={(open) => {
          if (!open) setRevokeId(undefined);
        }}
        title={t("confirm.revokeTitle")}
        description={t("confirm.revokeDescription")}
        confirmLabel={t("confirm.revokeAction")}
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
