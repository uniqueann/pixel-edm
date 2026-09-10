-- 客户资料不表示订阅同意；订阅模型由后续迁移添加。
create table edm.contacts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references edm.workspaces(id),
 email text not null check (email=lower(btrim(email)) and length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 name text not null default '' check (length(name)<=100),
 archived_at timestamptz,
 created_by uuid not null references edm.members(user_id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1,
 unique(workspace_id,email), unique(workspace_id,id)
);
create table edm.tags (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references edm.workspaces(id),
 name text not null check (name=btrim(name) and length(name) between 1 and 30),
 normalized_name text generated always as (lower(name)) stored,
 created_at timestamptz not null default now(),
 unique(workspace_id,normalized_name), unique(workspace_id,id)
);
create table edm.contact_tags (
 workspace_id uuid not null, contact_id uuid not null, tag_id uuid not null,
 primary key(contact_id,tag_id),
 foreign key(workspace_id,contact_id) references edm.contacts(workspace_id,id),
 foreign key(workspace_id,tag_id) references edm.tags(workspace_id,id)
);
create index contacts_list_idx on edm.contacts(workspace_id,(archived_at is not null),created_at desc,id desc);
create index contact_tags_filter_idx on edm.contact_tags(workspace_id,tag_id,contact_id);
alter table edm.contacts enable row level security;
alter table edm.tags enable row level security;
alter table edm.contact_tags enable row level security;
create policy contacts_read on edm.contacts for select to authenticated using(edm_private.workspace_role(workspace_id) is not null);
create policy tags_read on edm.tags for select to authenticated using(edm_private.workspace_role(workspace_id) is not null);
create policy contact_tags_read on edm.contact_tags for select to authenticated using(edm_private.workspace_role(workspace_id) is not null);

-- 写入集中于事务入口，禁止客户端绕过版本检查或伪造系统字段。
create function edm_private.save_contact(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; cid uuid := (payload->>'id')::uuid;
 tag_value text; tid uuid; current_row edm.contacts; tags_input jsonb := payload->'tags';
begin
 if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
  raise exception '没有客户管理权限' using errcode='42501'; end if;
 if jsonb_typeof(tags_input) is distinct from 'array' then raise exception '标签格式错误'; end if;
 if jsonb_array_length(tags_input)>20 then raise exception '每位客户最多 20 个标签'; end if;
 if cid is null then
  insert into edm.contacts(workspace_id,email,name,created_by)
  values(ws,lower(btrim(payload->>'email')),btrim(coalesce(payload->>'name','')),auth.uid()) returning id into cid;
 else
  select * into current_row from edm.contacts where id=cid and workspace_id=ws for update;
  if not found then raise exception '客户不存在或不可访问'; end if;
  if current_row.version is distinct from (payload->>'expected_version')::integer then raise exception '资料已被修改，请重新加载后重试'; end if;
  if current_row.archived_at is not null then raise exception '请先恢复客户再编辑'; end if;
  update edm.contacts set email=lower(btrim(payload->>'email')),name=btrim(coalesce(payload->>'name','')),
   version=version+1,updated_at=clock_timestamp() where id=cid;
 end if;
 delete from edm.contact_tags where contact_id=cid;
 for tag_value in select btrim(value) from jsonb_array_elements_text(tags_input) loop
  insert into edm.tags(workspace_id,name) values(ws,tag_value)
   on conflict(workspace_id,normalized_name) do nothing;
  select id into tid from edm.tags where workspace_id=ws and normalized_name=lower(tag_value);
  insert into edm.contact_tags values(ws,cid,tid) on conflict do nothing;
 end loop;
 return cid;
end;
$$;
create function edm_private.archive_contact(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; cid uuid := (payload->>'id')::uuid; current_row edm.contacts;
begin
 if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then raise exception '没有客户管理权限' using errcode='42501'; end if;
 if jsonb_typeof(payload->'archived') is distinct from 'boolean' then raise exception '归档状态错误'; end if;
 select * into current_row from edm.contacts where id=cid and workspace_id=ws for update;
 if not found then raise exception '客户不存在或不可访问'; end if;
 if current_row.version is distinct from (payload->>'expected_version')::integer then raise exception '资料已被修改，请重新加载后重试'; end if;
 update edm.contacts set archived_at=case when (payload->>'archived')::boolean then coalesce(archived_at,clock_timestamp()) else null end,
  version=version+1,updated_at=clock_timestamp() where id=cid;
 return cid;
end;
$$;
create function edm.save_contact(payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select edm_private.save_contact(payload); $$;
create function edm.archive_contact(payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select edm_private.archive_contact(payload); $$;
create function edm.list_contacts(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; total integer; page_no integer; result jsonb;
begin
 if edm_private.workspace_role(ws) is null then raise exception '工作区不可访问' using errcode='42501'; end if;
 select count(*) into total from edm.contacts c where c.workspace_id=ws
  and (c.archived_at is not null)=coalesce((payload->>'archived')::boolean,false)
  and (strpos(lower(c.email),lower(coalesce(payload->>'q','')))>0 or strpos(lower(c.name),lower(coalesce(payload->>'q','')))>0)
  and (nullif(payload->>'tag_id','') is null or exists(select 1 from edm.contact_tags ct where ct.contact_id=c.id and ct.tag_id=(payload->>'tag_id')::uuid));
 page_no=least(greatest(coalesce((payload->>'page')::integer,1),1),greatest((total+19)/20,1));
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (
 select c.*,coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name) from edm.tags t join edm.contact_tags ct on ct.tag_id=t.id where ct.contact_id=c.id),'[]') as tags
 from edm.contacts c where c.workspace_id=ws and (c.archived_at is not null)=coalesce((payload->>'archived')::boolean,false)
 and (strpos(lower(c.email),lower(coalesce(payload->>'q','')))>0 or strpos(lower(c.name),lower(coalesce(payload->>'q','')))>0)
 and (nullif(payload->>'tag_id','') is null or exists(select 1 from edm.contact_tags ct where ct.contact_id=c.id and ct.tag_id=(payload->>'tag_id')::uuid))
 order by c.created_at desc,c.id desc limit 20 offset (page_no-1)*20) r;
 return jsonb_build_object('items',result,'total',total,'page',page_no,'tags',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from edm.tags where workspace_id=ws),'[]'),
 'active_count',(select count(*) from edm.contacts where workspace_id=ws and archived_at is null));
end;
$$;
revoke all on edm.contacts,edm.tags,edm.contact_tags from public,anon,authenticated;
grant select on edm.contacts,edm.tags,edm.contact_tags to authenticated;
revoke all on function edm.save_contact(jsonb),edm.archive_contact(jsonb),edm.list_contacts(jsonb),edm_private.save_contact(jsonb),edm_private.archive_contact(jsonb) from public,anon;
grant execute on function edm.save_contact(jsonb),edm.archive_contact(jsonb),edm.list_contacts(jsonb),edm_private.save_contact(jsonb),edm_private.archive_contact(jsonb) to authenticated;
