import { MailOpen } from "lucide-react";
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="empty">
      <span className="empty-icon">
        <MailOpen size={26} strokeWidth={1.3} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}
