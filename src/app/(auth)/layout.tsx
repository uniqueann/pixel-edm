import { Mail } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-stack">
        <header className="auth-masthead">
          <Brand />
          <ThemeToggle />
        </header>
        <div className="auth-frame">
          <aside className="auth-aside">
            <div className="auth-aside-copy">
              <p className="auth-aside-line">
                为长久的客户关系
                <br />
                而准备。
              </p>
              <p className="auth-aside-note">
                客户名单、邮件模板与发信活动，
                <br />
                在同一处管理。
              </p>
            </div>
            {/* 邮戳是邮政世界的几何细节，随容器裁切，不参与信息层级。 */}
            <span className="auth-postmark" aria-hidden="true">
              <Mail size={26} strokeWidth={1.5} />
            </span>
          </aside>
          <div className="auth-panel">{children}</div>
        </div>
        <p className="auth-foot">卖家邮局 · 为长久的客户关系而准备</p>
      </div>
    </main>
  );
}
