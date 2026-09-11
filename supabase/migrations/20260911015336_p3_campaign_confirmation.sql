-- P3-4 活动确认、不可变快照与安全 CSV 数据接口。仅修改 EDM 对象。
alter table edm.campaigns drop constraint campaigns_status_check;
alter table edm.campaigns add constraint campaigns_status_check
  check (status in ('draft','confirmed','queued','sending','completed','completed_with_errors','failed'));

create table edm.campaign_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references edm.workspaces(id),
  campaign_id uuid not null,
  campaign_name text not null check (char_length(campaign_name) between 1 and 100),
  template_id uuid not null,
  template_name text not null check (char_length(template_name) between 1 and 80),
  template_subject text not null,
  template_body text not null,
  template_version integer not null check (template_version>0),
  audience_type text not null check (audience_type in ('all','tag')),
  tag_id uuid,
  tag_name text,
  variables jsonb not null check (edm_private.campaign_variables_are_valid(variables)),
  audience_count integer not null check (audience_count>=1),
  recipient_count integer not null check (recipient_count between 1 and 10000),
  excluded_archived_count integer not null check (excluded_archived_count>=0),
  excluded_suppressed_count integer not null check (excluded_suppressed_count>=0),
  excluded_not_subscribed_count integer not null check (excluded_not_subscribed_count>=0),
  confirmed_by uuid not null,
  confirmed_by_name text not null check (char_length(confirmed_by_name) between 1 and 80),
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(workspace_id,id),
  unique(workspace_id,campaign_id),
  constraint campaign_snapshots_audience_tag_check check (
    (audience_type='all' and tag_id is null and tag_name is null)
    or (audience_type='tag' and tag_id is not null and tag_name is not null)
  ),
  constraint campaign_snapshots_counts_check check (
    audience_count=recipient_count+excluded_archived_count+
      excluded_suppressed_count+excluded_not_subscribed_count
  ),
  foreign key(workspace_id,campaign_id) references edm.campaigns(workspace_id,id),
  foreign key(workspace_id,confirmed_by) references edm.workspace_members(workspace_id,user_id)
);

create table edm.campaign_recipient_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  snapshot_id uuid not null,
  position integer not null check (position between 1 and 10000),
  contact_id uuid not null,
  email text not null check (
    email=lower(btrim(email)) and char_length(email)<=254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  name text not null check (char_length(name)<=100),
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique(snapshot_id,position),
  unique(snapshot_id,contact_id),
  unique(snapshot_id,email),
  foreign key(workspace_id,snapshot_id) references edm.campaign_snapshots(workspace_id,id)
);

create index campaign_snapshots_campaign_idx
  on edm.campaign_snapshots(campaign_id);
create index campaign_snapshots_confirmed_by_idx
  on edm.campaign_snapshots(workspace_id,confirmed_by);
create index campaign_recipient_snapshots_export_idx
  on edm.campaign_recipient_snapshots(workspace_id,snapshot_id,position);

alter table edm.campaign_snapshots enable row level security;
alter table edm.campaign_recipient_snapshots enable row level security;
create policy campaign_snapshots_manager_read on edm.campaign_snapshots
  for select to authenticated
  using ((select edm_private.workspace_role(workspace_id)) in ('admin','editor'));
create policy campaign_recipient_snapshots_manager_read on edm.campaign_recipient_snapshots
  for select to authenticated
  using ((select edm_private.workspace_role(workspace_id)) in ('admin','editor'));

create function edm_private.reject_campaign_snapshot_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception '活动快照不可修改或删除';
end;
$$;

create trigger campaign_snapshots_immutable
before update or delete on edm.campaign_snapshots
for each row execute function edm_private.reject_campaign_snapshot_mutation();
create trigger campaign_recipient_snapshots_immutable
before update or delete on edm.campaign_recipient_snapshots
for each row execute function edm_private.reject_campaign_snapshot_mutation();

