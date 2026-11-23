"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { DropdownMenu } from "radix-ui";
import { Check, Languages } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setUserLocale } from "@/i18n/actions";
import { isAppLocale, type AppLocale } from "@/i18n/config";

const LOCALE_OPTIONS: readonly { value: AppLocale; labelKey: "zhCN" | "en" }[] =
  [
    { value: "zh-CN", labelKey: "zhCN" },
    { value: "en", labelKey: "en" },
  ];

function useLocaleSwitch() {
  const router = useRouter();
  const rawLocale = useLocale();
  const currentLocale: AppLocale = isAppLocale(rawLocale) ? rawLocale : "zh-CN";
  const t = useTranslations("common.language");
  const [pending, startTransition] = useTransition();

  function selectLocale(next: AppLocale) {
    if (next === currentLocale || pending) return;
    startTransition(async () => {
      try {
        const result = await setUserLocale(next);
        if (!result.ok) {
          toast.error(t("saveFailed"));
          return;
        }
        router.refresh();
      } catch {
        toast.error(t("saveFailed"));
      }
    });
  }

  return { currentLocale, pending, selectLocale, t };
}

/** 顶栏与公开页紧凑语言切换菜单（尺寸与 ThemeToggle 对齐，不挤占导航空间）。 */
export function LocaleToggle({ className }: { className?: string }) {
  const { currentLocale, pending, selectLocale, t } = useLocaleSwitch();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={pending}
          aria-label={t("switchAriaLabel")}
          className={`size-8 rounded-lg text-muted-foreground hover:text-foreground ${className ?? ""}`}
        >
          <Languages className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-32 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          {LOCALE_OPTIONS.map(({ value, labelKey }) => {
            const isSelected = currentLocale === value;
            return (
              <DropdownMenu.Item
                key={value}
                onSelect={() => selectLocale(value)}
                className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-xs outline-none select-none transition-colors hover:bg-accent hover:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <span>{t(labelKey)}</span>
                {isSelected && (
                  <Check className="size-3.5 text-primary" aria-hidden="true" />
                )}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** 设置页「界面外观」卡使用的语言分段单选器。 */
export function LocaleSegmented() {
  const { currentLocale, pending, selectLocale, t } = useLocaleSwitch();

  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-label={t("label")}
    >
      {LOCALE_OPTIONS.map(({ value, labelKey }) => {
        const isSelected = currentLocale === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={pending}
            onClick={() => selectLocale(value)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
              isSelected
                ? "border-primary bg-primary text-primary-foreground shadow-xs"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <Languages className="size-4" aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
