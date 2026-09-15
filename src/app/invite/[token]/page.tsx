import Link from "next/link";
import { serverClient } from "@/lib/supabase/server";
import { getInvitationPreview } from "@/features/team/actions";
import { InviteAcceptance } from "@/features/team/invite-acceptance";

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const validShape = /^[A-Za-z0-9_-]{40,80}$/.test(token);
  if (!validShape)
    return (
      <section className="auth-card">
        <h1>邀请链接无效</h1>
        <p className="hint">请向工作区管理员索取新的邀请链接。</p>
      </section>
    );
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user)
    return (
      <section className="auth-card">
        <span className="eyebrow">团队协作邀请</span>
        <h1>登录后接受邀请</h1>
        <p className="hint">
          请使用受邀邮箱登录并完成邮箱验证，邀请链接会继续保留。
        </p>
        <Link
          className="inline-flex h-10 items-center rounded-md bg-primary px-6 text-sm text-primary-foreground"
          href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
        >
          登录并继续
        </Link>
      </section>
    );
  const preview = await getInvitationPreview(token);
  return <InviteAcceptance token={token} preview={preview} />;
}
