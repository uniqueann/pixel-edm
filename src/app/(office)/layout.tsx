import { getContext } from "@/lib/workspace";
import { AppShell } from "@/components/app-shell";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { member, workspace, workspaces, role } = await getContext();
  const deliveryPlan = await getWorkspaceDeliveryPlan(workspace.id);
  const showLogsNav =
    deliveryPlan !== null && deliveryPlan.activity_log_retention_days !== 0;
  const showTeamNav = deliveryPlan?.allows_team_collaboration ?? false;
  return (
    <AppShell
      name={member.display_name}
      role={role}
      workspaceId={workspace.id}
      workspaces={workspaces}
      type={workspace.type}
      showTeamNav={showTeamNav}
      showLogsNav={showLogsNav}
    >
      {children}
    </AppShell>
  );
}