create function edm_private.assert_campaign_recipient_limit(value integer) returns integer
language plpgsql immutable set search_path='' as $$
begin
  if value<1 then raise exception '当前没有可确认的收件人'; end if;
  if value>10000 then raise exception '单个活动最多确认 10000 位收件人，请拆分标签后重试'; end if;
  return value;
end;
$$;

create or replace function edm_private.list_campaigns(payload jsonb) returns jsonb
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
      c.version,
      snapshot.recipient_count,
      snapshot.confirmed_at,
      snapshot.confirmed_by_name,
      snapshot.template_version as snapshot_template_version
    from edm.campaigns c
    join edm.templates t on t.workspace_id=c.workspace_id and t.id=c.template_id
    left join edm.tags tag on tag.workspace_id=c.workspace_id and tag.id=c.tag_id
    join edm.members creator on creator.user_id=c.created_by
    left join edm.campaign_snapshots snapshot
      on snapshot.workspace_id=c.workspace_id and snapshot.campaign_id=c.id
    where c.workspace_id=ws and (c.archived_at is not null)=show_archived
    order by c.created_at desc,c.id desc
    limit 20 offset (page_no-1)*20
  ) item;

  return jsonb_build_object('items',result,'total',total,'page',page_no,'page_size',20);
end;
$$;

