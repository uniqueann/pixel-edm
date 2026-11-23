"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown, LogOut } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Brand } from "./brand";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { LocaleToggle } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { signOut, switchWorkspace } from "@/app/actions";
import { GuideContext } from "@/features/onboarding/guide-context";
const tabSlugs = [
  "dashboard",
  "contacts",
  "templates",
  "campaigns",
  "team",
  "logs",
  "settings",
  "help",
] as const;
type NavSlug = (typeof tabSlugs)[number];
type RoleKey = "admin" | "editor" | "viewer";
/** 窄屏收入「更多」菜单的低频导航项 */
const overflowTabSlugs = new Set<string>(["logs", "help"]);

function tabIsActive(pathname: string, slug: string) {
  return pathname === `/${slug}` || pathname.startsWith(`/${slug}/`);
}
export function AppShell({
  children,
  name,
  role,
  workspaceId,
  userId,
  canWrite,
  workspaces,
  workspaceBadge,
  showTeamNav = false,
  showLogsNav = false,
}: {
  children: React.ReactNode;
  name: string;
  role: string;
  workspaceId: string;
  userId: string;
  canWrite: boolean | null;
  workspaces: { id: string; name: string }[];
  workspaceBadge: string;
  showTeamNav?: boolean;
  showLogsNav?: boolean;
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const router = useRouter();
  const t = useTranslations("shell");
  const visibleTabs: [NavSlug, string][] = tabSlugs
    .filter((slug) => slug !== "team" || showTeamNav)
    .filter((slug) => slug !== "logs" || (role === "admin" && showLogsNav))
    .map((slug) => [slug, t(`nav.${slug}`)]);
  const roleLabel =
    role === "admin" || role === "editor" || role === "viewer"
      ? t(`roles.${role as RoleKey}`)
      : role;
  const primaryTabs = visibleTabs.filter(
    ([slug]) => !overflowTabSlugs.has(slug),
  );
  const overflowTabs = visibleTabs.filter(([slug]) =>
    overflowTabSlugs.has(slug),
  );
  const overflowActive = overflowTabs.some(([slug]) =>
    tabIsActive(pathname, slug),
  );

  useEffect(() => {
    const trigger = moreTriggerRef.current;
    if (!moreOpen || !trigger) return;

    // 旋转到横屏时，独立渲染的菜单也要随已隐藏的触发器关闭。
    const observer = new ResizeObserver(() => {
      if (trigger.getClientRects().length === 0) setMoreOpen(false);
    });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [moreOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("skipToContent")}
      </a>
      <div className="app-sticky-header">
        <header
          className="topbar unified-header"
          aria-label={t("topbarAriaLabel")}
        >
          <div className="topbar-brand">
            <Brand />
          </div>

          <div className="topbar-divider" aria-hidden="true" />

          <div className="topbar-workspace">
            <Select
              value={workspaceId}
              disabled={pending}
              onValueChange={(id) =>
                startTransition(async () => {
                  try {
                    await switchWorkspace(id);
                    queryClient.clear();
                    router.refresh();
                  } catch {
                    toast.error(t("workspaceSwitchFailed"));
                  }
                })
              }
            >
              <SelectTrigger
                aria-label={t("workspaceSelectAriaLabel")}
                className="workspace-select"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="topbar-badge">
            <Badge variant="secondary" className="workspace-badge">
              {workspaceBadge}
            </Badge>
          </div>

          <div className="topbar-identity">
            <div className="identity-who">
              <span className="avatar">{name.slice(0, 2)}</span>
              <div className="identity-meta min-w-0">
                <p className="truncate text-sm font-medium">{name}</p>
                <span className="role-pill">{roleLabel}</span>
              </div>
            </div>
          </div>

          <div className="topbar-theme gap-1">
            <LocaleToggle />
            <ThemeToggle />
          </div>

          <div className="topbar-signout">
            <form
              action={async () => {
                queryClient.clear();
                await signOut();
              }}
            >
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("signOutAriaLabel")}
              >
                <LogOut size={16} />
              </Button>
            </form>
          </div>
        </header>
        <div className="tabs-scroll-wrap">
          <nav className="tabs" aria-label={t("nav.ariaLabel")}>
            {[...primaryTabs, ...overflowTabs].map(([slug, label]) => (
              <Link
                key={slug}
                href={`/${slug}`}
                aria-current={tabIsActive(pathname, slug) ? "page" : undefined}
                className={
                  tabIsActive(pathname, slug)
                    ? `tab active${overflowTabSlugs.has(slug) ? " tab-collapsible" : ""}`
                    : `tab${overflowTabSlugs.has(slug) ? " tab-collapsible" : ""}`
                }
              >
                {label}
              </Link>
            ))}
            {overflowTabs.length > 0 && (
              <DropdownMenu.Root open={moreOpen} onOpenChange={setMoreOpen}>
                <DropdownMenu.Trigger asChild>
                  <button
                    ref={moreTriggerRef}
                    type="button"
                    className={`tabs-more tab${overflowActive ? " active" : ""}`}
                    aria-label={t("nav.moreAriaLabel")}
                  >
                    {t("nav.more")}
                    <ChevronDown size={14} aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    onCloseAutoFocus={(event) => {
                      const trigger = moreTriggerRef.current;
                      if (!trigger || trigger.getClientRects().length > 0)
                        return;
                      event.preventDefault();
                      const nav = trigger.closest("nav");
                      const inlineLink =
                        nav?.querySelector<HTMLAnchorElement>(
                          '.tab-collapsible[aria-current="page"]',
                        ) ??
                        nav?.querySelector<HTMLAnchorElement>(
                          ".tab-collapsible",
                        );
                      inlineLink?.focus();
                    }}
                    className="z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                  >
                    {overflowTabs.map(([slug, label]) => (
                      <DropdownMenu.Item key={slug} asChild>
                        <Link
                          href={`/${slug}`}
                          className="flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          aria-current={
                            tabIsActive(pathname, slug) ? "page" : undefined
                          }
                        >
                          {label}
                        </Link>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </nav>
        </div>
      </div>
      <main
        id="main-content"
        className="view"
        key={`${userId}:${workspaceId}:${role}`}
      >
        <Suspense fallback={null}>
          <GuideContext role={role} canWrite={canWrite} />
        </Suspense>
        {children}
      </main>
      <footer className="app-footer">{t("footerTagline")}</footer>
    </div>
  );
}
