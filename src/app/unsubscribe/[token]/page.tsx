import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { inspectUnsubscribe } from "@/features/unsubscribe/service";
import { UnsubscribeConfirm } from "@/features/unsubscribe/unsubscribe-form";
import {
  normalizeLocale,
  parseAcceptLanguage,
  type UnsubscribeLanguageMode,
} from "@/i18n/config";

export const dynamic = "force-dynamic";

/**
 * 退订页展示模式：
 * - 显式 ?lang=zh / ?lang=en 时严格按参数单语渲染；
 * - 未带参数且浏览器 Accept-Language 偏好英文时单语渲染英文；
 * - 中文或未知语言默认保持中英双语兜底（兼顾外部收件人与既有双语预期）。
 */
async function resolvePageMode(
  langParam: string | string[] | undefined,
): Promise<UnsubscribeLanguageMode> {
  const raw = Array.isArray(langParam) ? langParam[0] : langParam;
  const fromQuery = normalizeLocale(raw);
  if (fromQuery) return fromQuery;
  const acceptLanguage = (await headers()).get("accept-language");
  if (parseAcceptLanguage(acceptLanguage) === "en") return "en";
  return "bilingual";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}): Promise<Metadata> {
  const { lang } = await searchParams;
  const mode = await resolvePageMode(lang);
  const title = mode === "en" ? "Unsubscribe" : "邮件退订";
  return {
    title,
    robots: { index: false, follow: false, noarchive: true },
  };
}

function Message({
  reason,
  mode,
}: {
  reason: "invalid" | "unavailable";
  mode: UnsubscribeLanguageMode;
}) {
  const showZh = mode === "zh-CN" || mode === "bilingual";
  const showEn = mode === "en" || mode === "bilingual";
  if (reason === "invalid") {
    return (
      <>
        <h1>{mode === "en" ? "Invalid link" : "链接无效"}</h1>
        {showZh && <p>这条退订链接无效或已被停用，请直接联系邮件发件人。</p>}
        {showEn && (
          <p>
            This unsubscribe link is invalid or has been disabled. Please
            contact the sender.
          </p>
        )}
      </>
    );
  }
  return (
    <>
      <h1>{mode === "en" ? "Temporarily unavailable" : "暂时无法处理"}</h1>
      {showZh && <p>服务暂时不可用，请稍后重新打开此页面。</p>}
      {showEn && (
        <p>The service is temporarily unavailable. Please try again later.</p>
      )}
    </>
  );
}

export default async function Page({
  params,
  searchParams,
}: PageProps<"/unsubscribe/[token]">) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const mode = await resolvePageMode(query.lang);
  const result = await inspectUnsubscribe(token);
  const basePath = `/unsubscribe/${encodeURIComponent(token)}`;
  const showZh = mode === "zh-CN" || mode === "bilingual";
  const showEn = mode === "en" || mode === "bilingual";

  return (
    <main className="unsubscribe-wrap relative">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <nav
          aria-label={
            mode === "en"
              ? "Switch unsubscribe page language"
              : "切换退订页语言"
          }
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          <Link
            href={`${basePath}?lang=zh`}
            aria-current={mode === "zh-CN" ? "page" : undefined}
            className={`rounded px-1.5 py-1 transition-colors hover:text-foreground ${
              mode === "zh-CN" ? "font-semibold text-foreground" : ""
            }`}
          >
            中文
          </Link>
          <span aria-hidden="true">/</span>
          <Link
            href={`${basePath}?lang=en`}
            aria-current={mode === "en" ? "page" : undefined}
            className={`rounded px-1.5 py-1 transition-colors hover:text-foreground ${
              mode === "en" ? "font-semibold text-foreground" : ""
            }`}
          >
            English
          </Link>
        </nav>
        <ThemeToggle />
      </div>
      <Brand label={mode === "en" ? "Pixel EDM" : undefined} />
      <section className="unsubscribe-card">
        {!result.ok ? (
          <Message reason={result.reason} mode={mode} />
        ) : result.data.status === "already_suppressed" ? (
          <div className="unsubscribe-result" role="status">
            <h1>{mode === "en" ? "Already unsubscribed" : "已经退订"}</h1>
            {showZh && (
              <p>
                {result.data.masked_email} 已不会再收到来自{" "}
                {result.data.workspace_name} 的营销邮件。
              </p>
            )}
            {showEn && (
              <p>
                This address is already unsubscribed from marketing emails from{" "}
                {result.data.workspace_name}.
              </p>
            )}
          </div>
        ) : (
          <UnsubscribeConfirm
            token={token}
            maskedEmail={result.data.masked_email}
            workspaceName={result.data.workspace_name}
            mode={mode}
          />
        )}
      </section>
      <p className="auth-foot">
        {mode === "en"
          ? "Pixel EDM · Respecting every customer relationship"
          : mode === "zh-CN"
            ? "卖家邮局 · 尊重每一次客户联络"
            : "卖家邮局 · Respecting every customer relationship"}
      </p>
    </main>
  );
}
