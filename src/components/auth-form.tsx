"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { browserClient } from "@/lib/supabase/client";
import {
  authCallbackUrl,
  isConfigured,
  passwordRecoveryRedirectUrl,
} from "@/lib/supabase/config";
import { credentials } from "@/lib/validation";
import { mapAuthError } from "@/lib/auth-errors";
import { syncMemberLocale } from "@/i18n/actions";
import { useValidationMessage } from "@/i18n/use-resolvers";

type Mode = "login" | "register" | "forgot" | "reset";

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
  const t = useTranslations("auth");
  const translateValidation = useValidationMessage();

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"hint" | "error" | "success">(
    "hint",
  );
  const [canResendVerification, setCanResendVerification] = useState(false);
  const [resendPending, setResendPending] = useState(false);
  const [oauthPending, setOauthPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const schema = z.object({
    email: mode === "reset" ? z.string() : credentials.shape.email,
    password:
      mode === "forgot"
        ? z.string()
        : mode === "login"
          ? z.string().min(1, "validation.passwordRequired")
          : credentials.shape.password,
  });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const submitting = form.formState.isSubmitting;
  const busy = submitting || oauthPending || resendPending;
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
      setMessage(t("notices.enterEmailBeforeResend"));
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
      setMessage(t("notices.verificationResent"));
      setMessageType("success");
      setCanResendVerification(false);
    } catch (err) {
      const mapped = mapAuthError(err);
      setMessage(t(`errors.${mapped.errorKey}`));
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
        setMessage(t("notices.resetEmailSent"));
        setMessageType("success");
      } else if (mode === "reset") {
        const {
          data: { user },
        } = await db.auth.getUser();
        if (!user) {
          setMessage(t("notices.resetLinkExpired"));
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
          await syncMemberLocale();
          router.replace(destination);
          router.refresh();
        } else {
          setMessage(t("notices.checkVerificationEmail"));
          setMessageType("success");
        }
      } else {
        const { error } = await db.auth.signInWithPassword({
          email: values.email!,
          password: values.password!,
        });
        if (error) throw error;
        await syncMemberLocale();
        router.replace(destination);
        router.refresh();
      }
    } catch (err) {
      const mapped = mapAuthError(err);
      setMessage(t(`errors.${mapped.errorKey}`));
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
      setMessage(t("notices.googleUnavailable"));
      setMessageType("error");
      setOauthPending(false);
    }
  }

  return (
    <section className="auth-card">
      <div className="auth-head">
        <h1>{t(`modes.${mode}.title`)}</h1>
        <p>{t(`modes.${mode}.description`)}</p>
      </div>
      {callbackError && (
        <Notice tone="error" className="auth-notice" role="alert">
          {callbackError}
        </Notice>
      )}
      {!isConfigured() && (
        <Notice tone="error" className="auth-notice" role="alert">
          {t("serviceUnconfigured")}
        </Notice>
      )}
      <form onSubmit={form.handleSubmit(submit)} className="auth-form">
        {mode !== "reset" && (
          <div className="auth-field">
            <Label htmlFor="email">{t("fields.email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(form.formState.errors.email)}
              aria-describedby={
                form.formState.errors.email ? "email-error" : undefined
              }
              {...form.register("email")}
            />
            {form.formState.errors.email && (
              <p id="email-error" className="field-error" role="alert">
                {translateValidation(form.formState.errors.email.message)}
              </p>
            )}
          </div>
        )}
        {mode !== "forgot" && (
          <div className="auth-field">
            <Label htmlFor="password">{t("fields.password")}</Label>
            <div className="auth-password">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                aria-invalid={Boolean(form.formState.errors.password)}
                aria-describedby={
                  form.formState.errors.password ? "password-error" : undefined
                }
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                {...form.register("password")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="auth-password-toggle"
                aria-label={
                  showPassword
                    ? t("fields.hidePassword")
                    : t("fields.showPassword")
                }
                aria-pressed={showPassword}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" />
                ) : (
                  <Eye aria-hidden="true" />
                )}
              </Button>
            </div>
            {form.formState.errors.password && (
              <p id="password-error" className="field-error" role="alert">
                {translateValidation(form.formState.errors.password.message)}
              </p>
            )}
          </div>
        )}
        {message && (
          // 认证反馈保持中性：找回密码等提示可能是条件式说明，避免误用成功色。
          <Notice
            tone={messageType === "error" ? "error" : "info"}
            role={messageType === "error" ? "alert" : "status"}
          >
            {message}
          </Notice>
        )}
        {canResendVerification && (mode === "login" || mode === "register") && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy || !isConfigured()}
            aria-busy={resendPending}
            onClick={resendVerificationEmail}
          >
            {resendPending && (
              <Loader2
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {resendPending
              ? t("actions.resendingVerification")
              : t("actions.resendVerification")}
          </Button>
        )}
        <Button
          className="w-full"
          disabled={busy || !isConfigured()}
          aria-busy={submitting}
        >
          {submitting && (
            <Loader2
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {submitting ? t("actions.submitting") : t(`modes.${mode}.submit`)}
        </Button>
      </form>
      {(mode === "login" || mode === "register") && (
        <>
          <div className="auth-divider" aria-hidden="true">
            <span>{t("actions.or")}</span>
          </div>
          <Button
            type="button"
            className="w-full"
            variant="outline"
            disabled={busy || !isConfigured()}
            aria-busy={oauthPending}
            onClick={google}
          >
            {oauthPending ? (
              <Loader2
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <span className="auth-google-mark">
                <GoogleMark />
              </span>
            )}
            {oauthPending
              ? t("actions.redirectingGoogle")
              : t("actions.continueWithGoogle")}
          </Button>
        </>
      )}
      <div
        className={
          mode === "login" ? "auth-links" : "auth-links auth-links-center"
        }
      >
        <span className="auth-links-group">
          <span>
            {mode === "login"
              ? t("actions.noAccountPrompt")
              : t("actions.hasAccountPrompt")}
          </span>
          <Link
            href={`${mode === "login" ? "/register" : "/login"}${nextQuery}`}
          >
            {mode === "login"
              ? t("actions.createAccount")
              : t("actions.backToLogin")}
          </Link>
        </span>
        {mode === "login" && (
          <Link href="/forgot-password">{t("actions.forgotPassword")}</Link>
        )}
      </div>
    </section>
  );
}

/** Google 四色 G 标识，放在白色圆角底上，保证深色主题也能正确显示负空间。 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
