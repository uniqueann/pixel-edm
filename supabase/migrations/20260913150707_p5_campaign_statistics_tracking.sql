-- P5-3 活动统计、通道级行为追踪及逐收件人结果筛选。
-- 仅操作 edm / edm_private；不修改共享 Auth、AIGC 或其他项目对象。

alter table edm.delivery_channels
  add column tracking_enabled boolean not null default false,
  add column tracking_tag_name text,
  add constraint delivery_channels_tracking_config_check check (
    (not tracking_enabled or tracking_tag_name is not null)
    and (
      tracking_tag_name is null
      or (
        char_length(tracking_tag_name) between 1 and 128
        and tracking_tag_name ~ '^[A-Za-z0-9_]+$'
      )
    )
  );

alter table edm.campaign_delivery_runs
  add column tracking_enabled boolean not null default false,
  add column tracking_tag_name text,
  add constraint campaign_delivery_runs_tracking_config_check check (
    (not tracking_enabled or tracking_tag_name is not null)
    and (
      tracking_tag_name is null
      or (
        char_length(tracking_tag_name) between 1 and 128
        and tracking_tag_name ~ '^[A-Za-z0-9_]+$'
      )
    )
  );

create function edm_private.freeze_delivery_tracking() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  channel_row edm.delivery_channels;
begin
  select * into channel_row
  from edm.delivery_channels
  where workspace_id=new.workspace_id and id=new.channel_id;
  if not found then raise exception '发信通道不存在'; end if;
  new.tracking_enabled=channel_row.tracking_enabled;
  new.tracking_tag_name=channel_row.tracking_tag_name;
  return new;
end;
$$;

create trigger campaign_delivery_runs_freeze_tracking
before insert on edm.campaign_delivery_runs
for each row execute function edm_private.freeze_delivery_tracking();

create function edm_private.configure_delivery_tracking(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  expected integer := (payload->>'expected_version')::integer;
  enabled boolean;
  tag_name text := nullif(btrim(coalesce(payload->>'tracking_tag_name','')),'');
  channel_row edm.delivery_channels;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以配置行为追踪' using errcode='42501';
  end if;
  if jsonb_typeof(payload->'tracking_enabled') is distinct from 'boolean' then
    raise exception '行为追踪开关无效';
  end if;
  enabled=(payload->>'tracking_enabled')::boolean;
  if enabled and tag_name is null then raise exception '开启追踪前请填写阿里云标签'; end if;
  if tag_name is not null and (
    char_length(tag_name) not between 1 and 128 or tag_name !~ '^[A-Za-z0-9_]+$'
  ) then raise exception '阿里云标签仅支持 1 至 128 位字母、数字和下划线'; end if;

  select * into channel_row from edm.delivery_channels
  where workspace_id=ws and id=requested_channel_id and provider='aliyun_directmail'
  for update;
  if not found then raise exception '发信通道不存在或不可访问'; end if;
  if channel_row.status='disconnected' then raise exception '发信通道已断开'; end if;
  if channel_row.version is distinct from expected then
    raise exception '发信通道已被修改，请重新加载后重试';
  end if;

  update edm.delivery_channels set
    tracking_enabled=enabled,
    tracking_tag_name=tag_name,
    updated_by=auth.uid(),
    updated_at=clock_timestamp(),
    version=version+1
  where id=channel_row.id;

  perform edm_private.log_activity(
    ws,'delivery_tracking.configured','delivery_channel',channel_row.id,'阿里云行为追踪',
    jsonb_build_object('enabled',enabled,'tag_configured',tag_name is not null)
  );
  return edm_private.get_delivery_channel(jsonb_build_object('workspace_id',ws));
end;
$$;

create or replace function edm_private.get_delivery_channel(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  role_name text;
  channel_row edm.delivery_channels;
  token_row edm_private.delivery_webhook_tokens;
  has_credentials boolean;
begin
  if auth.uid() is null then raise exception '需要登录' using errcode='42501'; end if;
  role_name=edm_private.workspace_role(ws);
  if role_name is null then raise exception '工作区不可访问' using errcode='42501'; end if;
  select * into channel_row from edm.delivery_channels
  where workspace_id=ws and provider='aliyun_directmail';
  if not found then return null; end if;
  select exists(
    select 1 from edm_private.delivery_channel_credentials credential
    where credential.workspace_id=ws and credential.channel_id=channel_row.id
  ) into has_credentials;
  if role_name='admin' then
    select * into token_row from edm_private.delivery_webhook_tokens
    where workspace_id=ws and channel_id=channel_row.id;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id',channel_row.id,'workspace_id',channel_row.workspace_id,
    'provider',channel_row.provider,'status',channel_row.status,
    'region',channel_row.region,'sender_domain',channel_row.sender_domain,
    'sender_address',channel_row.sender_address,'sender_alias',channel_row.sender_alias,
    'reply_to_address',channel_row.reply_to_address,'credential_configured',has_credentials,
    'access_key_hint',case when role_name='admin' then channel_row.access_key_hint end,
    'credential_version',case when role_name='admin' then channel_row.credential_version end,
    'last_verified_at',channel_row.last_verified_at,
    'last_error_code',case when role_name='admin' then channel_row.last_error_code end,
    'tracking_enabled',channel_row.tracking_enabled,
    'tracking_tag_name',channel_row.tracking_tag_name,
    'disconnected_at',channel_row.disconnected_at,'created_at',channel_row.created_at,
    'updated_at',channel_row.updated_at,'version',channel_row.version,
    'webhook',case when role_name='admin' and token_row.channel_id is not null then
      jsonb_build_object(
        'configured',token_row.revoked_at is null,'token_hint',token_row.token_hint,
        'token_version',token_row.token_version,'configured_at',token_row.configured_at,
        'last_authenticated_at',token_row.last_authenticated_at,
        'last_event_at',token_row.last_event_at,'revoked_at',token_row.revoked_at
      ) when role_name='admin' then jsonb_build_object('configured',false) end
  ));
