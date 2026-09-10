import { notFound } from "next/navigation";
import { getContext } from "@/lib/workspace";
import { listActivityLogs } from "@/features/audit/actions";
import { ActivityLogs } from "@/features/audit/activity-logs";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const context = await getContext();
  if (context.role !== "admin") notFound();
  const data = await listActivityLogs(filters);
  return <ActivityLogs data={data} filters={filters} />;
}
