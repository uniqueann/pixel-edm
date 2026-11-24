import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { serverClient } from "@/lib/supabase/server";
import { getInvitationPreview } from "@/features/team/actions";
import { InviteAcceptance } from "@/features/team/invite-acceptance";
import { Button } from "@/components/ui/button";

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, t] = await Promise.all([
    params,
    getTranslations("auth.invite"),
  ]);
  const invitePath = `/invite/${token}`;
  const nextQuery = `?next=${encodeURIComponent(invitePath)}`;
  const validShape = /^[A-Za-z0-9_-]{40,80}$/.test(token);
  if (!validShape)
    return (
      <section className="auth-card">
        <h1>{t("invalidTitle")}</h1>
        <p className="hint">{t("invalidDescription")}</p>
      </section>
    );
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return (
      <section className="auth-card">
        <h1>{t("guestTitle")}</h1>
        <p className="hint">{t("guestDescription")}</p>
        <div className="mt-5 flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href={`/register${nextQuery}`}>{t("registerToAccept")}</Link>
          </Button>
          <Button asChild className="w-full" variant="outline">
            <Link href={`/login${nextQuery}`}>{t("loginToAccept")}</Link>
          </Button>
        </div>
      </section>
    );
  const preview = await getInvitationPreview(token);
  return <InviteAcceptance token={token} preview={preview} />;
}
