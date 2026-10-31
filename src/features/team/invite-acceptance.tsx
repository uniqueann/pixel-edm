"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { acceptWorkspaceInvitation } from "./actions";
import {
  inviteWrongAccountMessage,
  roleNames,
  type InvitationPreview,
} from "./model";

export function InviteAcceptance({
  token,
  preview,
}: {
  token: string;
  preview: InvitationPreview;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, startTransition] = useTransition();
  const invitePath = `/invite/${token}`;
  const wrongAccount = message === inviteWrongAccountMessage;
  const accept = () => {
    setMessage("");
    startTransition(async () => {
      const result = await acceptWorkspaceInvitation(token);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      toast.success("已加入团队工作区");
      router.replace("/dashboard");
      router.refresh();
    });
  };
  const active = preview.status === "pending" && preview.workspace_name;
  return (
    <section className="auth-card">
      {active ? (
        <>
          <h1>加入「{preview.workspace_name}」</h1>
          <p className="hint">
            邀请邮箱：{preview.email_hint} · 加入角色：
            {preview.role ? roleNames[preview.role] : "团队成员"}
          </p>
          <p className="hint">
            接受后，你将按照工作区角色访问客户、模板和活动。
          </p>
          <Button className="mt-4" onClick={accept} disabled={busy}>
            {busy ? "正在加入…" : "接受邀请"}
          </Button>
          {message && (
            <p className="field-error mt-3" role="alert">
              {message}
            </p>
          )}
          {wrongAccount && (
            <form className="mt-3" action={signOut.bind(null, invitePath)}>
              <Button type="submit" variant="outline" disabled={busy}>
                退出并切换账号
              </Button>
            </form>
          )}
        </>
      ) : (
        <>
          <h1>邀请无法接受</h1>
          <p className="hint">
            链接可能已过期、被撤销或已经使用，请联系管理员重新生成。
          </p>
        </>
      )}
    </section>
  );
}
