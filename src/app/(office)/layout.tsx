import { getTranslations } from "next-intl/server";
import { getContext } from "@/lib/workspace";
import { AppShell } from "@/components/app-shell";
import { getWorkspaceDeliveryPlan } from "@/features/workspace/delivery-plan";
import { preparationWritePermission } from "@/features/onboarding/model";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ member, workspace, workspaces, role, user }, t] = await Promise.all([
    getContext(),
    getTranslations("shell"),
  ]);
  const deliveryPlan = await getWorkspaceDeliveryPlan(workspace.id);
  const showLogsNav =
    deliveryPlan !== null && deliveryPlan.activity_log_retention_days !== 0;
  const showTeamNav = deliveryPlan?.allows_team_collaboration ?? false;

  const planKey = deliveryPlan?.plan;
  const localizedPlan =
    planKey === "free" || planKey === "pro" || planKey === "team"
      ? t(`workspaceBadge.plan.${planKey}`)
      : (deliveryPlan?.plan_display_name ?? planKey ?? "");
  const workspaceBadge = !deliveryPlan
    ? workspace.type === "team"
      ? t("workspaceBadge.team")
      : t("workspaceBadge.personal")
    : deliveryPlan.allows_team_collaboration
      ? t("workspaceBadge.teamMembers", {
          plan: localizedPlan,
          count: deliveryPlan.active_members,
        })
      : localizedPlan;

  return (
    <AppShell
      name={member.display_name}
      role={role}
      workspaceId={workspace.id}
      userId={user.id}
      canWrite={preparationWritePermission(role, deliveryPlan)}
      workspaces={workspaces}
      workspaceBadge={workspaceBadge}
      showTeamNav={showTeamNav}
      showLogsNav={showLogsNav}
    >
      {children}
    </AppShell>
  );
}
