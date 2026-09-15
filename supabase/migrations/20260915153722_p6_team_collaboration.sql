-- P6-0 团队协作：邀请、成员角色、所有权转移与一致性边界。
-- 仅修改 edm / edm_private，不触碰共享 Auth、aigc 或既有全局触发器。

alter table edm.workspace_members
  add column removed_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add column version integer not null default 1 check (version > 0);

create trigger workspace_members_updated before update on edm.workspace_members
  for each row execute function edm_private.touch_updated_at();

create table edm.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references edm.workspaces(id),
  email_normalized text not null
    check (email_normalized = lower(btrim(email_normalized))
      and char_length(email_normalized) between 3 and 254
      and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null check (role in ('admin','editor','viewer')),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null check (char_length(token_hint) between 4 and 8),
  status text not null default 'pending'
    check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null,
  invited_by uuid not null references edm.members(user_id),
  accepted_by uuid references edm.members(user_id),
  accepted_at timestamptz,
  revoked_by uuid references edm.members(user_id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique(token_hash)
);
create unique index workspace_invitations_pending_email_idx
  on edm.workspace_invitations(workspace_id,email_normalized)
  where status='pending';
create index workspace_invitations_workspace_status_idx
  on edm.workspace_invitations(workspace_id,status,expires_at);
create index workspace_invitations_email_idx
  on edm.workspace_invitations(workspace_id,email_normalized,created_at desc);
create trigger workspace_invitations_updated before update on edm.workspace_invitations
  for each row execute function edm_private.touch_updated_at();

alter table edm.workspace_invitations enable row level security;

create function edm_private.mask_invitation_email(value text) returns text
language sql immutable set search_path='' as $$
  select left(value,1)||'***@'||split_part(value,'@',2);
$$;

create function edm_private.expire_workspace_invitations(ws uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare
  invitation_row record;
  expired_count integer := 0;
begin
  for invitation_row in
    select id,email_normalized,version
    from edm.workspace_invitations
    where workspace_id=ws and status='pending' and expires_at<=clock_timestamp()
    for update
  loop
    update edm.workspace_invitations
    set status='expired',version=version+1,updated_at=clock_timestamp()
    where id=invitation_row.id and status='pending';
    if found then
      perform edm_private.log_activity(
        ws,'team.invitation_expired','invitation',invitation_row.id,
        edm_private.mask_invitation_email(invitation_row.email_normalized),
        jsonb_build_object('status','expired'),
        'team.invitation_expired:'||invitation_row.id::text||':'||(invitation_row.version+1)::text,
        true
      );
      expired_count := expired_count + 1;
    end if;
  end loop;
  return expired_count;
end;
$$;

create function edm_private.create_workspace_invitation(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  ws uuid := (payload->>'workspace_id')::uuid;
  email_value text := lower(btrim(coalesce(payload->>'email','')));
  invitation_role text := coalesce(payload->>'role','');
  token_hash_value text := coalesce(payload->>'token_hash','');
  token_hint_value text := coalesce(payload->>'token_hint','');
  workspace_row edm.workspaces;
  invitation_row edm.workspace_invitations;
  existing_id uuid;
  active_member boolean;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  if ws is null then raise exception '工作区无效'; end if;
  if invitation_role not in ('admin','editor','viewer') then raise exception '成员角色无效'; end if;
  if email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(email_value)>254 then raise exception '邮箱格式无效'; end if;
  if token_hash_value !~ '^[0-9a-f]{64}$' then raise exception '邀请令牌无效'; end if;
  if char_length(token_hint_value) not between 4 and 8 then raise exception '邀请令牌无效'; end if;

  select * into workspace_row from edm.workspaces where id=ws for update;
  if not found then raise exception '工作区不存在'; end if;
  if edm_private.workspace_role(ws)<>'admin' then
    raise exception '只有管理员可以管理团队' using errcode='42501';
  end if;

  select exists(
    select 1
    from edm.workspace_members wm
    join auth.users au on au.id=wm.user_id
    join edm.members em on em.user_id=wm.user_id
    where wm.workspace_id=ws and wm.status='active' and em.status='active'
      and lower(btrim(au.email))=email_value
  ) into active_member;
  if active_member then raise exception '该邮箱已是工作区成员'; end if;

  select id into existing_id
  from edm.workspace_invitations
  where workspace_id=ws and email_normalized=email_value and status='pending'
  for update;
  if existing_id is not null then
    if exists(select 1 from edm.workspace_invitations where id=existing_id and expires_at<=clock_timestamp()) then
      perform edm_private.expire_workspace_invitations(ws);
    else
      raise exception '该邮箱已有待处理邀请，请选择重新生成邀请链接';
    end if;
  end if;

  insert into edm.workspace_invitations(
    workspace_id,email_normalized,role,token_hash,token_hint,expires_at,invited_by
  ) values (
    ws,email_value,invitation_role,token_hash_value,token_hint_value,
    clock_timestamp()+interval '7 days',uid
  ) returning * into invitation_row;

  if workspace_row.type='personal' then
    update edm.workspaces set type='team',updated_at=clock_timestamp() where id=ws;
    perform edm_private.log_activity(
      ws,'workspace.converted_to_team','workspace',ws,workspace_row.name,
      jsonb_build_object('from_type','personal','to_type','team'),
      'workspace.converted_to_team:'||ws::text
    );
  end if;

  perform edm_private.log_activity(
    ws,'team.invitation_created','invitation',invitation_row.id,
    edm_private.mask_invitation_email(email_value),
    jsonb_build_object('role',invitation_role,'expires_at',invitation_row.expires_at),
    'team.invitation_created:'||invitation_row.id::text
  );
  return jsonb_build_object(
    'id',invitation_row.id,'workspace_id',ws,'email',email_value,
    'email_hint',edm_private.mask_invitation_email(email_value),
    'role',invitation_role,'status',invitation_row.status,
    'expires_at',invitation_row.expires_at,'version',invitation_row.version
  );
end;
$$;

create function edm_private.resend_workspace_invitation(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  invitation_id uuid := (payload->>'id')::uuid;
  requested_workspace uuid := (payload->>'workspace_id')::uuid;
  token_hash_value text := coalesce(payload->>'token_hash','');
  token_hint_value text := coalesce(payload->>'token_hint','');
  invitation_row edm.workspace_invitations;
  workspace_row edm.workspaces;
  new_invitation edm.workspace_invitations;
  active_member boolean;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  if token_hash_value !~ '^[0-9a-f]{64}$' or char_length(token_hint_value) not between 4 and 8 then
    raise exception '邀请令牌无效';
  end if;
  select * into invitation_row from edm.workspace_invitations where id=invitation_id for update;
  if not found or (requested_workspace is not null and invitation_row.workspace_id<>requested_workspace) then
    raise exception '邀请不存在或不可访问';
  end if;
  select * into workspace_row from edm.workspaces where id=invitation_row.workspace_id for update;
  if edm_private.workspace_role(invitation_row.workspace_id)<>'admin' then
    raise exception '只有管理员可以管理团队' using errcode='42501';
  end if;
  if invitation_row.status not in ('pending','expired') then raise exception '该邀请已无法重发'; end if;
  select exists(
    select 1
    from edm.workspace_members wm
    join auth.users au on au.id=wm.user_id
    join edm.members em on em.user_id=wm.user_id
    where wm.workspace_id=invitation_row.workspace_id and wm.status='active' and em.status='active'
      and lower(btrim(au.email))=invitation_row.email_normalized
  ) into active_member;
  if active_member then raise exception '该邮箱已是工作区成员'; end if;

  if invitation_row.status='expired' or invitation_row.expires_at<=clock_timestamp() then
    if invitation_row.status='pending' then
      update edm.workspace_invitations set status='expired',version=version+1,updated_at=clock_timestamp()
      where id=invitation_id;
      perform edm_private.log_activity(
        invitation_row.workspace_id,'team.invitation_expired','invitation',invitation_id,
        edm_private.mask_invitation_email(invitation_row.email_normalized),
        jsonb_build_object('status','expired'),
        'team.invitation_expired:'||invitation_id::text||':'||(invitation_row.version+1)::text,true
      );
    end if;
    insert into edm.workspace_invitations(
      workspace_id,email_normalized,role,token_hash,token_hint,expires_at,invited_by
    ) values (
      invitation_row.workspace_id,invitation_row.email_normalized,invitation_row.role,
      token_hash_value,token_hint_value,clock_timestamp()+interval '7 days',uid
    ) returning * into new_invitation;
  else
    update edm.workspace_invitations
    set token_hash=token_hash_value,token_hint=token_hint_value,
        expires_at=clock_timestamp()+interval '7 days',invited_by=uid,
        version=version+1,updated_at=clock_timestamp()
    where id=invitation_id
    returning * into new_invitation;
  end if;

  perform edm_private.log_activity(
    new_invitation.workspace_id,'team.invitation_resent','invitation',new_invitation.id,
    edm_private.mask_invitation_email(new_invitation.email_normalized),
    jsonb_build_object('role',new_invitation.role,'expires_at',new_invitation.expires_at),
    'team.invitation_resent:'||new_invitation.id::text||':'||new_invitation.version::text
  );
  return jsonb_build_object(
    'id',new_invitation.id,'workspace_id',new_invitation.workspace_id,
    'email_hint',edm_private.mask_invitation_email(new_invitation.email_normalized),
    'role',new_invitation.role,'status',new_invitation.status,
    'expires_at',new_invitation.expires_at,'version',new_invitation.version
  );
end;
$$;

create function edm_private.revoke_workspace_invitation(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  invitation_id uuid := (payload->>'id')::uuid;
  requested_workspace uuid := (payload->>'workspace_id')::uuid;
  invitation_row edm.workspace_invitations;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  select * into invitation_row from edm.workspace_invitations where id=invitation_id for update;
  if not found or (requested_workspace is not null and invitation_row.workspace_id<>requested_workspace) then
    raise exception '邀请不存在或不可访问';
  end if;
  perform 1 from edm.workspaces where id=invitation_row.workspace_id for update;
  if edm_private.workspace_role(invitation_row.workspace_id)<>'admin' then
    raise exception '只有管理员可以管理团队' using errcode='42501';
  end if;
  if invitation_row.status='pending' and invitation_row.expires_at<=clock_timestamp() then
    perform edm_private.expire_workspace_invitations(invitation_row.workspace_id);
    return jsonb_build_object('id',invitation_id,'status','expired');
  end if;
  if invitation_row.status<>'pending' then raise exception '该邀请已无法撤销'; end if;
  update edm.workspace_invitations
  set status='revoked',revoked_by=uid,revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
  where id=invitation_id returning * into invitation_row;
  perform edm_private.log_activity(
    invitation_row.workspace_id,'team.invitation_revoked','invitation',invitation_id,
    edm_private.mask_invitation_email(invitation_row.email_normalized),
    jsonb_build_object('status','revoked'),
    'team.invitation_revoked:'||invitation_id::text||':'||invitation_row.version::text
  );
  return jsonb_build_object('id',invitation_id,'status','revoked','version',invitation_row.version);
end;
$$;

create function edm_private.accept_workspace_invitation(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  token_hash_value text := coalesce(payload->>'token_hash','');
  invitation_row edm.workspace_invitations;
  workspace_row edm.workspaces;
  member_row edm.workspace_members;
  auth_email text;
  confirmed_at timestamptz;
  member_status text;
begin
  if uid is null then raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501'; end if;
  if token_hash_value !~ '^[0-9a-f]{64}$' then
    raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501';
  end if;
  select * into invitation_row from edm.workspace_invitations where token_hash=token_hash_value;
  if not found then raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501'; end if;
  select * into workspace_row from edm.workspaces where id=invitation_row.workspace_id for update;
  select * into invitation_row from edm.workspace_invitations where id=invitation_row.id for update;
  if invitation_row.status='pending' and invitation_row.expires_at<=clock_timestamp() then
    perform edm_private.expire_workspace_invitations(invitation_row.workspace_id);
    return jsonb_build_object('status','expired');
  end if;
  if invitation_row.status<>'pending' then
    raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501';
  end if;

  select email,email_confirmed_at into auth_email,confirmed_at from auth.users where id=uid;
  if auth_email is null or confirmed_at is null or lower(btrim(auth_email))<>invitation_row.email_normalized then
    raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501';
  end if;
  insert into edm.members(user_id,status) values(uid,'active') on conflict(user_id) do nothing;
  select status into member_status from edm.members where user_id=uid for update;
  if member_status<>'active' then
    raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501';
  end if;

  select * into member_row from edm.workspace_members
  where workspace_id=invitation_row.workspace_id and user_id=uid for update;
  if found and member_row.status='active' then
    update edm.workspace_invitations
    set status='accepted',accepted_by=uid,accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where id=invitation_row.id returning * into invitation_row;
  elsif found then
    update edm.workspace_members
    set role=invitation_row.role,status='active',removed_at=null,joined_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where workspace_id=invitation_row.workspace_id and user_id=uid;
    update edm.workspace_invitations
    set status='accepted',accepted_by=uid,accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where id=invitation_row.id returning * into invitation_row;
  else
    insert into edm.workspace_members(workspace_id,user_id,role,status,joined_at)
    values(invitation_row.workspace_id,uid,invitation_row.role,'active',clock_timestamp());
    update edm.workspace_invitations
    set status='accepted',accepted_by=uid,accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where id=invitation_row.id returning * into invitation_row;
  end if;

  perform edm_private.log_activity(
    invitation_row.workspace_id,'team.invitation_accepted','invitation',invitation_row.id,
    edm_private.mask_invitation_email(invitation_row.email_normalized),
    jsonb_build_object('role',invitation_row.role),
    'team.invitation_accepted:'||invitation_row.id::text
  );
  return jsonb_build_object(
    'workspace_id',invitation_row.workspace_id,'invitation_id',invitation_row.id,
    'role',invitation_row.role,'status','accepted','workspace_name',workspace_row.name
  );
end;
$$;

create function edm_private.list_workspace_team(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  ws uuid := (payload->>'workspace_id')::uuid;
  role_name text;
  workspace_row edm.workspaces;
  members_json jsonb;
  invitations_json jsonb;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  select * into workspace_row from edm.workspaces where id=ws for update;
  if not found then raise exception '工作区不存在'; end if;
  role_name := edm_private.workspace_role(ws);
  if role_name is null then raise exception '工作区不可访问' using errcode='42501'; end if;
  perform edm_private.expire_workspace_invitations(ws);
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',wm.user_id,'display_name',em.display_name,'email',au.email,
    'role',wm.role,'status',wm.status,'joined_at',wm.joined_at,
    'updated_at',wm.updated_at,'version',wm.version,'is_owner',(wm.user_id=workspace_row.owner_id)
  ) order by wm.joined_at,wm.user_id),'[]'::jsonb)
  into members_json
  from edm.workspace_members wm
  join edm.members em on em.user_id=wm.user_id
  join auth.users au on au.id=wm.user_id
  where wm.workspace_id=ws and wm.status='active';
  if role_name='admin' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',wi.id,'email_hint',edm_private.mask_invitation_email(wi.email_normalized),
      'role',wi.role,'status',wi.status,'expires_at',wi.expires_at,
      'created_at',wi.created_at,'version',wi.version
    ) order by wi.created_at desc,wi.id desc),'[]'::jsonb)
    into invitations_json
    from edm.workspace_invitations wi
    where wi.workspace_id=ws and wi.status='pending';
  else
    invitations_json := '[]'::jsonb;
  end if;
  return jsonb_build_object(
    'workspace',jsonb_build_object('id',workspace_row.id,'name',workspace_row.name,'type',workspace_row.type,'owner_id',workspace_row.owner_id),
    'members',members_json,'invitations',invitations_json
  );
end;
$$;

create function edm_private.get_workspace_invitation_preview(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  token_hash_value text := coalesce(payload->>'token_hash','');
  invitation_row edm.workspace_invitations;
  workspace_name text;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  select * into invitation_row from edm.workspace_invitations where token_hash=token_hash_value;
  if not found then return jsonb_build_object('status','invalid'); end if;
  if invitation_row.status='pending' and invitation_row.expires_at<=clock_timestamp() then
    perform 1 from edm.workspaces where id=invitation_row.workspace_id for update;
    perform edm_private.expire_workspace_invitations(invitation_row.workspace_id);
    select * into invitation_row from edm.workspace_invitations where id=invitation_row.id;
  end if;
  select name into workspace_name from edm.workspaces where id=invitation_row.workspace_id;
  return jsonb_build_object(
    'status',invitation_row.status,'workspace_id',invitation_row.workspace_id,
    'workspace_name',workspace_name,'email_hint',edm_private.mask_invitation_email(invitation_row.email_normalized),
    'role',invitation_row.role,'expires_at',invitation_row.expires_at
  );
end;
$$;

create function edm_private.change_workspace_member_role(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  ws uuid := (payload->>'workspace_id')::uuid;
  target uuid := (payload->>'user_id')::uuid;
  next_role text := coalesce(payload->>'role','');
  expected_version integer := (payload->>'expected_version')::integer;
  workspace_row edm.workspaces;
  member_row edm.workspace_members;
  admin_count integer;
  target_display_name text;
  old_role text;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  if next_role not in ('admin','editor','viewer') then raise exception '成员角色无效'; end if;
  if expected_version is null or expected_version<=0 then raise exception '成员版本无效'; end if;
  select * into workspace_row from edm.workspaces where id=ws for update;
  if not found or edm_private.workspace_role(ws)<>'admin' then raise exception '只有管理员可以管理团队' using errcode='42501'; end if;
  select * into member_row from edm.workspace_members where workspace_id=ws and user_id=target for update;
  if not found or member_row.status<>'active' then raise exception '成员不存在或已移除'; end if;
  if member_row.user_id=workspace_row.owner_id then raise exception '所有者必须保留管理员身份'; end if;
  if member_row.version<>expected_version then raise exception '成员已被修改，请刷新后重试'; end if;
  if member_row.role=next_role then
    return jsonb_build_object('user_id',target,'role',member_row.role,'version',member_row.version);
  end if;
  if member_row.role='admin' and next_role<>'admin' then
    select count(*) into admin_count from edm.workspace_members where workspace_id=ws and status='active' and role='admin';
    if admin_count<=1 then raise exception '工作区至少保留一名管理员'; end if;
  end if;
  old_role := member_row.role;
  select m.display_name into target_display_name from edm.members m where m.user_id=target;
  update edm.workspace_members set role=next_role,version=version+1,updated_at=clock_timestamp()
  where workspace_id=ws and user_id=target returning * into member_row;
  perform edm_private.log_activity(
    ws,'team.member_role_changed','member',target,coalesce(target_display_name,'工作区成员'),
    jsonb_build_object('old_role',old_role,'new_role',next_role),
    'team.member_role_changed:'||ws::text||':'||target::text||':'||member_row.version::text
  );
  return jsonb_build_object('user_id',target,'role',next_role,'version',member_row.version);
end;
$$;

create function edm_private.remove_workspace_member(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  ws uuid := (payload->>'workspace_id')::uuid;
  target uuid := (payload->>'user_id')::uuid;
  expected_version integer := (payload->>'expected_version')::integer;
  workspace_row edm.workspaces;
  member_row edm.workspace_members;
  admin_count integer;
  target_display_name text;
  invitation_row record;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  if expected_version is null or expected_version<=0 then raise exception '成员版本无效'; end if;
  select * into workspace_row from edm.workspaces where id=ws for update;
  if not found or edm_private.workspace_role(ws)<>'admin' then raise exception '只有管理员可以管理团队' using errcode='42501'; end if;
  select * into member_row from edm.workspace_members where workspace_id=ws and user_id=target for update;
  if not found or member_row.status<>'active' then raise exception '成员不存在或已移除'; end if;
  if target=workspace_row.owner_id then raise exception '不能移除工作区所有者'; end if;
  if member_row.version<>expected_version then raise exception '成员已被修改，请刷新后重试'; end if;
  if member_row.role='admin' then
    select count(*) into admin_count from edm.workspace_members where workspace_id=ws and status='active' and role='admin';
    if admin_count<=1 then raise exception '工作区至少保留一名管理员'; end if;
  end if;
  select m.display_name into target_display_name from edm.members m where m.user_id=target;
  perform edm_private.expire_workspace_invitations(ws);
  update edm.workspace_members
  set status='removed',removed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
  where workspace_id=ws and user_id=target returning * into member_row;
  for invitation_row in
    select wi.id,wi.email_normalized,wi.version
    from edm.workspace_invitations wi
    join auth.users au on lower(btrim(au.email))=wi.email_normalized and au.id=target
    where wi.workspace_id=ws and wi.status='pending'
    for update
  loop
    update edm.workspace_invitations
    set status='revoked',revoked_by=uid,revoked_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where id=invitation_row.id;
    perform edm_private.log_activity(
      ws,'team.invitation_revoked','invitation',invitation_row.id,
      edm_private.mask_invitation_email(invitation_row.email_normalized),
      jsonb_build_object('reason','member_removed'),
      'team.invitation_revoked:'||invitation_row.id::text||':'||(invitation_row.version+1)::text
    );
  end loop;
  perform edm_private.log_activity(
    ws,'team.member_removed','member',target,coalesce(target_display_name,'工作区成员'),
    jsonb_build_object('status','removed'),
    'team.member_removed:'||ws::text||':'||target::text||':'||member_row.version::text
  );
  return jsonb_build_object('user_id',target,'status','removed','version',member_row.version);
end;
$$;

create function edm_private.transfer_workspace_ownership(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  ws uuid := (payload->>'workspace_id')::uuid;
  target uuid := (payload->>'new_owner_id')::uuid;
  workspace_row edm.workspaces;
  target_member edm.workspace_members;
  target_name text;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  select * into workspace_row from edm.workspaces where id=ws for update;
  if not found then raise exception '工作区不存在'; end if;
  if workspace_row.owner_id<>uid then raise exception '只有当前所有者可以转移所有权' using errcode='42501'; end if;
  if target=uid then raise exception '新的所有者必须是其他管理员'; end if;
  select * into target_member from edm.workspace_members where workspace_id=ws and user_id=target for update;
  if not found or target_member.status<>'active' or target_member.role<>'admin' then
    raise exception '新的所有者必须是工作区中的有效管理员';
  end if;
  update edm.workspaces set owner_id=target,updated_at=clock_timestamp() where id=ws;
  select m.display_name into target_name from edm.members m where m.user_id=target;
  perform edm_private.log_activity(
    ws,'team.owner_transferred','member',target,coalesce(target_name,'工作区成员'),
    jsonb_build_object('old_owner_id',uid,'new_owner_id',target),
    'team.owner_transferred:'||ws::text||':'||target::text
  );
  return jsonb_build_object('workspace_id',ws,'owner_id',target);
end;
$$;

create function edm.create_workspace_invitation(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.create_workspace_invitation($1); $$;
create function edm.resend_workspace_invitation(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.resend_workspace_invitation($1); $$;
create function edm.revoke_workspace_invitation(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.revoke_workspace_invitation($1); $$;
create function edm.accept_workspace_invitation(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.accept_workspace_invitation($1); $$;
create function edm.list_workspace_team(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.list_workspace_team($1); $$;
create function edm.get_workspace_invitation_preview(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.get_workspace_invitation_preview($1); $$;
create function edm.change_workspace_member_role(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.change_workspace_member_role($1); $$;
create function edm.remove_workspace_member(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.remove_workspace_member($1); $$;
create function edm.transfer_workspace_ownership(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.transfer_workspace_ownership($1); $$;

revoke all on edm.workspace_invitations from public,anon,authenticated;
revoke all on function edm.create_workspace_invitation(jsonb),edm.resend_workspace_invitation(jsonb),
  edm.revoke_workspace_invitation(jsonb),edm.accept_workspace_invitation(jsonb),
  edm.list_workspace_team(jsonb),edm.get_workspace_invitation_preview(jsonb),
  edm.change_workspace_member_role(jsonb),edm.remove_workspace_member(jsonb),
  edm.transfer_workspace_ownership(jsonb) from public,anon,authenticated;
grant execute on function edm.create_workspace_invitation(jsonb),edm.resend_workspace_invitation(jsonb),
  edm.revoke_workspace_invitation(jsonb),edm.accept_workspace_invitation(jsonb),
  edm.list_workspace_team(jsonb),edm.get_workspace_invitation_preview(jsonb),
  edm.change_workspace_member_role(jsonb),edm.remove_workspace_member(jsonb),
  edm.transfer_workspace_ownership(jsonb),
  edm_private.create_workspace_invitation(jsonb),edm_private.resend_workspace_invitation(jsonb),
  edm_private.revoke_workspace_invitation(jsonb),edm_private.accept_workspace_invitation(jsonb),
  edm_private.list_workspace_team(jsonb),edm_private.get_workspace_invitation_preview(jsonb),
  edm_private.change_workspace_member_role(jsonb),edm_private.remove_workspace_member(jsonb),
  edm_private.transfer_workspace_ownership(jsonb) to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.workspace_invitations from aigc_api;
  end if;
end $$;
