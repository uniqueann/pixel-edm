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
import {
  authCallbackUrl,
  isConfigured,
  passwordRecoveryRedirectUrl,
} from "@/lib/supabase/config";
import { credentials } from "@/lib/validation";
import { mapAuthError } from "@/lib/auth-errors";
type Mode = "login" | "register" | "forgot" | "reset";
const titles: Record<Mode, string> = {
  login: "欢迎回到邮局",
  register: "开启你的卖家邮局",
  forgot: "找回密码",
  reset: "设置新密码",
};
const descriptions: Record<Mode, string> = {
  login: "登录你的账号，管理客户并发送邮件。",
  register: "创建你的工作区账号，开启客户邮件营销。",
  forgot: "输入注册邮箱，我们将向你发送密码重置链接。",
  reset: "请设置你的新密码并妥善保管。",
};
export function AuthForm({
  mode,
  nextPath,
  callbackError,
}: {
  mode: Mode;
  nextPath?: string;
  /** 邮件回调失败等页面级错误，显示在卡片内 */
  callbackError?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"hint" | "error" | "success">(
    "hint",
  );
  const [canResendVerification, setCanResendVerification] = useState(false);
  const [resendPending, setResendPending] = useState(false);
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
  const busy = form.formState.isSubmitting || oauthPending || resendPending;
  const destination =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : "/onboarding";
  const nextQuery =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? `?next=${encodeURIComponent(nextPath)}`
      : "";
  async function resendVerificationEmail() {
    const email = form.getValues("email")?.trim();
    if (!email) {
      setMessage("请先填写注册邮箱，再重新发送验证邮件。");
      setMessageType("error");
      return;
    }
    setResendPending(true);
    setMessage("");
    setMessageType("hint");
    try {
      const { error } = await browserClient().auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: authCallbackUrl(destination) },
      });
      if (error) throw error;
      setMessage("验证邮件已重新发送，请在当前浏览器打开邮件中的链接。");
      setMessageType("success");
      setCanResendVerification(false);
    } catch (err) {
      const mapped = mapAuthError(err);
      setMessage(mapped.message);
      setMessageType("error");
    } finally {
      setResendPending(false);
    }
  }

  async function submit(values: { email?: string; password?: string }) {
    setMessage("");
    setMessageType("hint");
    setCanResendVerification(false);
    try {
      const db = browserClient();
      if (mode === "forgot") {
        const { error } = await db.auth.resetPasswordForEmail(values.email!, {
          redirectTo: passwordRecoveryRedirectUrl(),
        });
        if (error) throw error;
        setMessage(
          "如果该邮箱已注册，你将收到密码重置邮件，请在当前浏览器打开。",
        );
        setMessageType("success");
      } else if (mode === "reset") {
        const {
          data: { user },
        } = await db.auth.getUser();
        if (!user) {
          setMessage("重置链接已失效，请重新申请。");
          setMessageType("error");
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
            emailRedirectTo: authCallbackUrl(destination),
          },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(destination);
          router.refresh();
        } else {
          setMessage(
            "请检查邮箱中的验证邮件，并在当前浏览器完成验证。已有账号可直接登录。",
          );
          setMessageType("success");
        }
      } else {
        const { error } = await db.auth.signInWithPassword({
          email: values.email!,
          password: values.password!,
        });
        if (error) throw error;
        router.replace(destination);
        router.refresh();
      }
    } catch (err) {
      const mapped = mapAuthError(err);
      setMessage(mapped.message);
      setMessageType("error");
      setCanResendVerification(mapped.canResendVerification);
    }
  }
  async function google() {
    setOauthPending(true);
    setMessage("");
    setMessageType("hint");
    try {
      const { error } = await browserClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: authCallbackUrl(destination),
        },
      });
      if (error) throw error;
    } catch {
      setMessage("Google 登录暂时不可用，请使用邮箱登录。");
      setMessageType("error");
      setOauthPending(false);
    }
  }
  return (
    <section className="auth-card">
      <span className="eyebrow">卖家邮局</span>
      <h1>{titles[mode]}</h1>
      <p className="hint">{descriptions[mode]}</p>
      {callbackError && (
        <p className="field-error mt-3" role="alert">
          {callbackError}
        </p>
      )}
      {!isConfigured() && (
        <p className="field-error mt-3" role="alert">
          系统服务配置异常，请联系管理员。
        </p>
      )}
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
        {message && (
          <p
            role={messageType === "error" ? "alert" : "status"}
            className={messageType === "error" ? "field-error" : "hint"}
          >
            {message}
          </p>
        )}
        {canResendVerification && (mode === "login" || mode === "register") && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy || !isConfigured()}
            onClick={resendVerificationEmail}
          >
            {resendPending ? "正在发送…" : "重新发送验证邮件"}
          </Button>
        )}
        <Button className="w-full" disabled={busy || !isConfigured()}>
          {busy
            ? "请稍候…"
            : mode === "login"
              ? "登录"
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
        {mode === "login" && <Link href="/forgot-password">忘记密码？</Link>}
      </div>
    </section>
  );
}
