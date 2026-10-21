import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-wrap relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Brand />
      {children}
      <p className="auth-foot">卖家邮局 · 为长久的客户关系而准备</p>
    </main>
  );
}
