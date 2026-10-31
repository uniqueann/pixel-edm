"use client";

import Link from "next/link";
import { useLayoutEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  preparationHref,
  preparationOverviewHref,
  type GuideTask,
} from "./links";
import styles from "./preparation.module.css";

const contexts: Record<
  GuideTask,
  {
    path: string;
    title: string;
    detail: string;
    next: GuideTask;
    nextLabel: string;
  }
> = {
  store: {
    path: "/settings",
    title: "准备发件身份",
    detail:
      "保存店铺信息与真实页脚地址后，继续连接主发信通道。我的署名是建议项。",
    next: "channels",
    nextLabel: "继续配置通道",
  },
  channels: {
    path: "/settings",
    title: "连接并验证主通道",
    detail:
      "先保存配置，再由管理员发送测试邮件。服务商接收不等于送达、进入收件箱或已读。",
    next: "contacts",
    nextLabel: "继续准备客户",
  },
  contacts: {
    path: "/contacts",
    title: "准备已订阅客户",
    detail:
      "核对导入结果与订阅授权。添加或导入成功不代表客户已订阅，也不代表必然进入活动名单。",
    next: "templates",
    nextLabel: "继续准备模板",
  },
  templates: {
    path: "/templates",
    title: "准备邮件内容",
    detail:
      "可编辑预置模板，预览核对后保存；活动中仍需核对本次变量和客户名单。",
    next: "campaigns",
    nextLabel: "继续创建活动",
  },
  campaigns: {
    path: "/campaigns",
    title: "创建并核对第一场活动",
    detail:
      "新建草稿 → 预览邮件与收件人 → 确认活动名单。正式发送仍由管理员按原流程明确确认。",
    next: "campaigns",
    nextLabel: "查看活动",
  },
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

/**
 * 带锚点的设置页在水合后可能被路由滚回顶部。
 * 只在仍停在页面顶端、目标却在首屏之下时补一次滚动，避免锁死用户之后的滚动。
 */
function revealSettingsAnchor(force = false) {
  measureStickyOffsets();
  const target = settingsHashTarget();
  if (!target) return;
  const cover =
    parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) ||
    0;
  const top = target.getBoundingClientRect().top;
  // 目标还在吸顶区下方一大截时补滚。已经对齐或用户继续下滚（top 变小）时不打断。
  if (force || top > cover + 80) target.scrollIntoView();
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
  useLayoutEffect(() => {
    let frame = 0;
    let correcting = false;
    let stuck = 0;
    const run = (force: boolean) => {
      if (correcting) return;
      const before = window.scrollY;
      correcting = true;
      revealSettingsAnchor(force);
      correcting = false;
      if (force || window.scrollY !== before) stuck = 0;
      else stuck += 1;
    };
    const schedule = (force: boolean) => {
      if (!force && stuck > 2) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => run(force));
    };
    run(true);
    schedule(true);
    void document.fonts?.ready.then(() => schedule(true));
    // 只有引导条吸顶时才持续把锚点拉回。普通设置锚点若跟着滚动，
    // 会在点击「发送测试邮件」时把说明文字盖住按钮。
    const railIsSticky = () =>
      Boolean(
        document.querySelector("[data-guide-context][data-sticky='true']"),
      );
    const timer = window.setInterval(() => {
      if (railIsSticky()) revealSettingsAnchor(false);
    }, 150);
    const stopTimer = window.setTimeout(
      () => window.clearInterval(timer),
      2000,
    );
    const { header, rail } = stickyChrome();
    const observer = new ResizeObserver(() => measureStickyOffsets());
    if (header) observer.observe(header);
    if (rail) observer.observe(rail);
    let pendingId = "";
    let followUntil = 0;
    const alignTo = (id: string) => {
      if (correcting) return;
      correcting = true;
      measureStickyOffsets();
      const target = document.getElementById(id);
      if (target) {
        void getComputedStyle(document.documentElement).scrollPaddingTop;
        target.scrollIntoView();
      }
      correcting = false;
    };
    const onHashChange = () => schedule(true);
    const onScroll = () => {
      if (correcting || !railIsSticky()) return;
      if (pendingId && performance.now() < followUntil) {
        const target = document.getElementById(pendingId);
        const cover =
          parseFloat(
            getComputedStyle(document.documentElement).scrollPaddingTop,
          ) || 0;
        const top = target?.getBoundingClientRect().top ?? cover;
        if (Math.abs(top - cover) > 24) alignTo(pendingId);
        return;
      }
      if (!window.location.hash.startsWith("#settings-")) return;
      schedule(false);
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
      pendingId = id;
      followUntil = performance.now() + 600;
      alignTo(id);
      requestAnimationFrame(() => alignTo(id));
      window.setTimeout(() => alignTo(id), 50);
      window.setTimeout(() => alignTo(id), 200);
    };
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.clearTimeout(stopTimer);
      observer.disconnect();
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick);
    };
  }, [pathname, guide]);
  if (!guide || !Object.hasOwn(contexts, guide)) return null;
  const task = guide as GuideTask;
  const context = contexts[task];
  if (pathname !== context.path && !pathname.startsWith(`${context.path}/`))
    return null;
  const requiresAdmin = task === "store" || task === "channels";
  const sticky = pathname === "/settings";
  return (
    <aside
      aria-label="首次使用引导"
      data-guide-context=""
      data-sticky={sticky ? "true" : undefined}
      className={styles.context}
    >
      <div>
        <strong>{context.title}</strong>
        <p>
          {requiresAdmin && role !== "admin"
            ? "此项需管理员处理。你可以返回清单，查看当前角色可完成的准备。"
            : context.detail}
        </p>
      </div>
      <div className={styles.contextActions}>
        <Link href={preparationOverviewHref} className={styles.textLink}>
          返回准备清单
        </Link>
        {canWrite === true &&
          task !== "campaigns" &&
          (!requiresAdmin || role === "admin") && (
            <Link
              href={preparationHref(context.next)}
              className={styles.textLink}
            >
              {context.nextLabel}
              <ArrowRight size={16} aria-hidden />
            </Link>
          )}
      </div>
    </aside>
  );
}
