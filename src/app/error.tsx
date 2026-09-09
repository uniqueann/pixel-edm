"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <h1>邮局暂时没有连接上</h1>
        <p className="hint">
          请稍后重试。如果问题持续，请检查账号状态和数据库连接。
        </p>
        <Button onClick={reset}>重新尝试</Button>
        <Link className="ml-4" href="/login">
          返回登录
        </Link>
      </section>
    </main>
  );
}
