"use client";

import { useId, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  Clock,
  Info,
  Mail,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { helpNav, helpSections, type HelpSection } from "./content";
import { DirectMailSetupGuide } from "./directmail-setup-guide";

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

export function HelpGuide({ role }: { role: string }) {
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return helpSections;

    return helpSections.filter((section) => {
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
      if (
        section.targetRoleLabel &&
        section.targetRoleLabel.toLowerCase().includes(q)
      )
        return true;
      return false;
    });
  }, [searchQuery]);

  const activeNav = useMemo(() => {
    if (!searchQuery.trim()) return helpNav;
    const activeIds = new Set(filteredSections.map((s) => s.id));
    return helpNav.filter((item) => activeIds.has(item.id));
  }, [searchQuery, filteredSections]);

  return (
    <div className="help-guide space-y-6">
      {/* 顶部角色与权限说明卡片 */}
      <Card className="border-dashed bg-card/60 backdrop-blur-xs">
        <CardContent className="space-y-2.5 pt-5 pb-5 sm:pt-6 sm:pb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-sm font-medium">
              本文档说明当前版本的使用步骤与限制，随产品迭代更新。你的角色：
              <Badge variant="secondary" className="ml-1.5 align-middle">
                {role === "admin"
                  ? "管理员"
                  : role === "editor"
                    ? "运营"
                    : "查看者"}
              </Badge>
            </p>
            <span className="text-xs text-muted-foreground">
              {role === "admin"
                ? "拥有发信通道与全量功能权限"
                : "部分系统设置与正式发信需管理员权限"}
            </span>
          </div>
          <p className="hint m-0 text-xs sm:text-sm">
            配置发信通道、Webhook
            与正式发送仅管理员可操作；运营与查看者请以对应章节为准。
          </p>
          <p className="hint m-0 text-xs sm:text-sm">
            通道与追踪问题请先查看{" "}
            <Link
              href="/settings"
              className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              设置 → 发信通道
            </Link>
            。
          </p>
        </CardContent>
      </Card>

      {/* 搜索与快捷检索栏 */}
      <div className="space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={searchInputId}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索帮助内容，如：DNS、发信地址、退订保护、正式发送…"
            className="h-10 pl-9 pr-9 text-sm"
            aria-label="搜索使用帮助"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="清空搜索"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* 目录导航（移动端横向滑动，大屏平铺折行） */}
        <nav
          id="help-directory-nav"
          aria-label="帮助目录"
          className="-mx-4 flex overflow-x-auto px-4 pb-1 text-xs scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0 sm:text-sm gap-1.5 sm:gap-2"
        >
          {activeNav.map((item) => (
            <a
              key={item.id}
              href={`#help-${item.id}`}
              className="shrink-0 rounded-full border border-border/80 bg-card px-3 py-1.5 font-medium text-muted-foreground shadow-2xs transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground active:scale-95"
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
            搜索 “<strong className="text-foreground">{searchQuery}</strong>”
            找到了 {filteredSections.length} 个相关章节
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setSearchQuery("")}
          >
            重置搜索
          </Button>
        </div>
      )}

      {/* 搜索无结果空状态 */}
      {filteredSections.length === 0 ? (
        <Card className="py-12 text-center">
          <CardContent className="space-y-3">
            <p className="text-base font-medium">
              未找到与关键词相关的帮助章节
            </p>
            <p className="text-xs text-muted-foreground">
              请尝试使用其他关键词，或清空搜索查看全部帮助内容。
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery("")}
            >
              查看全部内容
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
              className="scroll-mt-24 shadow-xs transition-shadow"
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
                      {section.title}
                    </h2>
                  </div>
                  {section.targetRoleLabel && (
                    <Badge
                      variant="outline"
                      className="border-muted-foreground/30 text-xs font-normal text-muted-foreground"
                    >
                      {section.targetRoleLabel}
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
                {section.note ? (
                  <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed text-foreground/90">
                    <Info
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span>{section.note}</span>
                  </div>
                ) : null}

                {/* 安全警示 */}
                {section.warning ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                      aria-hidden="true"
                    />
                    <span>{section.warning}</span>
                  </div>
                ) : null}

                {/* 底部回到目录链接 */}
                <div className="flex justify-end pt-1">
                  <a
                    href="#help-directory-nav"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowUp className="size-3" aria-hidden="true" />
                    回到目录
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
          aria-label="返回页面顶部"
        >
          <ArrowUp className="size-5" />
        </button>
      )}
    </div>
  );
}
