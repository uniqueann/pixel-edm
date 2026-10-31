import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 同级页面共享标题、数量、说明与主要操作；专用流程可保留自己的布局。 */
export function PageHeader({
  title,
  meta,
  description,
  actions,
  className,
}: {
  title: string;
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("page-header", className)}>
      <div className="page-header-heading">
        <div className="page-title-line">
          <h1>{title}</h1>
          {meta && <div className="page-meta">{meta}</div>}
        </div>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
