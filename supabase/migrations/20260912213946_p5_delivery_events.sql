-- P5-1 DirectMail 回执事件、状态投影、Webhook 令牌与幂等事务。
-- 仅操作 edm / edm_private；不修改共享 Auth、AIGC 或其他项目对象。

alter table edm.campaign_delivery_attempts
  rename column provider_event_id to provider_env_id;

alter table edm.campaign_delivery_tasks
  add column delivery_status text not null default 'not_applicable'
    check (delivery_status in ('not_applicable','awaiting_receipt','delivered','delivery_failed','hard_bounced')),
  add column delivery_status_at timestamptz,
  add column feedback_status text not null default 'none'
    check (feedback_status in ('none','unsubscribed','complained')),
  add column feedback_status_at timestamptz,
  add column provider_message_id text
    check (provider_message_id is null or char_length(provider_message_id)<=255),
  add column first_opened_at timestamptz,
  add column first_clicked_at timestamptz,
  add column last_event_at timestamptz;

update edm.campaign_delivery_tasks
set delivery_status=case when status='accepted' then 'awaiting_receipt' else 'not_applicable' end,
    delivery_status_at=case when status='accepted' then coalesce(accepted_at,completed_at) else null end;

create table edm_private.delivery_webhook_tokens (
  channel_id uuid primary key,
  workspace_id uuid not null,
  token_digest text not null check (token_digest ~ '^[0-9a-f]{64}$'),
  token_hint text not null check (char_length(token_hint)=4),
  token_version integer not null default 1 check (token_version>0),
  previous_token_digest text check (
    previous_token_digest is null or previous_token_digest ~ '^[0-9a-f]{64}$'
  ),
  previous_valid_until timestamptz,
  configured_at timestamptz not null default now(),
  last_authenticated_at timestamptz,
  last_event_at timestamptz,
  revoked_at timestamptz,
  unique(workspace_id,channel_id),
  foreign key(workspace_id,channel_id)
    references edm.delivery_channels(workspace_id,id) on delete cascade
);

create table edm.campaign_delivery_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references edm.workspaces(id),
  channel_id uuid not null,
  run_id uuid,
  task_id uuid,
  attempt_id uuid,
  subscription_event_id uuid,
  provider text not null default 'aliyun_directmail'
    check (provider='aliyun_directmail'),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 255),
  provider_event_type text not null check (char_length(provider_event_type) between 1 and 100),
  event_type text not null check (event_type in (
    'delivery_succeeded','delivery_failed','fbl_complaint',
    'provider_unsubscribed','provider_resubscribed','opened','clicked'
  )),
  provider_env_id text check (provider_env_id is null or char_length(provider_env_id)<=255),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id)<=255),
  sender_address text check (sender_address is null or char_length(sender_address)<=254),
  recipient_email text not null check (
    recipient_email=lower(btrim(recipient_email)) and char_length(recipient_email)<=254
  ),
  provider_status text check (provider_status is null or char_length(provider_status)<=50),
  error_code text check (error_code is null or char_length(error_code)<=100),
  failure_type text check (failure_type is null or char_length(failure_type)<=100),
  occurred_at timestamptz not null,
  provider_sent_at timestamptz,
  received_at timestamptz not null default now(),
  matched_at timestamptz,
  processed_at timestamptz,
  processing_status text not null default 'pending'
    check (processing_status in ('pending','applied','ignored','unmatched')),
  match_attempts integer not null default 0 check (match_attempts>=0),
  next_match_at timestamptz not null default now(),
  last_error_code text check (last_error_code is null or char_length(last_error_code)<=100),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  unique(channel_id,provider_event_id),
  unique(workspace_id,id),
  foreign key(workspace_id,channel_id)
    references edm.delivery_channels(workspace_id,id),
  foreign key(workspace_id,run_id)
    references edm.campaign_delivery_runs(workspace_id,id),
  foreign key(workspace_id,task_id)
    references edm.campaign_delivery_tasks(workspace_id,id),
  foreign key(workspace_id,attempt_id)
    references edm.campaign_delivery_attempts(workspace_id,id),
  foreign key(workspace_id,subscription_event_id)
    references edm.subscription_events(workspace_id,id)
);

create index campaign_delivery_events_env_idx
  on edm.campaign_delivery_events(channel_id,provider_env_id,recipient_email)
  where provider_env_id is not null;
