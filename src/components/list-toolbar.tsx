import type { ComponentProps, ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** 搜索与筛选共用表面和字段节奏，字段数量及分列由具体任务决定。 */
export function ListToolbar({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("list-toolbar", className)} {...props} />;
}

export function FilterField({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("filter-field", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
