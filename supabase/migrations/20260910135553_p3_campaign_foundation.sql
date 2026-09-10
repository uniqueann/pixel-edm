-- P3-0 / P3-1 活动草稿基础：仅修改 edm / edm_private，不触碰共享 Auth 与 aigc。
create function edm_private.campaign_variables_are_valid(value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select value is not null
    and jsonb_typeof(value)='object'
    and pg_column_size(value)<=8192
    and not exists (
      select 1
      from jsonb_each(value) as item(key, item_value)
      where item.key not in ('store_name','sender_name','discount','product','order_number')
        or jsonb_typeof(item.item_value)<>'string'
        or char_length(item.item_value #>> '{}')>200
    );
$$;

create table edm.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references edm.workspaces(id),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 100),
  template_id uuid not null,
  audience_type text not null check (audience_type in ('all','tag')),
  tag_id uuid,
  variables jsonb not null default '{}'::jsonb check (edm_private.campaign_variables_are_valid(variables)),
  status text not null default 'draft' check (status in ('draft','queued','sending','completed','completed_with_errors','failed')),
  archived_at timestamptz,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version>0),
  unique(workspace_id,id),
  constraint campaigns_audience_tag_check check (
    (audience_type='all' and tag_id is null)
    or (audience_type='tag' and tag_id is not null)
  ),
  foreign key(workspace_id,template_id) references edm.templates(workspace_id,id),
  foreign key(workspace_id,tag_id) references edm.tags(workspace_id,id),
  foreign key(workspace_id,created_by) references edm.workspace_members(workspace_id,user_id),
  foreign key(workspace_id,updated_by) references edm.workspace_members(workspace_id,user_id)
);

create index campaigns_list_idx on edm.campaigns(workspace_id,(archived_at is not null),created_at desc,id desc);
create index campaigns_template_idx on edm.campaigns(workspace_id,template_id);
create index campaigns_tag_idx on edm.campaigns(workspace_id,tag_id) where tag_id is not null;
create index campaigns_created_by_idx on edm.campaigns(workspace_id,created_by);
create index campaigns_updated_by_idx on edm.campaigns(workspace_id,updated_by);

alter table edm.campaigns enable row level security;
create policy campaigns_member_read on edm.campaigns for select to authenticated
  using ((select edm_private.workspace_role(workspace_id)) is not null);

create function edm_private.list_campaigns(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  show_archived boolean := coalesce((payload->>'archived')::boolean,false);
  total integer;
  page_no integer;
  result jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '工作区不可访问' using errcode='42501';
  end if;

  select count(*) into total
  from edm.campaigns c
  where c.workspace_id=ws and (c.archived_at is not null)=show_archived;

  page_no=least(
    greatest(coalesce((payload->>'page')::integer,1),1),
    greatest((total+19)/20,1)
  );

  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc,item.id desc),'[]'::jsonb)
  into result
  from (
    select
      c.id,
      c.workspace_id,
      c.name,
      c.template_id,
      t.name as template_name,
      t.category as template_category,
      (t.archived_at is not null) as template_archived,
      c.audience_type,
      c.tag_id,
      tag.name as tag_name,
      c.status,
      c.archived_at,
      c.created_at,
      c.updated_at,
      c.created_by,
      creator.display_name as created_by_name,
      c.version
    from edm.campaigns c
    join edm.templates t on t.workspace_id=c.workspace_id and t.id=c.template_id
    left join edm.tags tag on tag.workspace_id=c.workspace_id and tag.id=c.tag_id
    join edm.members creator on creator.user_id=c.created_by
    where c.workspace_id=ws and (c.archived_at is not null)=show_archived
    order by c.created_at desc,c.id desc
    limit 20 offset (page_no-1)*20
  ) item;

  return jsonb_build_object('items',result,'total',total,'page',page_no,'page_size',20);
end;
$$;

