"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, LogOut } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Brand } from "./brand";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ThemeToggle } from "./theme-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { signOut, switchWorkspace } from "@/app/actions";
const tabs = [
  ["dashboard", "总览"],
  ["contacts", "客户"],
  ["templates", "模板"],
  ["campaigns", "活动"],
  ["team", "团队"],
  ["logs", "日志"],
  ["settings", "设置"],
  ["help", "帮助"],
];
const roleNames: Record<string, string> = {
  admin: "管理员",
  editor: "运营",
  viewer: "查看者",
};
/** 窄屏收入「更多」菜单的低频导航项 */
const overflowTabSlugs = new Set(["logs", "help"]);

function tabIsActive(pathname: string, slug: string) {
  return pathname === `/${slug}` || pathname.startsWith(`/${slug}/`);
}
export function AppShell({
  children,
  name,
  role,
  workspaceId,
  workspaces,
  workspaceBadge,
  showTeamNav = false,
  showLogsNav = false,
}: {
  children: React.ReactNode;
  name: string;
  role: string;
  workspaceId: string;
  workspaces: { id: string; name: string }[];
  workspaceBadge: string;
  showTeamNav?: boolean;
  showLogsNav?: boolean;
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const router = useRouter();
  const visibleTabs = tabs
    .filter(([slug]) => slug !== "team" || showTeamNav)
    .filter(([slug]) => slug !== "logs" || (role === "admin" && showLogsNav));
  const primaryTabs = visibleTabs.filter(
    ([slug]) => !overflowTabSlugs.has(slug),
  );
  const overflowTabs = visibleTabs.filter(([slug]) =>
    overflowTabSlugs.has(slug),
  );
  const overflowActive = overflowTabs.some(([slug]) =>
    tabIsActive(pathname, slug),
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到内容
      </a>
      <header className="topbar">
        <Brand />
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{workspaceBadge}</Badge>
          <ThemeToggle />
        </div>
      </header>
      <section className="identity-bar" aria-label="账号与工作区">
        <div className="identity-who">
          <span className="avatar">{name.slice(0, 2)}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{name}</p>
            <span className={`role-pill ${role}`}>{roleNames[role]}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 min-w-0">
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
                  toast.error("工作区切换失败，请重试。");
                }
              })
            }
          >
            <SelectTrigger aria-label="当前工作区" className="workspace-select">
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
          <form
            action={async () => {
              queryClient.clear();
              await signOut();
            }}
          >
            <Button variant="ghost" size="icon" aria-label="退出当前账号">
              <LogOut size={16} />
            </Button>
          </form>
        </div>
      </section>
      <div className="tabs-scroll-wrap">
        <nav className="tabs" aria-label="邮局导航">
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
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={`tabs-more tab${overflowActive ? " active" : ""}`}
                  aria-label="更多导航"
                >
                  更多
                  <ChevronDown size={14} aria-hidden />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                >
                  {overflowTabs.map(([slug, label]) => (
                    <DropdownMenu.Item key={slug} asChild>
                      <Link
                        href={`/${slug}`}
                        className="flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
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
      <main id="main-content" className="view" key={workspaceId}>
        {children}
      </main>
      <footer className="app-footer">卖家邮局 · 独立站与外贸邮件营销</footer>
    </div>
  );
}
