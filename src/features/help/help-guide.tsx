"use client";

import { useId, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowUp,
  CheckCircle2,
  Clock,
  Mail,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Notice } from "@/components/ui/notice";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { helpSections } from "./content";
import { DirectMailSetupGuide } from "./directmail-setup-guide";
import { settingsSectionHref } from "@/features/settings/anchors";

const sectionIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  sparkles: Sparkles,
  shield: ShieldCheck,
  rocket: Rocket,
  mail: Mail,
  users: Users,
  send: Send,
  "check-circle": CheckCircle2,
  clock: Clock,
};

type HelpSectionId =
  | "overview"
  | "roles"
  | "onboarding"
  | "directmail-setup"
  | "directmail-channel"
  | "contacts"
  | "campaigns"
  | "go-live"
  | "sendgrid-future"
  | "ses-future";

const KNOWN_SECTION_IDS = new Set<string>([
  "overview",
  "roles",
  "onboarding",
  "directmail-setup",
  "directmail-channel",
  "contacts",
  "campaigns",
  "go-live",
  "sendgrid-future",
  "ses-future",
]);

function targetRoleKey(
  label?: string,
): "all" | "adminEditor" | "adminOnly" | null {
  if (label === "全员通用") return "all";
  if (label === "管理员与运营") return "adminEditor";
  if (label === "仅管理员") return "adminOnly";
  return null;
}

