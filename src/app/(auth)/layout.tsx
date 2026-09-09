import { Brand } from "@/components/brand";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-wrap">
      <Brand />
      {children}
      <p className="auth-foot">卖家邮局 · 为长久的客户关系而准备</p>
    </main>
  );
}
