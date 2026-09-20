-- P10 阶段一：套餐发信额度（无支付）。仅 edm / edm_private。
-- free 档偏紧：前期默认全员 free，日配额/速率低于 DirectMail 注册表默认。

create table edm.delivery_plan_limits (
  plan text primary key check (plan in ('free', 'pro', 'team')),
  display_name text not null check (char_length(display_name) between 1 and 32),
  max_recipients_per_campaign integer not null
    check (max_recipients_per_campaign between 1 and 10000),
  daily_send_quota integer not null
    check (daily_send_quota between 1 and 10000000),
  max_rate_per_second integer not null
    check (max_rate_per_second between 1 and 1000),
  quota_timezone text not null default 'Asia/Shanghai'
    check (char_length(quota_timezone) between 1 and 64),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger delivery_plan_limits_updated
  before update on edm.delivery_plan_limits
  for each row execute function edm_private.touch_updated_at();

insert into edm.delivery_plan_limits(
  plan, display_name, max_recipients_per_campaign, daily_send_quota, max_rate_per_second, quota_timezone
) values
  ('free', 'Free', 500, 1000, 2, 'Asia/Shanghai'),
  ('pro', 'Pro', 2000, 10000, 10, 'Asia/Shanghai'),
  ('team', 'Team', 5000, 25000, 20, 'Asia/Shanghai')
on conflict (plan) do update set
  display_name = excluded.display_name,
  max_recipients_per_campaign = excluded.max_recipients_per_campaign,
  daily_send_quota = excluded.daily_send_quota,
  max_rate_per_second = excluded.max_rate_per_second,
  quota_timezone = excluded.quota_timezone,
  updated_at = clock_timestamp();

revoke all on edm.delivery_plan_limits from public, anon, authenticated;

create or replace function edm_private.delivery_plan_limits_for_workspace(p_workspace_id uuid)
returns edm.delivery_plan_limits
language sql stable security definer set search_path = '' as $$
  select limits.*
  from edm.workspaces workspace
  join edm.delivery_plan_limits limits on limits.plan = workspace.plan
  where workspace.id = p_workspace_id;
$$;

create or replace function edm_private.workspace_daily_send_usage(
  p_workspace_id uuid,
  p_quota_timezone text
) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from edm.campaign_delivery_attempts attempt
  where attempt.workspace_id = p_workspace_id
    and (attempt.provider_call_started_at at time zone p_quota_timezone)::date =
      (clock_timestamp() at time zone p_quota_timezone)::date;
$$;

create or replace function edm_private.assert_campaign_recipient_limit(
  p_workspace_id uuid,
  p_value integer
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  limits edm.delivery_plan_limits;
begin
  if p_value < 1 then raise exception '当前没有可确认的收件人'; end if;
  select * into limits from edm_private.delivery_plan_limits_for_workspace(p_workspace_id);
  if not found then raise exception '工作区套餐配置无效'; end if;
  if p_value > limits.max_recipients_per_campaign then
    raise exception '当前套餐下单个活动最多 % 位收件人', limits.max_recipients_per_campaign;
  end if;
  return p_value;
end;
$$;

drop function if exists edm_private.assert_campaign_recipient_limit(integer);

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

alter table edm.campaign_delivery_runs
  drop constraint if exists campaign_delivery_runs_recipient_count_check;
alter table edm.campaign_delivery_runs
  add constraint campaign_delivery_runs_recipient_count_check
  check (recipient_count between 1 and 10000);

create or replace function edm_private.start_campaign_delivery(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_campaign_id uuid := (payload->>'campaign_id')::uuid;
  requested_key uuid := (payload->>'idempotency_key')::uuid;
  expected_version integer := (payload->>'expected_version')::integer;
  confirmed_name text := btrim(coalesce(payload->>'confirmation_name',''));
  campaign_row edm.campaigns;
  snapshot_row edm.campaign_snapshots;
  workspace_row edm.workspaces;
  channel_row edm.delivery_channels;
  existing_run edm.campaign_delivery_runs;
  plan_limits edm.delivery_plan_limits;
  usage_today integer;
  new_run_id uuid;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以开始正式发送' using errcode='42501';
  end if;
  if requested_key is null then raise exception '发送请求标识无效'; end if;

  select * into existing_run from edm.campaign_delivery_runs
  where workspace_id=ws and idempotency_key=requested_key;
  if found then
    return jsonb_build_object('run_id',existing_run.id,'status',existing_run.status,'reused',true);
  end if;

  select * into campaign_row from edm.campaigns
  where workspace_id=ws and id=requested_campaign_id for update;
  if not found then raise exception '活动不存在或不可访问'; end if;
  if campaign_row.version<>expected_version then raise exception '活动已被修改，请重新加载后重试'; end if;
  if campaign_row.status<>'confirmed' or campaign_row.archived_at is not null then
    raise exception '只有未归档的已确认活动可以正式发送';
  end if;

  select * into snapshot_row from edm.campaign_snapshots
  where workspace_id=ws and campaign_id=campaign_row.id;
  if not found then raise exception '活动快照不存在'; end if;
  if confirmed_name<>snapshot_row.campaign_name then raise exception '请输入完整活动名称确认发送'; end if;

  select * into plan_limits from edm_private.delivery_plan_limits_for_workspace(ws);
  if not found then raise exception '工作区套餐配置无效'; end if;
  if snapshot_row.recipient_count>plan_limits.max_recipients_per_campaign then
    raise exception '当前套餐下单个活动最多 % 位收件人', plan_limits.max_recipients_per_campaign;
  end if;
  usage_today := edm_private.workspace_daily_send_usage(ws, plan_limits.quota_timezone);
  if usage_today + snapshot_row.recipient_count > plan_limits.daily_send_quota then
    raise exception '今日套餐发信额度不足（已用 % / % 封）', usage_today, plan_limits.daily_send_quota;
  end if;

  select * into workspace_row from edm.workspaces where id=ws for share;
  if not found or char_length(btrim(workspace_row.mailing_address))=0 then
    raise exception '请先填写发件人联系地址';
  end if;
  select * into channel_row from edm.delivery_channels
  where workspace_id=ws and is_primary for update;
  if not found or channel_row.status<>'verified' or channel_row.disconnected_at is not null then
    raise exception '请先连接并验证发信通道';
  end if;
  if not exists(
    select 1 from edm_private.delivery_channel_credentials credential
    where credential.workspace_id=ws and credential.channel_id=channel_row.id
      and credential.credential_version=channel_row.credential_version
  ) then raise exception '发信通道凭据不存在'; end if;
  if exists(select 1 from edm.campaign_delivery_runs where workspace_id=ws and campaign_id=campaign_row.id) then
    raise exception '该活动已创建正式发送任务';
  end if;

  insert into edm.campaign_delivery_runs(
    workspace_id,campaign_id,snapshot_id,channel_id,idempotency_key,
    sender_address,sender_alias,reply_to_address,
    sender_workspace_name,sender_mailing_address,
    channel_version,credential_version,recipient_count,started_by
  ) values(
    ws,campaign_row.id,snapshot_row.id,channel_row.id,requested_key,
    channel_row.sender_address,channel_row.sender_alias,channel_row.reply_to_address,
    workspace_row.name,workspace_row.mailing_address,
    channel_row.version,channel_row.credential_version,
    snapshot_row.recipient_count,auth.uid()
  ) returning id into new_run_id;

  insert into edm.campaign_delivery_tasks(
    workspace_id,run_id,recipient_snapshot_id,position
  )
  select ws,new_run_id,recipient.id,recipient.position
  from edm.campaign_recipient_snapshots recipient
  where recipient.workspace_id=ws and recipient.snapshot_id=snapshot_row.id
  order by recipient.position;

  if (select count(*) from edm.campaign_delivery_tasks where run_id=new_run_id)<>snapshot_row.recipient_count then
    raise exception '正式发送任务创建失败';
  end if;

  update edm.campaigns set status='queued',updated_by=auth.uid(),
    updated_at=clock_timestamp(),version=version+1
  where workspace_id=ws and id=campaign_row.id;
  perform edm_private.log_activity(
    ws,'campaign.delivery_started','campaign',campaign_row.id,snapshot_row.campaign_name,
    jsonb_build_object(
      'run_id',new_run_id,'snapshot_id',snapshot_row.id,
      'channel_id',channel_row.id,'provider',channel_row.provider,
      'recipient_count',snapshot_row.recipient_count,
      'sender_domain',split_part(channel_row.sender_address,'@',2)
    ),'campaign-delivery-started:'||campaign_row.id::text
  );
  return jsonb_build_object('run_id',new_run_id,'status','queued','reused',false);
end;
$$;

create or replace function edm_private.worker_claim_delivery_batch(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  requested_limit integer := least(greatest(coalesce((payload->>'limit')::integer,10),1),10);
  task_row edm.campaign_delivery_tasks;
  run_row edm.campaign_delivery_runs;
  channel_row edm.delivery_channels;
  credential_row edm_private.delivery_channel_credentials;
  recipient_row edm.campaign_recipient_snapshots;
  contact_row edm.contacts;
  plan_limits edm.delivery_plan_limits;
  new_attempt_id uuid;
  lease uuid;
  claimed jsonb := '[]'::jsonb;
  claimed_count integer := 0;
  workspace_claims jsonb := '{}'::jsonb;
  recent_calls integer;
  daily_calls integer;
  retry_at timestamptz;
  limit_per_second integer;
  limit_daily integer;
  quota_zone text;
begin
  perform edm_private.worker_recover_expired_delivery_leases();
  for task_row in
    select task.* from edm.campaign_delivery_tasks task
    join edm.campaign_delivery_runs run on run.id=task.run_id
    where task.status='pending' and task.next_attempt_at<=clock_timestamp()
      and run.status in ('queued','sending')
    order by task.next_attempt_at,run.started_at,task.position
    for update of task skip locked
    limit 100
  loop
    exit when claimed_count>=requested_limit;
    select * into run_row from edm.campaign_delivery_runs where id=task_row.run_id for update;
    if run_row.status not in ('queued','sending') then continue; end if;

    select * into plan_limits
    from edm_private.delivery_plan_limits_for_workspace(task_row.workspace_id);
    if not found then continue; end if;

    select
      coalesce(channel.rate_per_second,prov.default_rate_per_second),
      coalesce(channel.daily_quota,prov.default_daily_quota),
      prov.quota_timezone
    into limit_per_second,limit_daily,quota_zone
    from edm.delivery_channels channel
    join edm.delivery_providers prov on prov.provider=channel.provider
    where channel.workspace_id=run_row.workspace_id and channel.id=run_row.channel_id;
    if limit_per_second is null then
      select default_rate_per_second,default_daily_quota,quota_timezone
      into limit_per_second,limit_daily,quota_zone
      from edm.delivery_providers where provider=run_row.provider;
    end if;

    limit_per_second := least(limit_per_second, plan_limits.max_rate_per_second);
    limit_daily := least(limit_daily, plan_limits.daily_send_quota);
    quota_zone := plan_limits.quota_timezone;

    if coalesce((workspace_claims->>task_row.workspace_id::text)::integer,0)>=limit_per_second then
      continue;
    end if;
    if char_length(btrim(run_row.sender_workspace_name))=0
      or char_length(btrim(run_row.sender_mailing_address))=0 then
      update edm.campaign_delivery_runs set status='paused',pause_reason='sender_compliance',
        paused_at=clock_timestamp(),version=version+1 where id=run_row.id;
      update edm.campaigns set status='paused',updated_at=clock_timestamp(),version=version+1
        where workspace_id=run_row.workspace_id and id=run_row.campaign_id;
      perform edm_private.log_activity(
        run_row.workspace_id,'campaign.delivery_paused','campaign',run_row.campaign_id,null,
        jsonb_build_object('run_id',run_row.id,'reason','sender_compliance'),
        'campaign-delivery-compliance-paused:'||run_row.id::text,true
      );
      continue;
    end if;

    select count(*) into recent_calls from edm.campaign_delivery_attempts attempt
    where attempt.workspace_id=task_row.workspace_id
      and attempt.provider_call_started_at>clock_timestamp()-interval '1 second';
    if recent_calls>=limit_per_second then continue; end if;
    select count(*) into daily_calls from edm.campaign_delivery_attempts attempt
    where attempt.workspace_id=task_row.workspace_id
      and (attempt.provider_call_started_at at time zone quota_zone)::date=
        (clock_timestamp() at time zone quota_zone)::date;
    if daily_calls>=limit_daily then
      retry_at=(date_trunc('day',clock_timestamp() at time zone quota_zone)+interval '1 day')
        at time zone quota_zone;
      update edm.campaign_delivery_tasks set next_attempt_at=retry_at,version=version+1 where id=task_row.id;
      continue;
    end if;

    select * into recipient_row from edm.campaign_recipient_snapshots
      where workspace_id=task_row.workspace_id and id=task_row.recipient_snapshot_id;
    select * into contact_row from edm.contacts
      where workspace_id=task_row.workspace_id and id=recipient_row.contact_id;
    if not found or contact_row.archived_at is not null
      or contact_row.email<>recipient_row.email
      or contact_row.subscription_status<>'subscribed'
      or exists(select 1 from edm.suppressions suppression
        where suppression.workspace_id=task_row.workspace_id and suppression.email=recipient_row.email) then
      update edm.campaign_delivery_tasks set status='skipped',skip_reason='recipient_ineligible',
        completed_at=clock_timestamp(),version=version+1 where id=task_row.id;
      perform edm_private.finalize_campaign_delivery(task_row.run_id);
      continue;
    end if;

    select * into channel_row from edm.delivery_channels
      where workspace_id=run_row.workspace_id and id=run_row.channel_id;
    select * into credential_row from edm_private.delivery_channel_credentials
      where workspace_id=run_row.workspace_id and channel_id=run_row.channel_id
        and credential_version=run_row.credential_version;
    if channel_row.id is null or credential_row.channel_id is null
      or channel_row.status<>'verified'
      or channel_row.provider<>run_row.provider
      or (channel_row.provider_config->>'region') is distinct from (run_row.provider_config->>'region')
      or channel_row.sender_address<>run_row.sender_address
      or channel_row.sender_alias<>run_row.sender_alias
      or channel_row.reply_to_address is distinct from run_row.reply_to_address then
      update edm.campaign_delivery_runs set status='paused',pause_reason='channel_configuration',
        paused_at=clock_timestamp(),version=version+1 where id=run_row.id;
      update edm.campaigns set status='paused',updated_at=clock_timestamp(),version=version+1
        where workspace_id=run_row.workspace_id and id=run_row.campaign_id;
      continue;
    end if;

    lease=gen_random_uuid();
    insert into edm.campaign_delivery_attempts(
      workspace_id,run_id,task_id,attempt_number,credential_version
    ) values(
      task_row.workspace_id,task_row.run_id,task_row.id,task_row.attempt_count+1,
      run_row.credential_version
    ) returning id into new_attempt_id;
    update edm.campaign_delivery_tasks set status='processing',
      attempt_count=attempt_count+1,lease_token=lease,
      lease_expires_at=clock_timestamp()+interval '90 seconds',
      active_attempt_id=new_attempt_id,error_category=null,error_code=null,
      completed_at=null,version=version+1 where id=task_row.id;
    if run_row.status='queued' then
      update edm.campaign_delivery_runs set status='sending',version=version+1 where id=run_row.id;
      update edm.campaigns set status='sending',updated_at=clock_timestamp(),version=version+1
        where workspace_id=run_row.workspace_id and id=run_row.campaign_id;
    end if;
    claimed=claimed||jsonb_build_array(jsonb_build_object(
      'task_id',task_row.id,'run_id',run_row.id,'workspace_id',run_row.workspace_id,
      'attempt_id',new_attempt_id,'lease_token',lease,
      'recipient_email',recipient_row.email,'subject',recipient_row.subject,'body',recipient_row.body,
      'workspace_name',run_row.sender_workspace_name,
      'mailing_address',run_row.sender_mailing_address,
      'channel',jsonb_strip_nulls(jsonb_build_object(
        'id',channel_row.id,
        'provider',run_row.provider,
        'provider_config',run_row.provider_config,
        'region',run_row.provider_config->>'region',
        'sender_address',run_row.sender_address,
        'sender_alias',run_row.sender_alias,'reply_to_address',run_row.reply_to_address,
        'credential_version',run_row.credential_version,
        'tracking_enabled',run_row.tracking_enabled,
        'tracking_tag_name',run_row.provider_config->>'tracking_tag_name'
      )),
      'credential',jsonb_build_object(
        'key_id',credential_row.key_id,'nonce',encode(credential_row.nonce,'base64'),
        'ciphertext',encode(credential_row.ciphertext,'base64'),
        'credential_version',credential_row.credential_version
      )
    ));
    workspace_claims=jsonb_set(workspace_claims,array[task_row.workspace_id::text],
      to_jsonb(coalesce((workspace_claims->>task_row.workspace_id::text)::integer,0)+1),true);
    claimed_count=claimed_count+1;
  end loop;
  return claimed;
end;
$$;

create or replace function edm_private.get_workspace_delivery_plan(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  limits edm.delivery_plan_limits;
  usage_today integer;
begin
  if ws is null then raise exception '工作区标识无效'; end if;
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '没有权限查看发信套餐' using errcode='42501';
  end if;
  select * into limits from edm_private.delivery_plan_limits_for_workspace(ws);
  if not found then raise exception '工作区套餐配置无效'; end if;
  usage_today := edm_private.workspace_daily_send_usage(ws, limits.quota_timezone);
  return jsonb_build_object(
    'plan', limits.plan,
    'plan_display_name', limits.display_name,
    'daily_send_quota', limits.daily_send_quota,
    'usage_today', usage_today,
    'remaining_today', greatest(limits.daily_send_quota - usage_today, 0),
    'max_recipients_per_campaign', limits.max_recipients_per_campaign,
    'quota_timezone', limits.quota_timezone
  );
end;
$$;

create or replace function edm.get_workspace_delivery_plan(payload jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select edm_private.get_workspace_delivery_plan(payload);
$$;

grant execute on function edm.get_workspace_delivery_plan(jsonb) to authenticated;
