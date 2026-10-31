import type { ComponentProps } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const icons = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
  error: CircleAlert,
};

/** 持久提示只负责视觉语义；是否即时播报由调用方按现有反馈职责决定。 */
export function Notice({
  tone = "info",
  className,
  children,
  ...props
}: ComponentProps<"div"> & {
  tone?: keyof typeof icons;
}) {
  const Icon = icons[tone];
  return (
    <div className={cn("notice", className)} data-tone={tone} {...props}>
      <Icon size={18} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