export function HelpGuide({ role }: { role: string }) {
  const t = useTranslations("help");
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);
  const searchInputId = useId();

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 360);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

  const localizedSections = useMemo(
    () =>
      helpSections.map((section) => {
        const displayTitle = KNOWN_SECTION_IDS.has(section.id)
          ? t(`sections.${section.id as HelpSectionId}`)
          : section.title;
        const roleKey = targetRoleKey(section.targetRoleLabel);
        const displayRole = roleKey
          ? t(`targetRoles.${roleKey}`)
          : section.targetRoleLabel;
        const displayLinks = section.links?.map((link) => ({
          ...link,
          label:
            link.href === "/dashboard#onboarding"
              ? t("links.checklist")
              : link.href === "/campaigns?guide=campaigns"
                ? t("links.campaigns")
                : link.label,
        }));
        return {
          ...section,
          displayTitle,
          displayRole,
          displayLinks,
        };
      }),
    [t],
  );

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return localizedSections;

    return localizedSections.filter((section) => {
      if (section.displayTitle.toLowerCase().includes(q)) return true;
      if (section.title.toLowerCase().includes(q)) return true;
      if (section.intro && section.intro.toLowerCase().includes(q)) return true;
      if (section.steps?.some((step) => step.toLowerCase().includes(q)))
        return true;
      if (section.bullets?.some((item) => item.toLowerCase().includes(q)))
        return true;
      if (section.note && section.note.toLowerCase().includes(q)) return true;
      if (section.warning && section.warning.toLowerCase().includes(q))
        return true;
      if (section.keywords?.some((k) => k.toLowerCase().includes(q)))
        return true;
      if (section.displayRole && section.displayRole.toLowerCase().includes(q))
        return true;
      if (
        section.targetRoleLabel &&
        section.targetRoleLabel.toLowerCase().includes(q)
      )
        return true;
      return false;
    });
  }, [searchQuery, localizedSections]);

  const activeNav = useMemo(() => {
    return filteredSections.map(({ id, displayTitle }) => ({
      id,
      title: displayTitle,
    }));
  }, [filteredSections]);

  const roleBadgeLabel =
    role === "admin"
      ? t("roleCard.roles.admin")
      : role === "editor"
        ? t("roleCard.roles.editor")
        : t("roleCard.roles.viewer");

  return (
    <div className="help-guide space-y-6 w-full max-w-full min-w-0 overflow-x-clip">
      {/* 顶部角色与权限说明卡片 */}
      <Card className="border-dashed bg-card w-full min-w-0 max-w-full overflow-hidden">
        <CardContent className="space-y-2.5 pt-5 pb-5 sm:pt-6 sm:pb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-sm font-medium">
              {t("roleCard.introPrefix")}
              <Badge variant="secondary" className="ml-1.5 align-middle">
                {roleBadgeLabel}
              </Badge>
            </p>
            <span className="text-xs text-muted-foreground">
              {role === "admin"
                ? t("roleCard.adminScope")
                : t("roleCard.nonAdminScope")}
            </span>
          </div>
          <p className="hint m-0 text-xs sm:text-sm">
            {t("roleCard.permissionsHint")}
          </p>
          <p className="hint m-0 text-xs sm:text-sm">
            {t("roleCard.channelHintPrefix")}{" "}
            <Link
              href={settingsSectionHref("channels")}
              className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              {t("roleCard.channelHintLink")}
            </Link>
            {t("roleCard.channelHintSuffix")}
          </p>
          {locale === "en" && (
            <Notice className="mt-2 mb-0">{t("englishBodyNotice")}</Notice>
          )}
        </CardContent>
      </Card>

      {/* 搜索与快捷检索栏 */}
      <div className="space-y-3 w-full min-w-0 max-w-full">
        <div className="relative w-full min-w-0 max-w-full">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={searchInputId}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="h-10 pl-9 pr-9 text-sm w-full min-w-0 max-w-full"
            aria-label={t("search.ariaLabel")}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("search.clearAria")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* 目录导航（移动端横向滑动，大屏平铺折行） */}
        <nav
          id="help-directory-nav"
          aria-label={t("search.directoryAria")}
          className="flex w-full min-w-0 max-w-full overflow-x-auto pb-1 text-xs scrollbar-none sm:flex-wrap sm:pb-0 sm:text-sm gap-1.5 sm:gap-2"
        >
          {activeNav.map((item) => (
            <a
              key={item.id}
              href={`#help-${item.id}`}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center rounded-full border border-border/80 bg-card px-3 py-1.5 font-medium text-muted-foreground shadow-2xs transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground active:scale-95"
            >
              {item.title}
            </a>
          ))}
        </nav>
      </div>

      {/* 搜索过滤统计提示 */}
      {searchQuery.trim() && (
        <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3.5 py-2 text-xs text-muted-foreground">
          <span>
            {t("search.summary", {
              query: searchQuery,
              count: filteredSections.length,
            })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setSearchQuery("")}
          >
            {t("search.reset")}
          </Button>
        </div>
      )}

      {/* 搜索无结果空状态 */}
      {filteredSections.length === 0 ? (
        <Card className="py-12 text-center w-full min-w-0 max-w-full overflow-hidden">
          <CardContent className="space-y-3">
            <p className="text-base font-medium">{t("search.emptyTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("search.emptyDescription")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery("")}
            >
              {t("search.showAll")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        /* 章节列表 */
        filteredSections.map((section) => {
          if (section.id === "directmail-setup") {
            return <DirectMailSetupGuide key={section.id} />;
          }

          const IconComponent = section.icon
            ? sectionIcons[section.icon]
            : Sparkles;

          return (
            <Card
              key={section.id}
              id={`help-${section.id}`}
              className="scroll-mt-24 shadow-xs transition-shadow w-full min-w-0 max-w-full overflow-hidden"
            >
              <CardContent className="space-y-4 pt-5 pb-5 sm:pt-6 sm:pb-6">
                {/* 章节头部 */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b pb-3.5">
                  <div className="flex items-center gap-2.5">
                    {IconComponent && (
                      <span
                        className="flex size-7 items-center justify-center rounded-lg bg-muted text-foreground/80 sm:size-8"
                        aria-hidden="true"
                      >
                        <IconComponent className="size-4" />
                      </span>
                    )}
                    <h2 className="m-0 text-base font-semibold tracking-tight sm:text-lg">
                      {section.displayTitle}
                    </h2>
                  </div>
                  {section.displayRole && (
                    <Badge
                      variant="outline"
                      className="border-muted-foreground/30 text-xs font-normal text-muted-foreground"
                    >
                      {section.displayRole}
                    </Badge>
                  )}
                </div>

                {/* 介绍段落 */}
                {section.intro ? (
                  <p className="m-0 text-sm leading-relaxed text-foreground/90 sm:leading-7">
                    {section.intro}
                  </p>
                ) : null}

                {/* 有序步骤 */}
                {section.steps?.length ? (
                  <ol className="m-0 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-foreground/85 sm:leading-7">
                    {section.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ) : null}

                {/* 要点列表 */}
                {section.bullets?.length ? (
                  <ul className="m-0 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground/85 sm:leading-7">
                    {section.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}

                {/* 补充说明 */}
                {section.displayLinks?.length ? (
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {section.displayLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="inline-flex min-h-11 min-w-11 items-center text-sm underline underline-offset-4"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
                {section.note ? <Notice>{section.note}</Notice> : null}
                {section.warning ? (
                  <Notice tone="warning" role="alert">
                    {section.warning}
                  </Notice>
                ) : null}

                {/* 底部回到目录链接 */}
                <div className="flex justify-end pt-1">
                  <a
                    href="#help-directory-nav"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowUp className="size-3" aria-hidden="true" />
                    {t("backToDirectory")}
                  </a>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* 悬浮返回顶部按钮 */}
      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-40 flex size-10 items-center justify-center rounded-full border border-border/80 bg-card/90 text-foreground shadow-lg backdrop-blur-md transition-all hover:bg-muted hover:scale-105 active:scale-95 sm:bottom-8 sm:right-8"
          aria-label={t("backToTopAria")}
        >
          <ArrowUp className="size-5" />
        </button>
      )}
    </div>
  );
}
