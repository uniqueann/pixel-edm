export const teamRoles = ["admin", "editor", "viewer"] as const;
export type TeamRole = (typeof teamRoles)[number];

export type TeamMember = {
  user_id: string;
  display_name: string;
  email: string;
  role: TeamRole;
  status: "active" | "removed";
  joined_at: string;
  updated_at: string;
  version: number;
  is_owner: boolean;
};

export type TeamInvitation = {
  id: string;
  email_hint: string;
  role: TeamRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  created_at: string;
  version: number;
};

export type TeamData = {
  workspace: {
    id: string;
    name: string;
    type: "personal" | "team";
    owner_id: string;
  };
  members: TeamMember[];
  invitations: TeamInvitation[];
};

export type InvitationPreview = {
  status: "pending" | "accepted" | "revoked" | "expired" | "invalid";
  workspace_id?: string;
  workspace_name?: string;
  email_hint?: string;
  role?: TeamRole;
  expires_at?: string;
};

export const roleNames: Record<TeamRole, string> = {
  admin: "管理员",
  editor: "运营",
  viewer: "查看者",
};
