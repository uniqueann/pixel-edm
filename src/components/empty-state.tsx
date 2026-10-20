import { MailOpen } from "lucide-react";
import type { ReactNode } from "react";
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="empty">
      <span className="empty-icon">
        <MailOpen size={26} strokeWidth={1.3} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}
