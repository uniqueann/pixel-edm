"use client";

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";

export function Brand({ label }: { label?: string }) {
  const t = useTranslations("shell");
  return (
    <div className="brand">
      <span className="brand-mark">
        <Mail size={17} aria-hidden />
      </span>
      <span>{label ?? t("brand")}</span>
    </div>
  );
}