create function edm_private.confirm_campaign(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_campaign_id uuid := (payload->>'id')::uuid;
  expected_campaign_version integer := (payload->>'expected_campaign_version')::integer;
  expected_template_version integer := (payload->>'expected_template_version')::integer;
  campaign_row edm.campaigns;
  template_row edm.templates;
  existing_snapshot edm.campaign_snapshots;
  required_variables text[];
  missing_variables text[];
  actor_name text;
  confirmation_time timestamptz := clock_timestamp();
  result jsonb;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有活动确认权限' using errcode='42501';
  end if;

  select * into campaign_row
  from edm.campaigns
  where workspace_id=ws and id=requested_campaign_id
  for update;
  if not found then raise exception '活动不存在或不可访问'; end if;

  if campaign_row.status='confirmed' then
    select * into existing_snapshot
    from edm.campaign_snapshots snapshot
    where snapshot.workspace_id=ws and snapshot.campaign_id=campaign_row.id;
    if not found then raise exception '已确认活动缺少快照，请联系管理员'; end if;
    return jsonb_build_object(
      'campaign_id',campaign_row.id,
      'campaign_version',campaign_row.version,
      'snapshot_id',existing_snapshot.id,
      'recipient_count',existing_snapshot.recipient_count,
      'confirmed_at',existing_snapshot.confirmed_at,
      'template_version',existing_snapshot.template_version,
      'already_confirmed',true
    );
  end if;

  if campaign_row.status<>'draft' then raise exception '只有草稿活动可以确认'; end if;
  if campaign_row.archived_at is not null then raise exception '已归档活动不能确认'; end if;
  if expected_campaign_version is null or campaign_row.version<>expected_campaign_version then
    raise exception '活动已被修改，请重新预览后重试';
  end if;

  select * into template_row
  from edm.templates
  where workspace_id=ws and id=campaign_row.template_id
  for share;
  if not found then raise exception '模板不存在或不可访问'; end if;
  if template_row.archived_at is not null then raise exception '当前模板已归档，请恢复或替换模板'; end if;
  if expected_template_version is null or template_row.version<>expected_template_version then
    raise exception '模板已被修改，请重新预览后重试';
  end if;

  required_variables=edm_private.campaign_required_variables(template_row.subject,template_row.body);
  select coalesce(array_agg(variable_key order by position),'{}'::text[])
  into missing_variables
  from unnest(required_variables) with ordinality as required(variable_key,position)
  where nullif(btrim(campaign_row.variables->>variable_key),'') is null;
  if cardinality(missing_variables)>0 then
    raise exception '请补充活动变量：%',array_to_string(
      array(select '{{'||value||'}}' from unnest(missing_variables) as value),'、'
    );
  end if;

  select coalesce(nullif(m.display_name,''),'工作区成员') into actor_name
  from edm.members m where m.user_id=auth.uid();

  with audience as materialized (
    select
      contact.id,
      contact.email,
      contact.name,
      contact.created_at,
      case
        when contact.archived_at is not null then 'archived'
        when exists(
          select 1 from edm.suppressions suppression
          where suppression.workspace_id=ws and suppression.email=contact.email
        ) then 'suppressed'
        when contact.subscription_status<>'subscribed' then 'not_subscribed'
      end as exclusion_reason
    from edm.contacts contact
    where contact.workspace_id=ws
      and (
        campaign_row.audience_type='all'
        or exists(
          select 1 from edm.contact_tags contact_tag
          where contact_tag.workspace_id=ws
            and contact_tag.contact_id=contact.id
            and contact_tag.tag_id=campaign_row.tag_id
        )
      )
  ), eligible as materialized (
    select
      audience.*,
      row_number() over(order by audience.created_at,audience.id)::integer as position
    from audience
    where audience.exclusion_reason is null
  ), totals as (
    select
      count(*)::integer as audience_count,
      count(*) filter(where exclusion_reason is null)::integer as recipient_count,
      count(*) filter(where exclusion_reason='archived')::integer as archived_count,
      count(*) filter(where exclusion_reason='suppressed')::integer as suppressed_count,
      count(*) filter(where exclusion_reason='not_subscribed')::integer as not_subscribed_count
    from audience
  ), snapshot_insert as (
    insert into edm.campaign_snapshots(
      workspace_id,campaign_id,campaign_name,
      template_id,template_name,template_subject,template_body,template_version,
      audience_type,tag_id,tag_name,variables,
      audience_count,recipient_count,excluded_archived_count,
      excluded_suppressed_count,excluded_not_subscribed_count,
      confirmed_by,confirmed_by_name,confirmed_at
    )
    select
      ws,campaign_row.id,campaign_row.name,
      template_row.id,template_row.name,template_row.subject,template_row.body,template_row.version,
      campaign_row.audience_type,campaign_row.tag_id,
      case when campaign_row.tag_id is null then null else (
        select tag.name from edm.tags tag
        where tag.workspace_id=ws and tag.id=campaign_row.tag_id
      ) end,
      campaign_row.variables,
      totals.audience_count,edm_private.assert_campaign_recipient_limit(totals.recipient_count),
      totals.archived_count,totals.suppressed_count,totals.not_subscribed_count,
      auth.uid(),actor_name,confirmation_time
    from totals
    returning id,recipient_count,confirmed_at,template_version
  ), recipient_insert as (
    insert into edm.campaign_recipient_snapshots(
      workspace_id,snapshot_id,position,contact_id,email,name,subject,body,created_at
    )
    select
      ws,snapshot_insert.id,eligible.position,eligible.id,eligible.email,
      coalesce(nullif(btrim(eligible.name),''),split_part(eligible.email,'@',1)),
      edm_private.render_campaign_text(
        template_row.subject,eligible.name,eligible.email,campaign_row.variables
      ),
      edm_private.render_campaign_text(
        template_row.body,eligible.name,eligible.email,campaign_row.variables
      ),
      confirmation_time
    from eligible cross join snapshot_insert
    order by eligible.position
    returning id
  ), campaign_update as (
    update edm.campaigns campaign set
      status='confirmed',
      updated_by=auth.uid(),
      updated_at=confirmation_time,
      version=campaign.version+1
    from snapshot_insert
    where campaign.workspace_id=ws and campaign.id=campaign_row.id
      and (select count(*) from recipient_insert)=snapshot_insert.recipient_count
    returning campaign.version
  )
  select jsonb_build_object(
    'campaign_id',campaign_row.id,
    'campaign_version',campaign_update.version,
    'snapshot_id',snapshot_insert.id,
    'recipient_count',snapshot_insert.recipient_count,
    'confirmed_at',snapshot_insert.confirmed_at,
    'template_version',snapshot_insert.template_version,
    'already_confirmed',false
  ) into result
  from snapshot_insert cross join campaign_update;

  if result is null then raise exception '活动快照创建失败'; end if;
  perform edm_private.log_activity(
    ws,'campaign.confirmed','campaign',campaign_row.id,campaign_row.name,
    jsonb_build_object(
      'snapshot_id',result->>'snapshot_id',
      'template_id',template_row.id,
      'template_version',template_row.version,
      'recipient_count',(result->>'recipient_count')::integer,
      'audience_type',campaign_row.audience_type
    ),
    'campaign-confirmed:'||campaign_row.id::text
  );
  return result;
end;
$$;

create function edm_private.duplicate_confirmed_campaign(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  source_campaign_id uuid := (payload->>'id')::uuid;
  requested_template_id uuid := (payload->>'template_id')::uuid;
  source_campaign edm.campaigns;
  source_snapshot edm.campaign_snapshots;
  selected_template edm.templates;
  duplicate_id uuid;
  duplicate_name text;
  variable_keys jsonb;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有活动复制权限' using errcode='42501';
  end if;

  select * into source_campaign from edm.campaigns
  where workspace_id=ws and id=source_campaign_id;
  if not found or source_campaign.status<>'confirmed' then raise exception '只能复制已确认活动'; end if;
  select * into source_snapshot from edm.campaign_snapshots
  where workspace_id=ws and campaign_id=source_campaign_id;
  if not found then raise exception '活动快照不存在'; end if;

  select * into selected_template from edm.templates
  where workspace_id=ws
    and id=coalesce(requested_template_id,source_snapshot.template_id)
    and archived_at is null;
  if not found then raise exception '原模板已归档，请选择一套使用中的模板'; end if;
  if source_snapshot.audience_type='tag' and not exists(
    select 1 from edm.tags where workspace_id=ws and id=source_snapshot.tag_id
  ) then raise exception '原活动标签已不可用，请新建活动'; end if;

  duplicate_name=left(source_snapshot.campaign_name,96)||'（副本）';
  insert into edm.campaigns(
    workspace_id,name,template_id,audience_type,tag_id,variables,created_by,updated_by
  ) values(
    ws,duplicate_name,selected_template.id,source_snapshot.audience_type,
    source_snapshot.tag_id,source_snapshot.variables,auth.uid(),auth.uid()
  ) returning id into duplicate_id;

  select coalesce(jsonb_agg(key order by key),'[]'::jsonb) into variable_keys
  from jsonb_object_keys(source_snapshot.variables) as keys(key);
  perform edm_private.log_activity(
    ws,'campaign.duplicated','campaign',duplicate_id,duplicate_name,
    jsonb_build_object(
      'source_campaign_id',source_campaign_id,
      'source_snapshot_id',source_snapshot.id,
      'template_id',selected_template.id,
      'audience_type',source_snapshot.audience_type,
      'variable_keys',variable_keys
    )
  );
  return duplicate_id;
end;
$$;

create function edm_private.get_campaign_export_chunk(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_campaign_id uuid := (payload->>'id')::uuid;
  export_id uuid := (payload->>'export_id')::uuid;
  after_position integer := greatest(coalesce((payload->>'after_position')::integer,0),0);
  page_size integer := least(greatest(coalesce((payload->>'limit')::integer,500),1),500);
  campaign_row edm.campaigns;
  snapshot_row edm.campaign_snapshots;
  rows_result jsonb;
  last_position integer;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有活动导出权限' using errcode='42501';
  end if;
  if export_id is null then raise exception '导出请求标识无效'; end if;

  select * into campaign_row from edm.campaigns
  where workspace_id=ws and id=requested_campaign_id;
  if not found or campaign_row.status<>'confirmed' then raise exception '只有已确认活动可以导出'; end if;
  select * into snapshot_row from edm.campaign_snapshots
  where workspace_id=ws and campaign_id=requested_campaign_id;
  if not found then raise exception '活动快照不存在'; end if;

  perform edm_private.log_activity(
    ws,'campaign.csv_exported','campaign',campaign_row.id,snapshot_row.campaign_name,
    jsonb_build_object(
      'snapshot_id',snapshot_row.id,
      'template_version',snapshot_row.template_version,
      'recipient_count',snapshot_row.recipient_count,
      'export_id',export_id
    ),
    'campaign-csv-export:'||campaign_row.id::text||':'||export_id::text
  );

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'position',item.position,
      'email',item.email,
      'name',item.name,
      'subject',item.subject,
      'body',item.body
    ) order by item.position),'[]'::jsonb),
    coalesce(max(item.position),after_position)
  into rows_result,last_position
  from (
    select recipient.position,recipient.email,recipient.name,recipient.subject,recipient.body
    from edm.campaign_recipient_snapshots recipient
    where recipient.workspace_id=ws and recipient.snapshot_id=snapshot_row.id
      and recipient.position>after_position
    order by recipient.position
    limit page_size
  ) item;

  return jsonb_build_object(
    'campaign_name',snapshot_row.campaign_name,
    'confirmed_at',snapshot_row.confirmed_at,
    'recipient_count',snapshot_row.recipient_count,
    'rows',rows_result,
    'next_position',last_position,
    'has_more',last_position<snapshot_row.recipient_count
  );
