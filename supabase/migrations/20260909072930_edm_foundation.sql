-- 仅创建 EDM 对象，不修改共享认证触发器及 AIGC 对象。
create schema edm;
create schema edm_private;
revoke all on schema edm, edm_private from public;
grant usage on schema edm, edm_private to authenticated;
alter default privileges in schema edm revoke execute on functions from public;
alter default privileges in schema edm_private revoke execute on functions from public;

create table edm.members (
  user_id uuid primary key references auth.users(id),
  status text not null default 'active' check (status in ('active','disabled')),
  display_name text not null default '店主' check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table edm.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default '我的邮局' check (char_length(btrim(name)) between 1 and 80),
  type text not null default 'personal' check (type in ('personal','team')),
  plan text not null default 'free' check (plan in ('free','pro','team')),
  owner_id uuid not null references edm.members(user_id),
  bootstrap_owner_id uuid unique references edm.members(user_id),
  mailing_address text not null default '' check (char_length(mailing_address) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table edm.workspace_members (
  workspace_id uuid not null references edm.workspaces(id),
  user_id uuid not null references edm.members(user_id),
  role text not null check (role in ('admin','editor','viewer')),
  status text not null default 'active' check (status in ('active','removed')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create index workspace_members_user_idx on edm.workspace_members(user_id,workspace_id);
create index workspaces_owner_idx on edm.workspaces(owner_id);
alter table edm.members enable row level security;
alter table edm.workspaces enable row level security;
alter table edm.workspace_members enable row level security;

create function edm_private.workspace_role(ws_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select wm.role from edm.workspace_members wm
  join edm.members m on m.user_id=wm.user_id
  where wm.workspace_id=ws_id and wm.user_id=auth.uid()
    and wm.status='active' and m.status='active';
$$;
create policy member_self on edm.members for select to authenticated
  using (user_id=(select auth.uid()));
create policy member_update_self on edm.members for update to authenticated
  using (user_id=(select auth.uid()) and status='active')
  with check (user_id=(select auth.uid()) and status='active');
create policy workspace_read on edm.workspaces for select to authenticated
  using (edm_private.workspace_role(id) is not null);
create policy workspace_update on edm.workspaces for update to authenticated
  using (edm_private.workspace_role(id)='admin')
  with check (edm_private.workspace_role(id)='admin');
create policy workspace_members_read on edm.workspace_members for select to authenticated
  using (edm_private.workspace_role(workspace_id) is not null);

create function edm_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at=now(); return new; end;
$$;
create trigger members_updated before update on edm.members
  for each row execute function edm_private.touch_updated_at();
create trigger workspaces_updated before update on edm.workspaces
  for each row execute function edm_private.touch_updated_at();

-- 同工作区成员变更先取得行锁，事务结束时核验管理员约束。
create function edm_private.lock_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.workspace_id<>old.workspace_id or new.user_id<>old.user_id) then
    raise exception '成员关系标识不可修改' using errcode='23514';
  end if;
  perform 1 from edm.workspaces where id=case when tg_op='DELETE' then old.workspace_id else new.workspace_id end for update;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger lock_workspace_member before insert or update or delete on edm.workspace_members
  for each row execute function edm_private.lock_workspace();
create function edm_private.check_owner_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  if tg_table_name='workspaces' then ws=new.id;
  elsif tg_op='DELETE' then ws=old.workspace_id;
  else ws=new.workspace_id; end if;
  if exists(select 1 from edm.workspaces w where w.id=ws and not exists (
    select 1 from edm.workspace_members m where m.workspace_id=w.id and m.user_id=w.owner_id
      and m.role='admin' and m.status='active'
  )) then raise exception '所有者必须保留有效管理员身份' using errcode='23514'; end if;
  return null;
end;
$$;
create constraint trigger owner_is_admin after insert or update on edm.workspaces
  deferrable initially deferred for each row execute function edm_private.check_owner_admin();
create constraint trigger retain_owner_admin after insert or update or delete on edm.workspace_members
  deferrable initially deferred for each row execute function edm_private.check_owner_admin();

create function edm_private.initialize_member() returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); ws uuid; member_status text;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('edm:init:'||uid::text,0));
  insert into edm.members(user_id) values(uid) on conflict(user_id) do nothing;
  select status into member_status from edm.members where user_id=uid for update;
  if member_status<>'active' then raise exception 'EDM 账号已停用' using errcode='42501'; end if;
  select id into ws from edm.workspaces where bootstrap_owner_id=uid;
  if ws is null then
    insert into edm.workspaces(owner_id,bootstrap_owner_id) values(uid,uid) returning id into ws;
    insert into edm.workspace_members(workspace_id,user_id,role) values(ws,uid,'admin');
  end if;
  return ws;
end;
$$;
-- 暴露入口使用调用者权限，提权实现位于非暴露 schema。
create function edm.initialize_member() returns uuid language sql security invoker
set search_path = '' as $$ select edm_private.initialize_member(); $$;

revoke all on all tables in schema edm from public,anon,authenticated;
revoke all on all functions in schema edm,edm_private from public,anon,authenticated;
grant select on edm.members,edm.workspaces,edm.workspace_members to authenticated;
grant update(display_name) on edm.members to authenticated;
grant update(name,mailing_address) on edm.workspaces to authenticated;
grant execute on function edm_private.workspace_role(uuid),edm_private.initialize_member(),edm.initialize_member() to authenticated;
-- 撤销新建对象上的 AIGC 授权，不改变既有角色及其继承关系。
do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on schema edm,edm_private from aigc_api;
    revoke all on all tables in schema edm from aigc_api;
    revoke all on all functions in schema edm,edm_private from aigc_api;
  end if;
end $$;
