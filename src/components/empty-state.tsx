import { MailOpen, Search, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
export function EmptyState({
  title,
  description,
  children,
  kind = "empty",
}: {
  title: string;
  description: string;
  children?: ReactNode;
  kind?: "empty" | "search" | "restricted";
}) {
  const Icon =
    kind === "search" ? Search : kind === "restricted" ? LockKeyhole : MailOpen;
  return (
    <section className="empty">
      <span className="empty-icon">
        <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}
