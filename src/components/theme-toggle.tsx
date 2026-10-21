"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { DropdownMenu } from "radix-ui";
import { Sun, Moon, Laptop, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const themes = [
  { value: "light", label: "浅色模式", icon: Sun },
  { value: "dark", label: "深色模式", icon: Moon },
  { value: "system", label: "跟随系统", icon: Laptop },
] as const;

const emptySubscribe = () => () => {};

function useIsMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * 顶栏与公共页快捷主题切换下拉菜单
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useIsMounted();

  // 未挂载时展示占位，避免服务端水合闪烁
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="切换主题"
        className={`size-8 rounded-lg text-muted-foreground ${className ?? ""}`}
        disabled
      >
        <Sun className="size-4 opacity-50" />
      </Button>
    );
  }

  // 计算当前显示的图标
  const ActiveIcon =
    theme === "system" ? Laptop : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="切换主题"
          className={`size-8 rounded-lg text-muted-foreground hover:text-foreground ${className ?? ""}`}
        >
          <ActiveIcon className="size-4" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-36 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          {themes.map(({ value, label, icon: Icon }) => {
            const isSelected = theme === value;
            return (
              <DropdownMenu.Item
                key={value}
                onSelect={() => setTheme(value)}
                className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs outline-none select-none transition-colors hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                </span>
                {isSelected && <Check className="size-3.5 text-primary" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * 设置页使用的三段式胶囊分段单选器 (Segmented Control)
 */
export function ThemeSegmented() {
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();

  return (
    <div className="flex flex-wrap gap-2">
      {themes.map(({ value, label, icon: Icon }) => {
        const isSelected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
              isSelected
                ? "border-primary bg-primary text-primary-foreground shadow-xs"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <Icon className="size-4" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
