import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "@fontsource/fraunces/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ROOT_CLIENT_NAMESPACES } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell");
  return {
    title: {
      default: t("meta.titleDefault"),
      template: t("meta.titleTemplate"),
    },
    description: t("meta.description"),
  };
}

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  // 根布局仅向客户端下发公共小包，各业务路由按需局部注入自身 namespace。
  const rootMessages = pickMessages(messages, ROOT_CLIENT_NAMESPACES);
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider locale={locale} messages={rootMessages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
