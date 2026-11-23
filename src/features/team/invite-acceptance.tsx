"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";
import type { AppErrorPayload } from "@/lib/errors";
import { useErrorMessage } from "@/i18n/use-resolvers";
import { acceptWorkspaceInvitation } from "./actions";
import { inviteWrongAccountMessage, type InvitationPreview } from "./model";

export function InviteAcceptance({
  token,
  preview,
}: {
  token: string;
  preview: InvitationPreview;
}) {
  const router = useRouter();
  const t = useTranslations("auth.invite");
  const tRoles = useTranslations("shell.roles");
  const translateError = useErrorMessage();
  const [message, setMessage] = useState("");
  const [busy, startTransition] = useTransition();
  const invitePath = `/invite/${token}`;
  const wrongAccount = message === inviteWrongAccountMessage;
  const roleLabel =
    preview.role === "admin" ||
    preview.role === "editor" ||
    preview.role === "viewer"
      ? tRoles(preview.role)
      : t("fallbackRole");

  const accept = () => {
    setMessage("");
    startTransition(async () => {
      const result = await acceptWorkspaceInvitation(token);
      if (result.error) {
        const payload =
          "errorPayload" in result
            ? (result.errorPayload as AppErrorPayload | undefined)
            : undefined;
        setMessage(translateError(payload ?? result.error));
        return;
      }
      toast.success(t("joinedToast"));
      router.replace("/dashboard");
      router.refresh();
    });
  };
  const workspaceName = preview.workspace_name ?? "";
  const active = preview.status === "pending" && Boolean(workspaceName);
  return (
    <section className="auth-card">
      {active ? (
        <>
          <h1>{t("joinTitle", { workspace: workspaceName })}</h1>
          <p className="hint">
            {t("meta", {
              email: preview.email_hint ?? "",
              role: roleLabel,
            })}
          </p>
          <p className="hint">{t("acceptHint")}</p>
          <Button className="mt-4" onClick={accept} disabled={busy}>
            {busy ? t("accepting") : t("acceptButton")}
          </Button>
          {message && (
            <p className="field-error mt-3" role="alert">
              {message}
            </p>
          )}
          {wrongAccount && (
            <form className="mt-3" action={signOut.bind(null, invitePath)}>
              <Button type="submit" variant="outline" disabled={busy}>
                {t("switchAccount")}
              </Button>
            </form>
          )}
        </>
      ) : (
        <>
          <h1>{t("unavailableTitle")}</h1>
          <p className="hint">{t("unavailableDescription")}</p>
        </>
      )}
    </section>
  );
}
