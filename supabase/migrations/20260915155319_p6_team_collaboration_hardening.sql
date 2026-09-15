-- P6 团队邀请表加固：明确拒绝直读，并补齐成员外键索引。
-- 表权限仍保持撤销，应用只通过 edm 受控 RPC 访问。

create policy workspace_invitations_no_direct_access
  on edm.workspace_invitations for all to authenticated
  using (false)
  with check (false);

create index workspace_invitations_invited_by_idx
  on edm.workspace_invitations(invited_by,created_at desc);
create index workspace_invitations_accepted_by_idx
  on edm.workspace_invitations(accepted_by,accepted_at desc)
  where accepted_by is not null;
create index workspace_invitations_revoked_by_idx
  on edm.workspace_invitations(revoked_by,revoked_at desc)
  where revoked_by is not null;