end;
$$;

create or replace function edm_private.worker_claim_delivery_batch(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  requested_limit integer := least(greatest(coalesce((payload->>'limit')::integer,10),1),10);
  task_row edm.campaign_delivery_tasks;
  run_row edm.campaign_delivery_runs;
  channel_row edm.delivery_channels;
  credential_row edm_private.delivery_channel_credentials;
  recipient_row edm.campaign_recipient_snapshots;
  contact_row edm.contacts;
  new_attempt_id uuid;
  lease uuid;
  claimed jsonb := '[]'::jsonb;
  claimed_count integer := 0;
  workspace_claims jsonb := '{}'::jsonb;
  recent_calls integer;
  daily_calls integer;
  retry_at timestamptz;
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
    if coalesce((workspace_claims->>task_row.workspace_id::text)::integer,0)>=5 then continue; end if;
    select * into run_row from edm.campaign_delivery_runs where id=task_row.run_id for update;
    if run_row.status not in ('queued','sending') then continue; end if;
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
    if recent_calls>=5 then continue; end if;
    select count(*) into daily_calls from edm.campaign_delivery_attempts attempt
    where attempt.workspace_id=task_row.workspace_id
      and (attempt.provider_call_started_at at time zone 'Asia/Shanghai')::date=
        (clock_timestamp() at time zone 'Asia/Shanghai')::date;
    if daily_calls>=2000 then
      retry_at=(date_trunc('day',clock_timestamp() at time zone 'Asia/Shanghai')+interval '1 day') at time zone 'Asia/Shanghai';
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
      or channel_row.region<>run_row.region
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
      'channel',jsonb_build_object(
        'id',channel_row.id,'region',run_row.region,'sender_address',run_row.sender_address,
        'sender_alias',run_row.sender_alias,'reply_to_address',run_row.reply_to_address,
        'credential_version',run_row.credential_version,
        'tracking_enabled',run_row.tracking_enabled,
        'tracking_tag_name',run_row.tracking_tag_name
      ),
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

create function edm_private.campaign_delivery_statistics(requested_run_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'tracking_enabled',run.tracking_enabled,
    'tracking_tag_name',run.tracking_tag_name,
    'last_event_at',stats.last_event_at,
    'counts',jsonb_build_object(
      'recipients',run.recipient_count,
      'accepted',stats.accepted,
      'send_failed',stats.send_failed,
      'skipped',stats.skipped,
      'unknown',stats.unknown,
      'awaiting_receipt',stats.awaiting_receipt,
      'delivered',stats.delivered,
      'delivery_failed',stats.delivery_failed,
      'hard_bounced',stats.hard_bounced,
      'unsubscribed',stats.unsubscribed,
      'complained',stats.complained,
      'opened',stats.opened,
      'clicked',stats.clicked
    )
  )
  from edm.campaign_delivery_runs run
  cross join lateral (
    select
      count(*) filter (where task.status='accepted')::integer as accepted,
      count(*) filter (where task.status='failed')::integer as send_failed,
      count(*) filter (where task.status='skipped')::integer as skipped,
      count(*) filter (where task.status='unknown')::integer as unknown,
      count(*) filter (where task.delivery_status='awaiting_receipt')::integer as awaiting_receipt,
      count(*) filter (where task.delivery_status='delivered')::integer as delivered,
      count(*) filter (where task.delivery_status='delivery_failed')::integer as delivery_failed,
      count(*) filter (where task.delivery_status='hard_bounced')::integer as hard_bounced,
      count(*) filter (where task.feedback_status='unsubscribed')::integer as unsubscribed,
      count(*) filter (where task.feedback_status='complained')::integer as complained,
      count(*) filter (where task.first_opened_at is not null)::integer as opened,
      count(*) filter (where task.first_clicked_at is not null)::integer as clicked,
      max(task.last_event_at) as last_event_at
    from edm.campaign_delivery_tasks task where task.run_id=run.id
  ) stats
  where run.id=requested_run_id;
$$;

create or replace function edm_private.get_campaign_delivery_summaries(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  ids uuid[];
  result jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '工作区不可访问' using errcode='42501';
  end if;
  if jsonb_typeof(payload->'campaign_ids') is distinct from 'array'
    or jsonb_array_length(payload->'campaign_ids')>20 then raise exception '活动列表参数无效'; end if;
  select coalesce(array_agg(value::uuid),'{}') into ids
  from jsonb_array_elements_text(payload->'campaign_ids');
  select coalesce(jsonb_agg(item order by item->>'started_at'),'[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'id',run.id,'campaign_id',run.campaign_id,'status',run.status,
      'version',run.version,'recipient_count',run.recipient_count,
      'started_at',run.started_at,'paused_at',run.paused_at,
      'pause_reason',run.pause_reason,'completed_at',run.completed_at,
      'counts',edm_private.delivery_counts(run.id),
      'statistics',edm_private.campaign_delivery_statistics(run.id)
    ) item
    from edm.campaign_delivery_runs run
    where run.workspace_id=ws and run.campaign_id=any(ids)
  ) summaries;
  return result;
end;
$$;

create function edm_private.get_campaign_delivery_statistics(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_run_id uuid := (payload->>'run_id')::uuid;
  result jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '工作区不可访问' using errcode='42501';
  end if;
  if not exists(
    select 1 from edm.campaign_delivery_runs where workspace_id=ws and id=requested_run_id
  ) then raise exception '正式发送任务不存在'; end if;
  result=edm_private.campaign_delivery_statistics(requested_run_id);
  return result;
end;
$$;

create function edm_private.get_workspace_campaign_statistics(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  result jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '工作区不可访问' using errcode='42501';
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

create or replace function edm_private.list_campaign_delivery_tasks(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_run_id uuid := (payload->>'run_id')::uuid;
  requested_status text := nullif(payload->>'status','');
  requested_filter text := nullif(payload->>'result_filter','');
  page_no integer := greatest(coalesce((payload->>'page')::integer,1),1);
  total integer;
  result jsonb;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以查看逐收件人发送明细' using errcode='42501';
  end if;
  if requested_status is not null and requested_status not in ('pending','processing','accepted','failed','skipped','unknown') then
    raise exception '任务状态无效';
  end if;
  if requested_filter is not null and requested_filter not in (
    'pending','processing','accepted','failed','skipped','unknown',
    'awaiting_receipt','delivered','delivery_failed','hard_bounced',
    'unsubscribed','complained','opened','clicked'
  ) then raise exception '结果筛选无效'; end if;
  if requested_status is not null and requested_filter is not null then
    raise exception '结果筛选参数冲突';
  end if;
  if requested_filter is null then requested_filter=requested_status; end if;
  if not exists(select 1 from edm.campaign_delivery_runs where workspace_id=ws and id=requested_run_id) then
    raise exception '正式发送任务不存在';
  end if;
  select count(*) into total from edm.campaign_delivery_tasks task
  where task.workspace_id=ws and task.run_id=requested_run_id
    and (
      requested_filter is null
      or (requested_filter in ('pending','processing','accepted','failed','skipped','unknown') and task.status=requested_filter)
      or (requested_filter in ('awaiting_receipt','delivered','delivery_failed','hard_bounced') and task.delivery_status=requested_filter)
      or (requested_filter in ('unsubscribed','complained') and task.feedback_status=requested_filter)
      or (requested_filter='opened' and task.first_opened_at is not null)
      or (requested_filter='clicked' and task.first_clicked_at is not null)
    );
  select coalesce(jsonb_agg(to_jsonb(item) order by item.position),'[]'::jsonb) into result
  from (
    select task.id,task.position,task.status,recipient.email,recipient.name,
      task.attempt_count,task.next_attempt_at,task.error_category,task.error_code,
      task.skip_reason,task.accepted_at,task.completed_at,
      task.delivery_status,task.delivery_status_at,task.feedback_status,task.feedback_status_at,
      task.provider_message_id,task.first_opened_at,task.first_clicked_at,task.last_event_at,
      attempt.id as attempt_id,attempt.provider_request_id,attempt.provider_env_id,
      attempt.resolved_as,attempt.resolved_at,attempt.resolution_note
    from edm.campaign_delivery_tasks task
    join edm.campaign_recipient_snapshots recipient
      on recipient.workspace_id=task.workspace_id and recipient.id=task.recipient_snapshot_id
    left join edm.campaign_delivery_attempts attempt on attempt.id=task.active_attempt_id
    where task.workspace_id=ws and task.run_id=requested_run_id
      and (
        requested_filter is null
        or (requested_filter in ('pending','processing','accepted','failed','skipped','unknown') and task.status=requested_filter)
        or (requested_filter in ('awaiting_receipt','delivered','delivery_failed','hard_bounced') and task.delivery_status=requested_filter)
        or (requested_filter in ('unsubscribed','complained') and task.feedback_status=requested_filter)
        or (requested_filter='opened' and task.first_opened_at is not null)
        or (requested_filter='clicked' and task.first_clicked_at is not null)
      )
    order by task.position limit 50 offset (page_no-1)*50
  ) item;
  return jsonb_build_object('items',result,'total',total,'page',page_no,'page_size',50);
end;
$$;

create function edm.configure_delivery_tracking(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.configure_delivery_tracking(payload); $$;

create function edm.get_campaign_delivery_statistics(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.get_campaign_delivery_statistics(payload); $$;

create function edm.get_workspace_campaign_statistics(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.get_workspace_campaign_statistics(payload); $$;

revoke all on function
  edm.configure_delivery_tracking(jsonb),
  edm.get_campaign_delivery_statistics(jsonb),
  edm.get_workspace_campaign_statistics(jsonb),
  edm_private.configure_delivery_tracking(jsonb),
  edm_private.get_campaign_delivery_statistics(jsonb),
  edm_private.get_workspace_campaign_statistics(jsonb),
  edm_private.campaign_delivery_statistics(uuid),
  edm_private.freeze_delivery_tracking()
from public,anon,authenticated;

grant execute on function
  edm.configure_delivery_tracking(jsonb),
  edm.get_campaign_delivery_statistics(jsonb),
  edm.get_workspace_campaign_statistics(jsonb),
  edm_private.configure_delivery_tracking(jsonb),
  edm_private.get_campaign_delivery_statistics(jsonb),
  edm_private.get_workspace_campaign_statistics(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on function
      edm.configure_delivery_tracking(jsonb),
      edm.get_campaign_delivery_statistics(jsonb),
      edm.get_workspace_campaign_statistics(jsonb),
      edm_private.configure_delivery_tracking(jsonb),
      edm_private.get_campaign_delivery_statistics(jsonb),
      edm_private.get_workspace_campaign_statistics(jsonb),
      edm_private.campaign_delivery_statistics(uuid),
      edm_private.freeze_delivery_tracking()
    from aigc_api;
  end if;
end $$;