create function edm_private.get_campaign(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  campaign_id uuid := (payload->>'id')::uuid;
  result jsonb;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有活动管理权限' using errcode='42501';
  end if;

  select jsonb_build_object(
    'id',c.id,
    'workspace_id',c.workspace_id,
    'name',c.name,
    'template_id',c.template_id,
    'template',jsonb_build_object(
      'id',t.id,
      'name',t.name,
      'category',t.category,
      'subject',t.subject,
      'body',t.body,
      'version',t.version,
      'archived_at',t.archived_at
    ),
    'audience_type',c.audience_type,
    'tag_id',c.tag_id,
    'tag',case when tag.id is null then null else jsonb_build_object('id',tag.id,'name',tag.name) end,
    'variables',c.variables,
    'status',c.status,
    'archived_at',c.archived_at,
    'created_by',c.created_by,
    'updated_by',c.updated_by,
    'created_at',c.created_at,
    'updated_at',c.updated_at,
    'version',c.version
  ) into result
  from edm.campaigns c
  join edm.templates t on t.workspace_id=c.workspace_id and t.id=c.template_id
  left join edm.tags tag on tag.workspace_id=c.workspace_id and tag.id=c.tag_id
  where c.workspace_id=ws and c.id=campaign_id;

  if result is null then raise exception '活动不存在或不可访问'; end if;
  return result;
end;
$$;

create function edm_private.save_campaign(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  campaign_id uuid := (payload->>'id')::uuid;
  selected_template_id uuid := (payload->>'template_id')::uuid;
  selected_tag_id uuid := (payload->>'tag_id')::uuid;
  campaign_name text := btrim(coalesce(payload->>'name',''));
  selected_audience text := coalesce(payload->>'audience_type','');
  selected_variables jsonb := coalesce(payload->'variables','{}'::jsonb);
  current_row edm.campaigns;
  variable_keys jsonb;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有活动管理权限' using errcode='42501';
  end if;
  if char_length(campaign_name) not between 1 and 100 then raise exception '活动名称应为 1 至 100 字'; end if;
  if selected_template_id is null then raise exception '请选择模板'; end if;
  if selected_audience not in ('all','tag') then raise exception '收件范围无效'; end if;
  if (selected_audience='all' and selected_tag_id is not null)
    or (selected_audience='tag' and selected_tag_id is null) then
    raise exception '收件范围与标签不一致';
  end if;
  if not edm_private.campaign_variables_are_valid(selected_variables) then
    raise exception '活动变量格式无效';
  end if;
  if selected_tag_id is not null and not exists(
    select 1 from edm.tags where workspace_id=ws and id=selected_tag_id
  ) then raise exception '标签不存在或不可访问'; end if;

  select coalesce(jsonb_agg(key order by key),'[]'::jsonb) into variable_keys
  from jsonb_object_keys(selected_variables) as keys(key);

  if campaign_id is null then
    if not exists(
      select 1 from edm.templates where workspace_id=ws and id=selected_template_id and archived_at is null
    ) then raise exception '模板不存在、已归档或不可访问'; end if;

    insert into edm.campaigns(
      workspace_id,name,template_id,audience_type,tag_id,variables,created_by,updated_by
    ) values(
      ws,campaign_name,selected_template_id,selected_audience,selected_tag_id,selected_variables,auth.uid(),auth.uid()
    ) returning id into campaign_id;

    perform edm_private.log_activity(
      ws,'campaign.created','campaign',campaign_id,campaign_name,
      jsonb_build_object(
        'template_id',selected_template_id,
        'audience_type',selected_audience,
        'tag_id',selected_tag_id,
        'variable_keys',variable_keys
      )
    );
  else
    select * into current_row
    from edm.campaigns
    where workspace_id=ws and id=campaign_id
    for update;
    if not found then raise exception '活动不存在或不可访问'; end if;
    if current_row.version is distinct from (payload->>'expected_version')::integer then
      raise exception '活动已被修改，请重新加载后重试';
    end if;
    if current_row.status<>'draft' then raise exception '只有草稿活动可以编辑'; end if;
    if current_row.archived_at is not null then raise exception '请先恢复活动再编辑'; end if;
    if selected_template_id<>current_row.template_id and not exists(
      select 1 from edm.templates where workspace_id=ws and id=selected_template_id and archived_at is null
    ) then raise exception '模板不存在、已归档或不可访问'; end if;
    if selected_template_id=current_row.template_id and not exists(
      select 1 from edm.templates where workspace_id=ws and id=selected_template_id
    ) then raise exception '模板不存在或不可访问'; end if;

    update edm.campaigns set
      name=campaign_name,
      template_id=selected_template_id,
      audience_type=selected_audience,
      tag_id=selected_tag_id,
      variables=selected_variables,
      updated_by=auth.uid(),
      updated_at=clock_timestamp(),
      version=version+1
    where workspace_id=ws and id=campaign_id;

    perform edm_private.log_activity(
      ws,'campaign.updated','campaign',campaign_id,campaign_name,
      jsonb_build_object(
        'template_id',selected_template_id,
        'audience_type',selected_audience,
        'tag_id',selected_tag_id,
        'variable_keys',variable_keys
      )
    );
  end if;

  return campaign_id;
end;
$$;

create function edm_private.set_campaign_archived(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  campaign_id uuid := (payload->>'id')::uuid;
  should_archive boolean := (payload->>'archived')::boolean;
  current_row edm.campaigns;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有活动管理权限' using errcode='42501';
  end if;
  if jsonb_typeof(payload->'archived') is distinct from 'boolean' then raise exception '归档状态错误'; end if;

  select * into current_row
  from edm.campaigns
  where workspace_id=ws and id=campaign_id
  for update;
  if not found then raise exception '活动不存在或不可访问'; end if;
  if current_row.version is distinct from (payload->>'expected_version')::integer then
    raise exception '活动已被修改，请重新加载后重试';
  end if;
  if current_row.status<>'draft' then raise exception '只有草稿活动可以归档或恢复'; end if;

  update edm.campaigns set
    archived_at=case when should_archive then coalesce(archived_at,clock_timestamp()) else null end,
    updated_by=auth.uid(),
    updated_at=clock_timestamp(),
    version=version+1
  where workspace_id=ws and id=campaign_id;

  perform edm_private.log_activity(
    ws,
    case when should_archive then 'campaign.archived' else 'campaign.restored' end,
    'campaign',campaign_id,current_row.name,'{}'::jsonb
  );
  return campaign_id;
end;
$$;

create function edm.list_campaigns(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select edm_private.list_campaigns(payload); $$;
create function edm.get_campaign(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select edm_private.get_campaign(payload); $$;
create function edm.save_campaign(payload jsonb) returns uuid
language sql security invoker set search_path='' as $$ select edm_private.save_campaign(payload); $$;
create function edm.set_campaign_archived(payload jsonb) returns uuid
language sql security invoker set search_path='' as $$ select edm_private.set_campaign_archived(payload); $$;

revoke all on edm.campaigns from public,anon,authenticated;
revoke all on function
  edm.list_campaigns(jsonb),
  edm.get_campaign(jsonb),
  edm.save_campaign(jsonb),
  edm.set_campaign_archived(jsonb),
  edm_private.list_campaigns(jsonb),
  edm_private.get_campaign(jsonb),
  edm_private.save_campaign(jsonb),
  edm_private.set_campaign_archived(jsonb),
  edm_private.campaign_variables_are_valid(jsonb)
from public,anon,authenticated;
grant execute on function
  edm.list_campaigns(jsonb),
  edm.get_campaign(jsonb),
  edm.save_campaign(jsonb),
  edm.set_campaign_archived(jsonb),
  edm_private.list_campaigns(jsonb),
  edm_private.get_campaign(jsonb),
  edm_private.save_campaign(jsonb),
  edm_private.set_campaign_archived(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.campaigns from aigc_api;
    revoke all on all functions in schema edm,edm_private from aigc_api;
  end if;
end $$;
