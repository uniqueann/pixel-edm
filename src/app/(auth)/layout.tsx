import { Mail } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { Brand } from "@/components/brand";
import { LocaleToggle } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { ROOT_CLIENT_NAMESPACES } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locale, messages, tAuth, tShell] = await Promise.all([
    getLocale(),
    getMessages(),
    getTranslations("auth"),
    getTranslations("shell"),
  ]);
  // 认证路由组按需叠加 auth namespace，避免将全部业务词库注入登录页。
  const authMessages = pickMessages(messages, [
    ...ROOT_CLIENT_NAMESPACES,
    "auth",
  ]);
  return (
    <NextIntlClientProvider locale={locale} messages={authMessages}>
      <main className="auth-shell">
        <div className="auth-stack">
          <header className="auth-masthead">
            <Brand />
            <div className="flex items-center gap-1">
              <LocaleToggle />
              <ThemeToggle />
            </div>
          </header>
          <div className="auth-frame">
            <aside className="auth-aside">
              <div className="auth-aside-copy">
                <p className="auth-aside-line">
                  {tAuth("aside.line1")}
                  <br />
                  {tAuth("aside.line2")}
                </p>
                <p className="auth-aside-note">
                  {tAuth("aside.note1")}
                  <br />
                  {tAuth("aside.note2")}
                </p>
              </div>
              {/* 邮戳是邮政世界的几何细节，随容器裁切，不参与信息层级。 */}
              <span className="auth-postmark" aria-hidden="true">
                <Mail size={26} strokeWidth={1.5} />
              </span>
            </aside>
            <div className="auth-panel">{children}</div>
          </div>
          <p className="auth-foot">{tShell("footerTagline")}</p>
        </div>
      </main>
    </NextIntlClientProvider>
  );
}
