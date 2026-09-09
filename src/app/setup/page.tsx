import { Brand } from "@/components/brand";
export default function Setup() {
  return (
    <main className="auth-wrap">
      <Brand />
      <section className="auth-card">
        <h1>连接你的邮局</h1>
        <p className="hint">
          应用已就绪。请在本地环境中配置 Supabase
          项目地址、公开密钥和本站地址，再重新启动。
        </p>
        <p>配置字段见仓库的 .env.example。</p>
      </section>
    </main>
  );
}
