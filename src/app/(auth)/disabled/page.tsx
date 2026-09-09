import { signOut } from "@/app/actions";
import { Button } from "@/components/ui/button";
export default function Page() {
  return (
    <section className="auth-card">
      <h1>邮局账号已停用</h1>
      <p className="hint">请联系管理员恢复 EDM 访问资格。</p>
      <form action={signOut}>
        <Button>退出当前账号</Button>
      </form>
    </section>
  );
}