end;
$$;

create or replace function edm_private.set_campaign_archived(payload jsonb) returns uuid
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

  select * into current_row from edm.campaigns
  where workspace_id=ws and id=campaign_id for update;
  if not found then raise exception '活动不存在或不可访问'; end if;
  if current_row.version is distinct from (payload->>'expected_version')::integer then
    raise exception '活动已被修改，请重新加载后重试';
  end if;
  if current_row.status not in ('draft','confirmed') then
    raise exception '当前活动状态不能归档或恢复';
  end if;

  update edm.campaigns set
    archived_at=case when should_archive then coalesce(archived_at,clock_timestamp()) else null end,
    updated_by=auth.uid(),updated_at=clock_timestamp(),version=version+1
  where workspace_id=ws and id=campaign_id;

  perform edm_private.log_activity(
    ws,case when should_archive then 'campaign.archived' else 'campaign.restored' end,
    'campaign',campaign_id,current_row.name,
    jsonb_build_object('status',current_row.status)
  );
  return campaign_id;
end;
$$;

create function edm.confirm_campaign(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.confirm_campaign(payload); $$;
create function edm.duplicate_confirmed_campaign(payload jsonb) returns uuid
language sql security invoker set search_path=''
as $$ select edm_private.duplicate_confirmed_campaign(payload); $$;
create function edm.get_campaign_export_chunk(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.get_campaign_export_chunk(payload); $$;

revoke all on edm.campaign_snapshots,edm.campaign_recipient_snapshots
from public,anon,authenticated;
revoke all on function
  edm.confirm_campaign(jsonb),
  edm.duplicate_confirmed_campaign(jsonb),
  edm.get_campaign_export_chunk(jsonb),
  edm_private.confirm_campaign(jsonb),
  edm_private.duplicate_confirmed_campaign(jsonb),
  edm_private.get_campaign_export_chunk(jsonb),
  edm_private.reject_campaign_snapshot_mutation(),
  edm_private.assert_campaign_recipient_limit(integer)
from public,anon,authenticated;
grant execute on function
  edm.confirm_campaign(jsonb),
  edm.duplicate_confirmed_campaign(jsonb),
  edm.get_campaign_export_chunk(jsonb),
  edm_private.confirm_campaign(jsonb),
  edm_private.duplicate_confirmed_campaign(jsonb),
  edm_private.get_campaign_export_chunk(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.campaign_snapshots,edm.campaign_recipient_snapshots from aigc_api;
    revoke all on function
      edm.confirm_campaign(jsonb),
      edm.duplicate_confirmed_campaign(jsonb),
      edm.get_campaign_export_chunk(jsonb),
      edm_private.confirm_campaign(jsonb),
      edm_private.duplicate_confirmed_campaign(jsonb),
      edm_private.get_campaign_export_chunk(jsonb),
      edm_private.reject_campaign_snapshot_mutation(),
      edm_private.assert_campaign_recipient_limit(integer)
    from aigc_api;
  end if;
end $$;
