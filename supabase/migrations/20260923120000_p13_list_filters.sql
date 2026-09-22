-- P13：列表页服务端搜索与状态筛选，保持分页总数与结果一致。

create or replace function edm_private.list_templates(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  show_archived boolean := coalesce((payload->>'archived')::boolean,false);
  q_filter text := nullif(btrim(payload->>'q'),'');
  category_filter text := nullif(btrim(payload->>'category'),'');
  total integer;
  page_no integer;
  result jsonb;
  categories jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '工作区不可访问' using errcode='42501';
  end if;

  select count(*) into total
  from edm.templates t
  where t.workspace_id=ws
    and (t.archived_at is not null)=show_archived
    and (q_filter is null or strpos(lower(t.name),lower(q_filter))>0 or strpos(lower(t.subject),lower(q_filter))>0)
    and (category_filter is null or t.category=category_filter);

  page_no=least(greatest(coalesce((payload->>'page')::integer,1),1),greatest((total+19)/20,1));

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc),'[]'::jsonb) into result
  from (
    select id,workspace_id,name,category,subject,body,default_key,source_template_id,archived_at,created_at,updated_at,version
    from edm.templates
    where workspace_id=ws
      and (archived_at is not null)=show_archived
      and (q_filter is null or strpos(lower(name),lower(q_filter))>0 or strpos(lower(subject),lower(q_filter))>0)
      and (category_filter is null or category=category_filter)
    order by created_at desc,id desc
    limit 20 offset (page_no-1)*20
  ) t;

  select coalesce(jsonb_agg(category order by category),'[]'::jsonb) into categories
  from (
    select distinct category
    from edm.templates
    where workspace_id=ws and (archived_at is not null)=show_archived
  ) options;

  return jsonb_build_object('items',result,'total',total,'page',page_no,
    'active_count',(select count(*) from edm.templates where workspace_id=ws and archived_at is null),
    'categories',categories);
end;
$$;

create or replace function edm_private.list_campaigns(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  show_archived boolean := coalesce((payload->>'archived')::boolean,false);
  q_filter text := nullif(btrim(payload->>'q'),'');
  status_filter text := nullif(btrim(payload->>'campaign_status'),'');
  total integer;
  page_no integer;
  result jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '工作区不可访问' using errcode='42501';
  end if;

  select count(*) into total
  from edm.campaigns c
  where c.workspace_id=ws
    and (c.archived_at is not null)=show_archived
    and (q_filter is null or strpos(lower(c.name),lower(q_filter))>0)
    and (status_filter is null or c.status=status_filter);

  page_no=least(greatest(coalesce((payload->>'page')::integer,1),1),greatest((total+19)/20,1));

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
    where c.workspace_id=ws
      and (c.archived_at is not null)=show_archived
      and (q_filter is null or strpos(lower(c.name),lower(q_filter))>0)
      and (status_filter is null or c.status=status_filter)
    order by c.created_at desc,c.id desc
    limit 20 offset (page_no-1)*20
  ) item;

  return jsonb_build_object('items',result,'total',total,'page',page_no,'page_size',20);
end;
$$;

create or replace function edm_private.list_activity_logs(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  total integer;
  page_no integer;
  page_size integer := least(greatest(coalesce((payload->>'page_size')::integer,20),1),50);
  actor_filter text := nullif(payload->>'actor','');
  action_filter text := nullif(btrim(payload->>'action'),'');
  result jsonb;
  actors jsonb;
  retention_days integer;
  cutoff timestamptz;
begin
  if auth.uid() is null or edm_private.workspace_role(ws)<>'admin' then
    raise exception '没有日志查看权限' using errcode='42501';
  end if;
  retention_days := edm_private.assert_workspace_activity_log_access(ws);
  if retention_days is not null then
    cutoff := clock_timestamp() - make_interval(days => retention_days);
  end if;
  if actor_filter is not null and actor_filter<>'system' and actor_filter !~ '^[0-9a-fA-F-]{36}$' then
    raise exception '操作者筛选无效';
  end if;

  select count(*) into total
  from edm.activity_logs l
  where l.workspace_id=ws
    and (cutoff is null or l.created_at >= cutoff)
    and (actor_filter is null or (actor_filter='system' and l.actor_id is null) or l.actor_id::text=actor_filter)
    and (action_filter is null or l.action=action_filter);

  page_no=least(greatest(coalesce((payload->>'page')::integer,1),1),greatest((total+page_size-1)/page_size,1));

  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id desc),'[]'::jsonb) into result
  from (
    select id,actor_id,actor_name,actor_role,action,target_type,target_id,target_label,metadata,created_at
    from edm.activity_logs l
    where l.workspace_id=ws
      and (cutoff is null or l.created_at >= cutoff)
      and (actor_filter is null or (actor_filter='system' and l.actor_id is null) or l.actor_id::text=actor_filter)
      and (action_filter is null or l.action=action_filter)
    order by created_at desc,id desc
    limit page_size offset (page_no-1)*page_size
  ) l;

  select coalesce(jsonb_agg(jsonb_build_object('id',a.actor_key,'name',a.actor_name) order by a.actor_name),'[]'::jsonb) into actors
  from (
    select distinct on (coalesce(actor_id::text,'system')) coalesce(actor_id::text,'system') actor_key,actor_name,created_at
    from edm.activity_logs
    where workspace_id=ws and (cutoff is null or created_at >= cutoff)
    order by coalesce(actor_id::text,'system'),created_at desc
  ) a;

  return jsonb_build_object('items',result,'total',total,'page',page_no,'page_size',page_size,'actors',actors,
    'retention_days',retention_days);
end;
$$;
