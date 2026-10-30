import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { InitializeForm } from "@/components/initialize-form";
import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isConfigured()) redirect("/setup");
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await searchParams;
  return (
    <section className="auth-card">
      <h1>准备你的工作区</h1>
      <p className="hint" role="status">
        {error
          ? "初始化未完成。账号可能已停用，或服务暂时不可用；请重试，重复操作不会创建重复工作区。"
          : "正在为你准备工作区…"}
      </p>
      <p className="hint">
        进入后可从总览准备清单开始，创建活动草稿、预览邮件并核对名单；这些操作不会立即正式发送。
      </p>
      <InitializeForm retry={Boolean(error)} />
      <form className="mt-4" action={signOut}>
        <Button variant="ghost">退出当前账号</Button>
      </form>
    </section>
  );
}
