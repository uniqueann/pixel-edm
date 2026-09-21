import { notFound } from "next/navigation";
import { getContext } from "@/lib/workspace";
import { listActivityLogs } from "@/features/audit/actions";
import { ActivityLogs } from "@/features/audit/activity-logs";
import { EmptyState } from "@/components/empty-state";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";

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
  const plan = await getWorkspaceDeliveryPlan(context.workspace.id);
  if (!plan || plan.activity_log_retention_days === 0) {
    return (
      <EmptyState
        title="当前套餐不含操作日志"
        description="个人专业版可查看近 7 天日志，团队版可查看完整历史。请在设置页升级。"
      />
    );
  }
  const data = await listActivityLogs(filters);
  return <ActivityLogs data={data} filters={filters} />;
}
