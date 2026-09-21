-- P12 能力门控：自定义模板 / 每月确认活动 / 操作日志 / 打开点击统计；Pro 仅单人，协作仅 Team。

alter table edm.delivery_plan_limits
  add column if not exists max_custom_templates integer,
  add column if not exists max_confirmed_campaigns_per_month integer,
  add column if not exists activity_log_retention_days integer,
  add column if not exists allows_campaign_statistics boolean;

update edm.delivery_plan_limits set
  max_custom_templates = case plan when 'free' then 3 else null end,
  max_confirmed_campaigns_per_month = case plan when 'free' then 3 else null end,
  activity_log_retention_days = case plan when 'free' then 0 when 'pro' then 7 else null end,
  allows_campaign_statistics = plan in ('pro', 'team'),
  max_active_members = case plan when 'free' then 1 when 'pro' then 1 when 'team' then 20 end
where max_custom_templates is null and max_confirmed_campaigns_per_month is null;

alter table edm.delivery_plan_limits
  alter column allows_campaign_statistics set not null;

alter table edm.delivery_plan_limits
  add constraint delivery_plan_limits_max_custom_templates_check
    check (max_custom_templates is null or max_custom_templates between 0 and 10000),
  add constraint delivery_plan_limits_max_confirmed_campaigns_per_month_check
    check (max_confirmed_campaigns_per_month is null or max_confirmed_campaigns_per_month between 1 and 10000),
  add constraint delivery_plan_limits_activity_log_retention_days_check
    check (activity_log_retention_days is null or activity_log_retention_days between 0 and 3650);

