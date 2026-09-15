"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { browserClient } from "@/lib/supabase/client";
import { isConfigured, siteUrl } from "@/lib/supabase/config";
import { credentials } from "@/lib/validation";
type Mode = "login" | "register" | "forgot" | "reset";
const titles: Record<Mode, string> = {
  login: "欢迎回到邮局",
  register: "开启你的卖家邮局",
  forgot: "找回密码",
  reset: "设置新密码",
};
export function AuthForm({
  mode,
  nextPath,
}: {
  mode: Mode;
  nextPath?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [oauthPending, setOauthPending] = useState(false);
  const schema = z.object({
    email: mode === "reset" ? z.string() : credentials.shape.email,
    password:
      mode === "forgot"
        ? z.string()
        : mode === "login"
          ? z.string().min(1, "请输入密码")
          : credentials.shape.password,
  });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const busy = form.formState.isSubmitting || oauthPending;
  const destination =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : "/onboarding";
  const nextQuery =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? `?next=${encodeURIComponent(nextPath)}`
      : "";
  async function submit(values: { email?: string; password?: string }) {
    setMessage("");
    try {
      const db = browserClient();
      if (mode === "forgot") {
        const { error } = await db.auth.resetPasswordForEmail(values.email!, {
          redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
        });
        if (error) throw error;
        setMessage(
          "如果该邮箱已注册，你将收到密码重置邮件，请在当前浏览器打开。",
        );
      } else if (mode === "reset") {
        const {
          data: { user },
        } = await db.auth.getUser();
        if (!user) {
          setMessage("重置链接已失效，请重新申请。");
          return;
        }
        const { error } = await db.auth.updateUser({
          password: values.password!,
        });
        if (error) throw error;
        router.replace("/onboarding");
        router.refresh();
      } else if (mode === "register") {
        const { data, error } = await db.auth.signUp({
          email: values.email!,
          password: values.password!,
          options: {
            emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(destination)}`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(destination);
          router.refresh();
        } else
          setMessage(
            "请检查邮箱中的验证邮件，并在当前浏览器完成验证。已有账号可直接登录。",
          );
      } else {
        const { error } = await db.auth.signInWithPassword({
          email: values.email!,
          password: values.password!,
        });
        if (error) throw error;
        router.replace(destination);
        router.refresh();
      }
    } catch {
      setMessage("操作未完成，请检查输入、邮箱验证状态或稍后重试。");
    }
  }
  async function google() {
    setOauthPending(true);
    setMessage("");
    try {
      const { error } = await browserClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(destination)}`,
        },
      });
      if (error) throw error;
    } catch {
      setMessage("Google 登录暂时不可用，请使用邮箱登录。");
      setOauthPending(false);
    }
  }
  return (
    <section className="auth-card">
      <span className="eyebrow">每一封邮件，都有温度</span>
      <h1>{titles[mode]}</h1>
      <p className="hint">管理客户、准备内容，让每一次联络更从容。</p>
      {!isConfigured() && <p role="alert">请先配置 Supabase 连接信息。</p>}
      <form onSubmit={form.handleSubmit(submit)} className="space-y-5">
        {mode !== "reset" && (
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              {...form.register("email")}
            />
            <p className="field-error">
              {form.formState.errors.email?.message}
            </p>
          </div>
        )}
        {mode !== "forgot" && (
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              {...form.register("password")}
            />
            <p className="field-error">
              {form.formState.errors.password?.message}
            </p>
          </div>
        )}
        <p role="status" className="hint">
          {message}
        </p>
        <Button className="w-full" disabled={busy || !isConfigured()}>
          {busy
            ? "请稍候…"
            : mode === "login"
              ? "登录邮局"
              : mode === "register"
                ? "注册账号"
                : mode === "forgot"
                  ? "发送重置邮件"
                  : "保存新密码"}
        </Button>
      </form>
      {(mode === "login" || mode === "register") && (
        <Button
          className="w-full mt-3"
          variant="outline"
          disabled={busy || !isConfigured()}
          onClick={google}
        >
          使用 Google 继续
        </Button>
      )}
      <div className="auth-links">
        <Link href={`${mode === "login" ? "/register" : "/login"}${nextQuery}`}>
          {mode === "login" ? "创建账号" : "返回登录"}
        </Link>
        <Link href="/forgot-password">忘记密码？</Link>
      </div>
    </section>
  );
}
