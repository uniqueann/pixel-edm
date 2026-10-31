import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { listActivityLogs } from "@/features/audit/actions";
import { ActivityLogs } from "@/features/audit/activity-logs";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";
import { getContext } from "@/lib/workspace";

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
        kind="restricted"
        title="当前套餐不含操作日志"
        description="个人专业版可查看近 7 天日志，团队版可查看完整历史。请在设置页升级。"
      >
        <Button asChild variant="outline">
          <Link href="/settings">查看套餐详情</Link>
        </Button>
      </EmptyState>
    );
  }
  const data = await listActivityLogs(filters);
  return <ActivityLogs data={data} filters={filters} />;
}
