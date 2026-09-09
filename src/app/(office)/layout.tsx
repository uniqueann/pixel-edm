import { getContext } from "@/lib/workspace";
import { AppShell } from "@/components/app-shell";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { member, workspace, workspaces, role } = await getContext();
  return (
    <AppShell
      name={member.display_name}
      role={role}
      workspaceId={workspace.id}
      workspaces={workspaces}
      type={workspace.type}
    >
      {children}
    </AppShell>
  );
}
