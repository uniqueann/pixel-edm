import Link from "next/link";
import { serverClient } from "@/lib/supabase/server";
import { getInvitationPreview } from "@/features/team/actions";
import { InviteAcceptance } from "@/features/team/invite-acceptance";
import { Button } from "@/components/ui/button";

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitePath = `/invite/${token}`;
  const nextQuery = `?next=${encodeURIComponent(invitePath)}`;
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
        <h1>接受团队邀请</h1>
        <p className="hint">
          请使用受邀邮箱注册或登录，并完成邮箱验证。完成认证后会回到此页面继续接受邀请。
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href={`/register${nextQuery}`}>注册并接受</Link>
          </Button>
          <Button asChild className="w-full" variant="outline">
            <Link href={`/login${nextQuery}`}>登录并接受</Link>
          </Button>
        </div>
      </section>
    );
  const preview = await getInvitationPreview(token);
  return <InviteAcceptance token={token} preview={preview} />;
}
