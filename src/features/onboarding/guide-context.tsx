"use client";

import Link from "next/link";
import { useLayoutEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import {
  preparationHref,
  preparationOverviewHref,
  type GuideTask,
} from "./links";
import styles from "./preparation.module.css";

const taskRoutes: Record<GuideTask, { path: string; next: GuideTask }> = {
  store: { path: "/settings", next: "channels" },
  channels: { path: "/settings", next: "contacts" },
  contacts: { path: "/contacts", next: "templates" },
  templates: { path: "/templates", next: "campaigns" },
  campaigns: { path: "/campaigns", next: "campaigns" },
};

function stickyChrome() {
  return {
    header: document.querySelector<HTMLElement>(".app-sticky-header"),
    rail: document.querySelector<HTMLElement>(
      "[data-guide-context][data-sticky='true']",
    ),
  };
}

/** 写入顶栏 / 引导条高度，供吸顶偏移和 scroll-padding 使用。 */
function measureStickyOffsets() {
  const { header, rail } = stickyChrome();
  const root = document.documentElement;
  if (header) {
    root.style.setProperty(
      "--app-header-height",
      `${Math.floor(header.getBoundingClientRect().height)}px`,
    );
  }
  if (rail) {
    root.style.setProperty(
      "--guide-rail-height",
      `${Math.ceil(rail.getBoundingClientRect().height)}px`,
    );
  } else {
    root.style.removeProperty("--guide-rail-height");
  }
}

function settingsHashTarget() {
  const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (!id.startsWith("settings-")) return null;
  return document.getElementById(id);
}

/** 把当前设置锚点滚到顶栏和引导条之下。只在进入页面或切换锚点时调用。 */
function revealSettingsAnchor() {
  measureStickyOffsets();
  const target = settingsHashTarget();
  if (!target) return;
  void getComputedStyle(document.documentElement).scrollPaddingTop;
  target.scrollIntoView();
}

export function GuideContext({
  role,
  canWrite,
}: {
  role: string;
  canWrite: boolean | null;
}) {
  const pathname = usePathname();
  const guide = useSearchParams().get("guide");
  const t = useTranslations("shell.guide");
  useLayoutEffect(() => {
    let frame = 0;
    let correcting = false;
    let userTookOver = false;
    let timer = 0;
    let stopTimer = 0;
    const align = () => {
      if (userTookOver || correcting) return;
      correcting = true;
      revealSettingsAnchor();
      correcting = false;
    };
    const alignTo = (id: string) => {
      if (userTookOver || correcting) return;
      correcting = true;
      measureStickyOffsets();
      const target = document.getElementById(id);
      if (target) {
        void getComputedStyle(document.documentElement).scrollPaddingTop;
        target.scrollIntoView();
      }
      correcting = false;
    };
    // 水合后路由可能把深链拉回顶部。只在仍停在顶端且锚点在首屏外时重试。
    const mislanded = () => {
      const target = settingsHashTarget();
      if (!target) return false;
      return (
        window.scrollY < 4 &&
        target.getBoundingClientRect().top > window.innerHeight * 0.5
      );
    };
    const beginNavigation = (id?: string) => {
      userTookOver = false;
      window.clearInterval(timer);
      window.clearTimeout(stopTimer);
      const step = (force: boolean) => {
        if (userTookOver || (!force && !mislanded())) return;
        if (id) alignTo(id);
        else align();
      };
      step(true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => step(true));
      timer = window.setInterval(() => step(false), 150);
      stopTimer = window.setTimeout(() => window.clearInterval(timer), 2000);
    };
    const onScroll = () => {
      if (correcting) return;
      const target = settingsHashTarget();
      const top = target?.getBoundingClientRect().top ?? 0;
      // 路由把页面拉回顶端、锚点仍在首屏之外，留给上面的初始化重试。
      if (target && window.scrollY < 4 && top > window.innerHeight * 0.5)
        return;
      userTookOver = true;
      window.clearInterval(timer);
    };
    // 同页锚点由路由 pushState 更新，不一定触发 hashchange。
    const onClick = (event: MouseEvent) => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      const id = node
        .closest("a")
        ?.getAttribute("href")
        ?.match(/#(settings-[a-z0-9-]+)/)?.[1];
      if (!id) return;
      beginNavigation(id);
      window.setTimeout(() => alignTo(id), 50);
      window.setTimeout(() => alignTo(id), 200);
    };
    const { header, rail } = stickyChrome();
    const observer = new ResizeObserver(() => measureStickyOffsets());
    if (header) observer.observe(header);
    if (rail) observer.observe(rail);
    const onHashChange = () => beginNavigation();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    beginNavigation();
    void document.fonts?.ready.then(() => align());
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.clearTimeout(stopTimer);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick);
    };
  }, [pathname, guide]);
  if (!guide || !Object.hasOwn(taskRoutes, guide)) return null;
  const task = guide as GuideTask;
  const route = taskRoutes[task];
  if (pathname !== route.path && !pathname.startsWith(`${route.path}/`))
    return null;
  const requiresAdmin = task === "store" || task === "channels";
  const sticky = pathname === "/settings";
  return (
    <aside
      aria-label={t("ariaLabel")}
      data-guide-context=""
      data-sticky={sticky ? "true" : undefined}
      className={styles.context}
    >
      <div>
        <strong>{t(`tasks.${task}.title`)}</strong>
        <p>
          {requiresAdmin && role !== "admin"
            ? t("adminOnlyDetail")
            : t(`tasks.${task}.detail`)}
        </p>
      </div>
      <div className={styles.contextActions}>
        <Link href={preparationOverviewHref} className={styles.textLink}>
          {t("backToChecklist")}
        </Link>
        {canWrite === true &&
          task !== "campaigns" &&
          (!requiresAdmin || role === "admin") && (
            <Link
              href={preparationHref(route.next)}
              className={styles.textLink}
            >
              {t(`tasks.${task}.nextLabel`)}
              <ArrowRight size={16} aria-hidden />
            </Link>
          )}
      </div>
    </aside>
  );
}