create or replace function edm_private.workspace_custom_template_count(p_workspace_id uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from edm.templates
  where workspace_id = p_workspace_id
    and default_key is null
    and archived_at is null;
$$;

create or replace function edm_private.workspace_monthly_confirmed_campaign_count(
  p_workspace_id uuid,
  p_quota_timezone text
) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from edm.campaign_snapshots snapshot
  where snapshot.workspace_id = p_workspace_id
    and (snapshot.confirmed_at at time zone p_quota_timezone) >=
      date_trunc('month', clock_timestamp() at time zone p_quota_timezone);
$$;

create or replace function edm_private.assert_workspace_custom_template_headroom(
  p_workspace_id uuid,
  p_additional integer default 1
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  limits edm.delivery_plan_limits;
  current_count integer;
begin
  if coalesce(p_additional, 0) < 1 then return; end if;
  select * into limits from edm_private.delivery_plan_limits_for_workspace(p_workspace_id);
  if limits.max_custom_templates is null then return; end if;
  current_count := edm_private.workspace_custom_template_count(p_workspace_id);
  if current_count + p_additional > limits.max_custom_templates then
    raise exception '当前套餐最多 % 个自定义模板（预置模板不占用额度），已有 % 个',
      limits.max_custom_templates, current_count;
  end if;
end;
$$;

create or replace function edm_private.assert_workspace_monthly_confirm_headroom(
  p_workspace_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  limits edm.delivery_plan_limits;
  current_count integer;
begin
  select * into limits from edm_private.delivery_plan_limits_for_workspace(p_workspace_id);
  if limits.max_confirmed_campaigns_per_month is null then return; end if;
  current_count := edm_private.workspace_monthly_confirmed_campaign_count(
    p_workspace_id, limits.quota_timezone
  );
  if current_count + 1 > limits.max_confirmed_campaigns_per_month then
    raise exception '当前套餐每月最多确认 % 个活动（本自然月已确认 % 个）',
      limits.max_confirmed_campaigns_per_month, current_count;
  end if;
end;
$$;

create or replace function edm_private.assert_workspace_activity_log_access(p_workspace_id uuid)
returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  retention integer;
begin
  select activity_log_retention_days into retention
  from edm_private.delivery_plan_limits_for_workspace(p_workspace_id);
  if retention is not distinct from 0 then
    raise exception '当前套餐不包含操作日志，请升级专业版或团队版' using errcode='42501';
  end if;
  return retention;
end;
$$;

create or replace function edm_private.save_template(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; template_id uuid := (payload->>'id')::uuid;
  current_row edm.templates; template_name text := btrim(coalesce(payload->>'name',''));
  template_category text := btrim(coalesce(payload->>'category',''));
  template_subject text := btrim(coalesce(payload->>'subject','')); template_body text := coalesce(payload->>'body','');
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有模板管理权限' using errcode='42501'; end if;
  if char_length(template_name) not between 1 and 80 then raise exception '模板名称应为 1 至 80 字'; end if;
  if char_length(template_category) not between 1 and 50 then raise exception '分类应为 1 至 50 字'; end if;
  if char_length(template_subject) not between 1 and 200 or template_subject ~ E'[\r\n]' then raise exception '主题应为 1 至 200 字且不能换行'; end if;
  if char_length(btrim(template_body)) not between 1 and 20000 then raise exception '正文应为 1 至 20000 字'; end if;
  if not edm_private.template_text_is_valid(template_subject) or not edm_private.template_text_is_valid(template_body) then
    raise exception '模板包含未知变量或未闭合的双花括号'; end if;
  if template_id is null then
    perform edm_private.assert_workspace_custom_template_headroom(ws, 1);
    insert into edm.templates(workspace_id,name,category,subject,body,created_by,updated_by)
      values(ws,template_name,template_category,template_subject,template_body,auth.uid(),auth.uid()) returning id into template_id;
    perform edm_private.log_activity(ws,'template.created','template',template_id,template_name,jsonb_build_object('category',template_category));
  else
    select * into current_row from edm.templates where id=template_id and workspace_id=ws for update;
    if not found then raise exception '模板不存在或不可访问'; end if;
    if current_row.version is distinct from (payload->>'expected_version')::integer then raise exception '模板已被修改，请重新加载后重试'; end if;
    if current_row.archived_at is not null then raise exception '请先恢复模板再编辑'; end if;
    update edm.templates set name=template_name,category=template_category,subject=template_subject,body=template_body,
      updated_by=auth.uid(),version=version+1,updated_at=clock_timestamp() where id=template_id;
    perform edm_private.log_activity(ws,'template.updated','template',template_id,template_name,
      jsonb_build_object('fields',jsonb_build_array('name','category','subject','body')));
  end if;
  return template_id;
end;
$$;

create or replace function edm_private.duplicate_template(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; source_id uuid := (payload->>'id')::uuid;
  source_row edm.templates; new_id uuid; new_name text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有模板管理权限' using errcode='42501'; end if;
  select * into source_row from edm.templates where id=source_id and workspace_id=ws;
  if not found then raise exception '模板不存在或不可访问'; end if;
  perform edm_private.assert_workspace_custom_template_headroom(ws, 1);
  new_name=left(source_row.name,73)||' 副本';
  insert into edm.templates(workspace_id,name,category,subject,body,source_template_id,created_by,updated_by)
    values(ws,new_name,source_row.category,source_row.subject,source_row.body,source_row.id,auth.uid(),auth.uid()) returning id into new_id;
  perform edm_private.log_activity(ws,'template.duplicated','template',new_id,new_name,jsonb_build_object('source_template_id',source_id));
  return new_id;
end;
$$;

create or replace function edm_private.list_activity_logs(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; total integer; page_no integer;
  page_size integer := least(greatest(coalesce((payload->>'page_size')::integer,20),1),50);
  actor_filter text := nullif(payload->>'actor',''); result jsonb; actors jsonb;
  retention_days integer;
  cutoff timestamptz;
begin
  if auth.uid() is null or edm_private.workspace_role(ws)<>'admin' then raise exception '没有日志查看权限' using errcode='42501'; end if;
  retention_days := edm_private.assert_workspace_activity_log_access(ws);
  if retention_days is not null then
    cutoff := clock_timestamp() - make_interval(days => retention_days);
  end if;
  if actor_filter is not null and actor_filter<>'system' and actor_filter !~ '^[0-9a-fA-F-]{36}$' then raise exception '操作者筛选无效'; end if;
  select count(*) into total from edm.activity_logs l where l.workspace_id=ws
    and (cutoff is null or l.created_at >= cutoff)
    and (actor_filter is null or (actor_filter='system' and l.actor_id is null) or l.actor_id::text=actor_filter);
  page_no=least(greatest(coalesce((payload->>'page')::integer,1),1),greatest((total+page_size-1)/page_size,1));
  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id desc),'[]'::jsonb) into result from (
    select id,actor_id,actor_name,actor_role,action,target_type,target_id,target_label,metadata,created_at
    from edm.activity_logs l where l.workspace_id=ws
      and (cutoff is null or l.created_at >= cutoff)
      and (actor_filter is null or (actor_filter='system' and l.actor_id is null) or l.actor_id::text=actor_filter)
    order by created_at desc,id desc limit page_size offset (page_no-1)*page_size
  ) l;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.actor_key,'name',a.actor_name) order by a.actor_name),'[]'::jsonb) into actors from (
    select distinct on (coalesce(actor_id::text,'system')) coalesce(actor_id::text,'system') actor_key,actor_name,created_at
    from edm.activity_logs where workspace_id=ws
      and (cutoff is null or created_at >= cutoff)
    order by coalesce(actor_id::text,'system'),created_at desc
  ) a;
  return jsonb_build_object('items',result,'total',total,'page',page_no,'page_size',page_size,'actors',actors,
    'retention_days',retention_days);
end;
$$;

create or replace function edm_private.create_workspace_invitation(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  ws uuid := (payload->>'workspace_id')::uuid;
  email_value text := lower(btrim(coalesce(payload->>'email','')));
  invitation_role text := coalesce(payload->>'role','');
  token_hash_value text := coalesce(payload->>'token_hash','');
  token_hint_value text := coalesce(payload->>'token_hint','');
  workspace_row edm.workspaces;
  plan_limits edm.delivery_plan_limits;
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
  select * into plan_limits from edm_private.delivery_plan_limits_for_workspace(ws);
  if plan_limits.plan <> 'team' then
    raise exception '团队成员与邀请仅团队版可用，请升级团队版';
  end if;

  perform edm_private.assert_workspace_member_headroom(ws, 1);

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

-- confirm_campaign：在 P10 版本上增加每月确认额度（仅新确认时计数）
create or replace function edm_private.confirm_campaign(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
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

  perform edm_private.assert_workspace_monthly_confirm_headroom(ws);

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
      totals.audience_count,
      edm_private.assert_campaign_recipient_limit(ws, totals.recipient_count),
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

create or replace function edm_private.get_campaign_delivery_statistics(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_run_id uuid := (payload->>'run_id')::uuid;
  limits edm.delivery_plan_limits;
  result jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '工作区不可访问' using errcode='42501';
  end if;
  select * into limits from edm_private.delivery_plan_limits_for_workspace(ws);
  if not limits.allows_campaign_statistics then
    raise exception '当前套餐不包含打开/点击统计，请升级专业版' using errcode='42501';
  end if;
  if not exists(
    select 1 from edm.campaign_delivery_runs where workspace_id=ws and id=requested_run_id
  ) then raise exception '正式发送任务不存在'; end if;
  result=edm_private.campaign_delivery_statistics(requested_run_id);
  return result;
end;
$$;

create or replace function edm_private.get_workspace_campaign_statistics(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  limits edm.delivery_plan_limits;
  result jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '工作区不可访问' using errcode='42501';
  end if;
  select * into limits from edm_private.delivery_plan_limits_for_workspace(ws);
  if not limits.allows_campaign_statistics then
    return jsonb_build_object(
      'window_days',30,'tracked_campaigns',0,'delivered',0,'opened',0,'clicked',0,'last_event_at',null,
      'statistics_unavailable',true
    );
  end if;
  select jsonb_build_object(
    'window_days',30,
    'tracked_campaigns',count(distinct run.id)::integer,
    'delivered',count(*) filter (where task.delivery_status='delivered')::integer,
    'opened',count(*) filter (where task.first_opened_at is not null)::integer,
    'clicked',count(*) filter (where task.first_clicked_at is not null)::integer,
    'last_event_at',max(task.last_event_at)
  ) into result
  from edm.campaign_delivery_runs run
  join edm.campaign_delivery_tasks task on task.run_id=run.id
  where run.workspace_id=ws and run.tracking_enabled
    and run.started_at>=clock_timestamp()-interval '30 days';
  return result;
end;
$$;

create or replace function edm_private.get_workspace_delivery_plan(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  limits edm.delivery_plan_limits;
  usage_today integer;
  billable_contacts integer;
  active_members integer;
  custom_templates integer;
  monthly_confirms integer;
begin
  if ws is null then raise exception '工作区标识无效'; end if;
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '没有权限查看发信套餐' using errcode='42501';
  end if;
  select * into limits from edm_private.delivery_plan_limits_for_workspace(ws);
  if not found then raise exception '工作区套餐配置无效'; end if;
  usage_today := edm_private.workspace_daily_send_usage(ws, limits.quota_timezone);
  billable_contacts := edm_private.workspace_billable_contact_count(ws);
  active_members := edm_private.workspace_active_member_count(ws);
  custom_templates := edm_private.workspace_custom_template_count(ws);
  monthly_confirms := edm_private.workspace_monthly_confirmed_campaign_count(ws, limits.quota_timezone);
  return jsonb_build_object(
    'plan', limits.plan,
    'plan_display_name', limits.display_name,
    'max_billable_contacts', limits.max_billable_contacts,
    'billable_contacts', billable_contacts,
    'remaining_billable_contacts', greatest(limits.max_billable_contacts - billable_contacts, 0),
    'max_active_members', limits.max_active_members,
    'active_members', active_members,
    'remaining_member_slots', greatest(limits.max_active_members - active_members, 0),
    'max_custom_templates', limits.max_custom_templates,
    'custom_templates', custom_templates,
    'remaining_custom_templates', case
      when limits.max_custom_templates is null then null
      else greatest(limits.max_custom_templates - custom_templates, 0)
    end,
    'max_confirmed_campaigns_per_month', limits.max_confirmed_campaigns_per_month,
    'confirmed_campaigns_this_month', monthly_confirms,
    'remaining_confirmed_campaigns_this_month', case
      when limits.max_confirmed_campaigns_per_month is null then null
      else greatest(limits.max_confirmed_campaigns_per_month - monthly_confirms, 0)
    end,
    'activity_log_retention_days', limits.activity_log_retention_days,
    'allows_campaign_statistics', limits.allows_campaign_statistics,
    'allows_team_collaboration', limits.plan = 'team',
    'daily_send_quota', limits.daily_send_quota,
    'usage_today', usage_today,
    'remaining_today', greatest(limits.daily_send_quota - usage_today, 0),
    'max_recipients_per_campaign', limits.max_recipients_per_campaign,
    'quota_timezone', limits.quota_timezone
  );
end;
$$;