create index campaign_delivery_events_message_idx
  on edm.campaign_delivery_events(channel_id,provider_message_id,recipient_email)
  where provider_message_id is not null;
create index campaign_delivery_events_pending_idx
  on edm.campaign_delivery_events(next_match_at,received_at)
  where processing_status='pending';
create index campaign_delivery_events_task_idx
  on edm.campaign_delivery_events(workspace_id,task_id,occurred_at desc)
  where task_id is not null;
create index campaign_delivery_events_retention_idx
  on edm.campaign_delivery_events(received_at);

alter table edm_private.delivery_webhook_tokens enable row level security;
alter table edm.campaign_delivery_events enable row level security;

create policy delivery_webhook_tokens_deny_authenticated
  on edm_private.delivery_webhook_tokens for all to authenticated
  using (false) with check (false);
create policy campaign_delivery_events_admin_read
  on edm.campaign_delivery_events for select to authenticated
  using ((select edm_private.workspace_role(workspace_id))='admin');

create function edm_private.delivery_webhook_token_matches(
  requested_channel_id uuid,
  requested_digest text
) returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(
    select 1 from edm_private.delivery_webhook_tokens token
    where token.channel_id=requested_channel_id
      and token.revoked_at is null
      and (
        token.token_digest=requested_digest
        or (
          token.previous_token_digest=requested_digest
          and token.previous_valid_until>clock_timestamp()
        )
      )
  );
$$;

