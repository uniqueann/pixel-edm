"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { Brand } from "./brand";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
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
];
const roleNames: Record<string, string> = {
  admin: "管理员",
  editor: "运营",
  viewer: "查看者",
};
export function AppShell({
  children,
  name,
  role,
  workspaceId,
  workspaces,
  type,
}: {
  children: React.ReactNode;
  name: string;
  role: string;
  workspaceId: string;
  workspaces: { id: string; name: string }[];
  type: string;
}) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const router = useRouter();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到内容
      </a>
      <header className="topbar">
        <Brand />
        <Badge variant="secondary">
          {type === "team" ? "团队工作区" : "个人工作区"}
        </Badge>
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
      <nav className="tabs" aria-label="邮局导航">
        {tabs
          .filter(([slug]) => slug !== "logs" || role === "admin")
          .map(([slug, label]) => (
            <Link
              key={slug}
              href={`/${slug}`}
              aria-current={pathname === `/${slug}` ? "page" : undefined}
              className={pathname === `/${slug}` ? "tab active" : "tab"}
            >
              {label}
            </Link>
          ))}
      </nav>
      <main id="main-content" className="view" key={workspaceId}>
        {children}
      </main>
      <footer className="app-footer">
        卖家邮局 · 好的联络，从用心准备开始
      </footer>
    </div>
  );
}