create function edm_private.configure_delivery_webhook(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  digest_value text := lower(coalesce(payload->>'token_digest',''));
  hint_value text := coalesce(payload->>'token_hint','');
  expected_version integer := nullif(payload->>'expected_token_version','')::integer;
  current_row edm_private.delivery_webhook_tokens;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以配置回执 Webhook' using errcode='42501';
  end if;
  if digest_value !~ '^[0-9a-f]{64}$' or char_length(hint_value)<>4 then
    raise exception 'Webhook 令牌摘要无效';
  end if;
  if not exists(
    select 1 from edm.delivery_channels
    where workspace_id=ws and id=requested_channel_id and provider='aliyun_directmail'
  ) then raise exception '发信通道不存在'; end if;

  select * into current_row from edm_private.delivery_webhook_tokens
  where workspace_id=ws and channel_id=requested_channel_id for update;
  if found then
    if expected_version is null or expected_version<>current_row.token_version then
      raise exception 'Webhook 配置已变化，请重新加载后重试';
    end if;
    update edm_private.delivery_webhook_tokens set
      previous_token_digest=case when revoked_at is null then token_digest else null end,
      previous_valid_until=case when revoked_at is null then clock_timestamp()+interval '15 minutes' else null end,
      token_digest=digest_value,token_hint=hint_value,
      token_version=token_version+1,configured_at=clock_timestamp(),revoked_at=null
    where channel_id=requested_channel_id;
  else
    if expected_version is not null then raise exception 'Webhook 配置已变化，请重新加载后重试'; end if;
    insert into edm_private.delivery_webhook_tokens(
      channel_id,workspace_id,token_digest,token_hint
    ) values(requested_channel_id,ws,digest_value,hint_value);
  end if;
  perform edm_private.log_activity(
    ws,'delivery_webhook.configured','delivery_channel',requested_channel_id,'阿里云回执 Webhook',
    jsonb_build_object('rotated',current_row.channel_id is not null)
  );
  return edm_private.get_delivery_channel(jsonb_build_object('workspace_id',ws));
end;
$$;

create function edm_private.revoke_delivery_webhook(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  expected_version integer := (payload->>'expected_token_version')::integer;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以停用回执 Webhook' using errcode='42501';
  end if;
  update edm_private.delivery_webhook_tokens set
    revoked_at=clock_timestamp(),previous_token_digest=null,previous_valid_until=null,
    token_version=token_version+1
  where workspace_id=ws and channel_id=requested_channel_id
    and token_version=expected_version and revoked_at is null;
  if not found then raise exception 'Webhook 配置已变化，请重新加载后重试'; end if;
  perform edm_private.log_activity(
    ws,'delivery_webhook.revoked','delivery_channel',requested_channel_id,'阿里云回执 Webhook','{}'::jsonb
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

create function edm_private.webhook_authorize_delivery_event(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  requested_digest text := lower(coalesce(payload->>'token_digest',''));
  channel_row edm.delivery_channels;
begin
  if requested_digest !~ '^[0-9a-f]{64}$'
    or not edm_private.delivery_webhook_token_matches(requested_channel_id,requested_digest) then
    return null;
  end if;
  select * into channel_row from edm.delivery_channels
  where id=requested_channel_id and provider='aliyun_directmail';
  if not found then return null; end if;
  update edm_private.delivery_webhook_tokens set last_authenticated_at=clock_timestamp()
  where channel_id=requested_channel_id;
  return jsonb_build_object(
    'channel_id',channel_row.id,'workspace_id',channel_row.workspace_id,
    'region',channel_row.region,'sender_address',channel_row.sender_address
  );
end;
$$;

create function edm_private.apply_delivery_event(requested_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  event_row edm.campaign_delivery_events;
  matched_task_id uuid;
  matched_run_id uuid;
  matched_attempt_id uuid;
  candidate_count integer := 0;
  target_contact_id uuid;
  new_subscription_event_id uuid;
  suppression_reason text;
  next_status text;
  next_priority integer;
  current_priority integer;
begin
  select * into event_row from edm.campaign_delivery_events
  where id=requested_event_id for update;
  if not found then raise exception '回执事件不存在'; end if;
  if event_row.processing_status in ('applied','ignored','unmatched') then
    return jsonb_build_object('status',event_row.processing_status,'reused',true);
  end if;

  -- 投诉、退订和硬退信先进入全工作区抑制，不依赖任务是否已匹配。
  suppression_reason=case
    when event_row.event_type='fbl_complaint' then 'complained'
    when event_row.event_type='provider_unsubscribed' then 'unsubscribed'
    when event_row.event_type='delivery_failed' and event_row.provider_status='2' then 'bounced'
    when event_row.event_type='delivery_failed' and event_row.provider_status='3' then 'complained'
  end;
  if suppression_reason is not null and event_row.subscription_event_id is null then
    perform pg_advisory_xact_lock(hashtextextended(event_row.workspace_id::text||':'||event_row.recipient_email,0));
    select id into target_contact_id from edm.contacts
    where workspace_id=event_row.workspace_id and email=event_row.recipient_email;
    insert into edm.subscription_events(
      workspace_id,contact_id,email,event_type,source,note,metadata
    ) values(
      event_row.workspace_id,target_contact_id,event_row.recipient_email,suppression_reason,
      'directmail_webhook','由阿里云邮件推送回执自动记录',
      jsonb_build_object('delivery_event_id',event_row.id,'provider_event_type',event_row.provider_event_type)
    ) returning id into new_subscription_event_id;
    insert into edm.suppressions(workspace_id,email,reason,first_event_id)
    values(event_row.workspace_id,event_row.recipient_email,suppression_reason,new_subscription_event_id)
    on conflict(workspace_id,email,reason) do nothing;
    update edm.contacts set
      subscription_status=edm_private.suppression_status(event_row.workspace_id,event_row.recipient_email),
      version=version+1,updated_at=clock_timestamp()
    where workspace_id=event_row.workspace_id and email=event_row.recipient_email;
    update edm.campaign_delivery_events set subscription_event_id=new_subscription_event_id
    where id=event_row.id;
  end if;

  if event_row.provider_env_id is not null then
    select task.id,task.run_id,attempt.id into matched_task_id,matched_run_id,matched_attempt_id
    from edm.campaign_delivery_attempts attempt
    join edm.campaign_delivery_tasks task on task.id=attempt.task_id
    join edm.campaign_recipient_snapshots recipient on recipient.id=task.recipient_snapshot_id
    join edm.campaign_delivery_runs run on run.id=task.run_id
    where run.channel_id=event_row.channel_id
      and attempt.provider_env_id=event_row.provider_env_id
      and recipient.email=event_row.recipient_email
    order by attempt.provider_call_started_at desc limit 1;
  end if;
  if matched_task_id is null and event_row.provider_message_id is not null then
    select task.id,task.run_id,task.active_attempt_id into matched_task_id,matched_run_id,matched_attempt_id
    from edm.campaign_delivery_tasks task
    join edm.campaign_recipient_snapshots recipient on recipient.id=task.recipient_snapshot_id
    join edm.campaign_delivery_runs run on run.id=task.run_id
    where run.channel_id=event_row.channel_id
      and task.provider_message_id=event_row.provider_message_id
      and recipient.email=event_row.recipient_email
    order by task.accepted_at desc nulls last limit 1;
  end if;
  if matched_task_id is null and event_row.provider_sent_at is not null then
    select count(*) into candidate_count
    from edm.campaign_delivery_tasks task
    join edm.campaign_recipient_snapshots recipient on recipient.id=task.recipient_snapshot_id
    join edm.campaign_delivery_runs run on run.id=task.run_id
    join edm.campaign_delivery_attempts attempt on attempt.id=task.active_attempt_id
    where run.channel_id=event_row.channel_id and task.status='accepted'
      and recipient.email=event_row.recipient_email
      and (event_row.sender_address is null or run.sender_address=event_row.sender_address)
      and abs(extract(epoch from (attempt.provider_call_started_at-event_row.provider_sent_at)))<=600;
    if candidate_count=1 then
      select task.id,task.run_id,task.active_attempt_id
        into matched_task_id,matched_run_id,matched_attempt_id
      from edm.campaign_delivery_tasks task
      join edm.campaign_recipient_snapshots recipient on recipient.id=task.recipient_snapshot_id
      join edm.campaign_delivery_runs run on run.id=task.run_id
      join edm.campaign_delivery_attempts attempt on attempt.id=task.active_attempt_id
      where run.channel_id=event_row.channel_id and task.status='accepted'
        and recipient.email=event_row.recipient_email
        and (event_row.sender_address is null or run.sender_address=event_row.sender_address)
        and abs(extract(epoch from (attempt.provider_call_started_at-event_row.provider_sent_at)))<=600;
    else
      matched_task_id=null;matched_run_id=null;matched_attempt_id=null;
    end if;
  end if;

  if matched_task_id is null then
    if event_row.event_type='provider_resubscribed' then
      update edm.campaign_delivery_events set
        processing_status='ignored',processed_at=clock_timestamp(),
        match_attempts=match_attempts+1,last_error_code=null
      where id=event_row.id;
      return jsonb_build_object('status','ignored','matched',false);
    end if;
    update edm.campaign_delivery_events set
      match_attempts=match_attempts+1,
      processing_status=case when received_at<=clock_timestamp()-interval '30 days' then 'unmatched' else 'pending' end,
      next_match_at=clock_timestamp()+case
        when match_attempts=0 then interval '1 minute'
        when match_attempts=1 then interval '5 minutes'
        when match_attempts=2 then interval '30 minutes'
        else interval '6 hours' end,
      last_error_code='DELIVERY_TASK_NOT_MATCHED'
    where id=event_row.id;
    return jsonb_build_object('status','pending','matched',false);
  end if;

  update edm.campaign_delivery_events set
    task_id=matched_task_id,run_id=matched_run_id,attempt_id=matched_attempt_id,
    matched_at=coalesce(matched_at,clock_timestamp()),last_error_code=null
  where id=event_row.id;

  update edm.campaign_delivery_tasks set
    provider_message_id=coalesce(provider_message_id,event_row.provider_message_id),
    first_opened_at=case when event_row.event_type='opened' then
      least(coalesce(first_opened_at,event_row.occurred_at),event_row.occurred_at) else first_opened_at end,
    first_clicked_at=case when event_row.event_type='clicked' then
      least(coalesce(first_clicked_at,event_row.occurred_at),event_row.occurred_at) else first_clicked_at end,
    last_event_at=greatest(coalesce(last_event_at,event_row.occurred_at),event_row.occurred_at)
  where id=matched_task_id;

  if event_row.event_type in ('delivery_succeeded','delivery_failed') then
    next_status=case
      when event_row.event_type='delivery_succeeded' then 'delivered'
      when event_row.provider_status='2' then 'hard_bounced'
      else 'delivery_failed' end;
    next_priority=case next_status when 'hard_bounced' then 4 when 'delivery_failed' then 3 else 2 end;
    select case delivery_status
      when 'hard_bounced' then 4 when 'delivery_failed' then 3
      when 'delivered' then 2 when 'awaiting_receipt' then 1 else 0 end
    into current_priority from edm.campaign_delivery_tasks where id=matched_task_id;
    update edm.campaign_delivery_tasks set
      delivery_status=next_status,delivery_status_at=event_row.occurred_at
    where id=matched_task_id and (
      delivery_status_at is null or event_row.occurred_at>delivery_status_at
      or (event_row.occurred_at=delivery_status_at and next_priority>=current_priority)
    );
  end if;

  if event_row.event_type in ('fbl_complaint','provider_unsubscribed')
    or (event_row.event_type='delivery_failed' and event_row.provider_status='3') then
    next_status=case
      when event_row.event_type='fbl_complaint' or event_row.provider_status='3' then 'complained'
      else 'unsubscribed' end;
    next_priority=case next_status when 'complained' then 2 else 1 end;
    select case feedback_status when 'complained' then 2 when 'unsubscribed' then 1 else 0 end
    into current_priority from edm.campaign_delivery_tasks where id=matched_task_id;
    update edm.campaign_delivery_tasks set
      feedback_status=next_status,feedback_status_at=event_row.occurred_at
    where id=matched_task_id and (
      feedback_status_at is null or event_row.occurred_at>feedback_status_at
      or (event_row.occurred_at=feedback_status_at and next_priority>=current_priority)
    );
  end if;

  update edm.campaign_delivery_events set
    processing_status=case when event_type='provider_resubscribed' then 'ignored' else 'applied' end,
    processed_at=clock_timestamp(),match_attempts=match_attempts+1
  where id=event_row.id;
  update edm_private.delivery_webhook_tokens set last_event_at=clock_timestamp()
  where channel_id=event_row.channel_id;
  return jsonb_build_object(
    'status',case when event_row.event_type='provider_resubscribed' then 'ignored' else 'applied' end,
    'matched',true,'task_id',matched_task_id
  );
end;
$$;

create function edm_private.webhook_ingest_delivery_event(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  requested_digest text := lower(coalesce(payload->>'token_digest',''));
  channel_row edm.delivery_channels;
  existing_row edm.campaign_delivery_events;
  new_event_id uuid;
  result jsonb;
begin
  if requested_digest !~ '^[0-9a-f]{64}$'
    or not edm_private.delivery_webhook_token_matches(requested_channel_id,requested_digest) then
    raise exception 'WEBHOOK_UNAUTHORIZED' using errcode='42501';
  end if;
  select * into channel_row from edm.delivery_channels
  where id=requested_channel_id and provider='aliyun_directmail';
  if not found then raise exception 'WEBHOOK_CHANNEL_NOT_FOUND'; end if;
  if char_length(coalesce(payload->>'provider_event_id','')) not between 1 and 255
    or char_length(coalesce(payload->>'provider_event_type','')) not between 1 and 100
    or lower(btrim(coalesce(payload->>'recipient_email',''))) !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or char_length(payload->>'recipient_email')>254
    or coalesce(payload->>'payload_sha256','') !~ '^[0-9a-f]{64}$'
    or payload->>'event_type' not in (
      'delivery_succeeded','delivery_failed','fbl_complaint',
      'provider_unsubscribed','provider_resubscribed','opened','clicked'
    ) then raise exception 'WEBHOOK_EVENT_INVALID'; end if;

  insert into edm.campaign_delivery_events(
    workspace_id,channel_id,provider_event_id,provider_event_type,event_type,
    provider_env_id,provider_message_id,sender_address,recipient_email,
    provider_status,error_code,failure_type,occurred_at,provider_sent_at,payload_sha256
  ) values(
    channel_row.workspace_id,channel_row.id,payload->>'provider_event_id',
    payload->>'provider_event_type',payload->>'event_type',
    left(nullif(payload->>'provider_env_id',''),255),left(nullif(payload->>'provider_message_id',''),255),
    lower(left(nullif(payload->>'sender_address',''),254)),lower(left(payload->>'recipient_email',254)),
    left(nullif(payload->>'provider_status',''),50),left(nullif(payload->>'error_code',''),100),
    left(nullif(payload->>'failure_type',''),100),(payload->>'occurred_at')::timestamptz,
    nullif(payload->>'provider_sent_at','')::timestamptz,payload->>'payload_sha256'
  ) on conflict(channel_id,provider_event_id) do nothing returning id into new_event_id;
  if new_event_id is null then
    select * into existing_row from edm.campaign_delivery_events
    where channel_id=requested_channel_id and provider_event_id=payload->>'provider_event_id' for update;
    if existing_row.payload_sha256<>payload->>'payload_sha256' then
      raise exception 'WEBHOOK_EVENT_ID_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object(
      'event_id',existing_row.id,'status',existing_row.processing_status,'duplicate',true
    );
  end if;
  update edm_private.delivery_webhook_tokens set last_event_at=clock_timestamp()
  where channel_id=requested_channel_id;
  result=edm_private.apply_delivery_event(new_event_id);
  return result||jsonb_build_object('event_id',new_event_id,'duplicate',false);
end;
$$;

create function edm_private.worker_reconcile_delivery_events(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  requested_limit integer := least(greatest(coalesce((payload->>'limit')::integer,100),1),100);
  event_id uuid;
  processed integer := 0;
begin
  for event_id in
    select id from edm.campaign_delivery_events
    where processing_status='pending' and next_match_at<=clock_timestamp()
    order by next_match_at,received_at for update skip locked limit requested_limit
  loop
    perform edm_private.apply_delivery_event(event_id);
    processed=processed+1;
  end loop;
  return jsonb_build_object('processed',processed);
end;
$$;

create function edm_private.worker_cleanup_delivery_events(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare deleted_count integer;
begin
  delete from edm.campaign_delivery_events
  where received_at<clock_timestamp()-interval '180 days';
  get diagnostics deleted_count=row_count;
  return jsonb_build_object('deleted',deleted_count);
end;
$$;

create function edm_private.set_delivery_receipt_state() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status='accepted' and old.status is distinct from 'accepted'
    and new.delivery_status='not_applicable' then
    new.delivery_status='awaiting_receipt';
    new.delivery_status_at=coalesce(new.accepted_at,clock_timestamp());
  end if;
  return new;
end;
$$;
create trigger campaign_delivery_tasks_receipt_state
  before update on edm.campaign_delivery_tasks
  for each row execute function edm_private.set_delivery_receipt_state();

create or replace function edm_private.worker_complete_delivery_task(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  requested_task_id uuid := (payload->>'task_id')::uuid;
  requested_attempt_id uuid := (payload->>'attempt_id')::uuid;
  requested_lease uuid := (payload->>'lease_token')::uuid;
  result_status text := payload->>'status';
  category text := nullif(payload->>'error_category','');
  code text := left(nullif(payload->>'error_code',''),100);
  task_row edm.campaign_delivery_tasks;
  run_row edm.campaign_delivery_runs;
  next_retry timestamptz;
  next_task_status text;
  final_status text;
begin
  if result_status not in ('accepted','failed','unknown') then raise exception '发送结果无效'; end if;
  select * into task_row from edm.campaign_delivery_tasks where id=requested_task_id for update;
  if not found then raise exception '正式发送任务不存在'; end if;
  if task_row.status<>'processing' or task_row.active_attempt_id<>requested_attempt_id
    or task_row.lease_token<>requested_lease then
    return jsonb_build_object('task_id',task_row.id,'status',task_row.status,'reused',true);
  end if;
  select * into run_row from edm.campaign_delivery_runs where id=task_row.run_id for update;
  update edm.campaign_delivery_attempts set status=result_status,completed_at=clock_timestamp(),
    provider_request_id=left(nullif(payload->>'provider_request_id',''),255),
    provider_env_id=left(nullif(payload->>'provider_env_id',''),255),
    error_category=category,error_code=code where id=requested_attempt_id;
  if result_status='failed' and category in ('rate_limit','temporary') and task_row.attempt_count<4 then
    next_retry=clock_timestamp()+case task_row.attempt_count
      when 1 then interval '30 seconds' when 2 then interval '2 minutes' else interval '10 minutes' end;
    next_task_status='pending';
    update edm.campaign_delivery_tasks set status='pending',next_attempt_at=next_retry,
      lease_token=null,lease_expires_at=null,error_category=category,error_code=code,
      version=version+1 where id=task_row.id;
  else
    next_task_status=result_status;
    update edm.campaign_delivery_tasks set status=result_status,
      lease_token=null,lease_expires_at=null,error_category=category,error_code=code,
      accepted_at=case when result_status='accepted' then clock_timestamp() else null end,
      completed_at=clock_timestamp(),version=version+1 where id=task_row.id;
  end if;
  if result_status='failed' and category in ('authentication','configuration') then
    update edm.campaign_delivery_runs set status='paused',pause_reason='channel_'||category,
      paused_at=clock_timestamp(),version=version+1 where id=run_row.id;
    update edm.campaigns set status='paused',updated_at=clock_timestamp(),version=version+1
      where workspace_id=run_row.workspace_id and id=run_row.campaign_id;
    perform edm_private.log_activity(run_row.workspace_id,'campaign.delivery_paused','campaign',
      run_row.campaign_id,null,jsonb_build_object(
        'run_id',run_row.id,'reason','channel_'||category,'error_code',code
      ),'campaign-delivery-auto-paused:'||requested_attempt_id::text,true);
    final_status='paused';
  else
    final_status=edm_private.finalize_campaign_delivery(run_row.id);
  end if;
  return jsonb_build_object(
    'task_id',task_row.id,'task_status',next_task_status,
    'run_status',final_status,'next_attempt_at',next_retry,'reused',false
  );
end;
$$;

create or replace function edm_private.list_campaign_delivery_tasks(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_run_id uuid := (payload->>'run_id')::uuid;
  requested_status text := nullif(payload->>'status','');
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
  if not exists(select 1 from edm.campaign_delivery_runs where workspace_id=ws and id=requested_run_id) then
    raise exception '正式发送任务不存在';
  end if;
  select count(*) into total from edm.campaign_delivery_tasks task
  where task.workspace_id=ws and task.run_id=requested_run_id
    and (requested_status is null or task.status=requested_status);
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
      and (requested_status is null or task.status=requested_status)
    order by task.position limit 50 offset (page_no-1)*50
  ) item;
  return jsonb_build_object('items',result,'total',total,'page',page_no,'page_size',50);
end;
$$;

create function edm.configure_delivery_webhook(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.configure_delivery_webhook(payload); $$;
create function edm.revoke_delivery_webhook(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.revoke_delivery_webhook(payload); $$;
create function edm.webhook_authorize_delivery_event(payload jsonb) returns jsonb
language sql security definer set search_path=''
as $$ select edm_private.webhook_authorize_delivery_event(payload); $$;
create function edm.webhook_ingest_delivery_event(payload jsonb) returns jsonb
language sql security definer set search_path=''
as $$ select edm_private.webhook_ingest_delivery_event(payload); $$;
create function edm.worker_reconcile_delivery_events(payload jsonb) returns jsonb
language sql security definer set search_path=''
as $$ select edm_private.worker_reconcile_delivery_events(payload); $$;
create function edm.worker_cleanup_delivery_events(payload jsonb) returns jsonb
language sql security definer set search_path=''
as $$ select edm_private.worker_cleanup_delivery_events(payload); $$;

revoke all on edm.campaign_delivery_events,edm_private.delivery_webhook_tokens
from public,anon,authenticated;
revoke all on function
  edm.configure_delivery_webhook(jsonb),edm.revoke_delivery_webhook(jsonb),
  edm.webhook_authorize_delivery_event(jsonb),edm.webhook_ingest_delivery_event(jsonb),
  edm.worker_reconcile_delivery_events(jsonb),edm.worker_cleanup_delivery_events(jsonb),
  edm_private.configure_delivery_webhook(jsonb),edm_private.revoke_delivery_webhook(jsonb),
  edm_private.webhook_authorize_delivery_event(jsonb),edm_private.webhook_ingest_delivery_event(jsonb),
  edm_private.worker_reconcile_delivery_events(jsonb),edm_private.worker_cleanup_delivery_events(jsonb),
  edm_private.apply_delivery_event(uuid),edm_private.delivery_webhook_token_matches(uuid,text)
from public,anon,authenticated;
grant execute on function
  edm.configure_delivery_webhook(jsonb),edm.revoke_delivery_webhook(jsonb),
  edm_private.configure_delivery_webhook(jsonb),edm_private.revoke_delivery_webhook(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function
      edm.webhook_authorize_delivery_event(jsonb),edm.webhook_ingest_delivery_event(jsonb),
      edm.worker_reconcile_delivery_events(jsonb),edm.worker_cleanup_delivery_events(jsonb)
    to service_role;
  end if;
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.campaign_delivery_events,edm_private.delivery_webhook_tokens from aigc_api;
    revoke all on function
      edm.configure_delivery_webhook(jsonb),edm.revoke_delivery_webhook(jsonb),
      edm.webhook_authorize_delivery_event(jsonb),edm.webhook_ingest_delivery_event(jsonb),
      edm.worker_reconcile_delivery_events(jsonb),edm.worker_cleanup_delivery_events(jsonb)
    from aigc_api;
  end if;
end $$;
