-- P4-3 正式活动发送、持久任务队列、租约恢复与人工核对。
-- 仅创建或修改 EDM 对象，不启用共享扩展，不修改 AIGC 或共享 Auth。

alter table edm.campaigns drop constraint campaigns_status_check;
alter table edm.campaigns add constraint campaigns_status_check check (
  status in (
    'draft','confirmed','queued','sending','paused','needs_review',
    'completed','completed_with_errors','failed'
  )
);

alter table edm.campaign_recipient_snapshots
  add constraint campaign_recipient_snapshots_workspace_id_key
  unique(workspace_id,id);

create table edm.campaign_delivery_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  snapshot_id uuid not null,
  channel_id uuid not null,
  idempotency_key uuid not null,
  status text not null default 'queued' check (
    status in (
      'queued','sending','paused','needs_review',
      'completed','completed_with_errors','failed'
    )
  ),
  region text not null check (
    region in ('cn-hangzhou','ap-southeast-1','us-east-1','eu-central-1')
  ),
  sender_address text not null,
  sender_alias text not null,
  reply_to_address text,
  channel_version integer not null check (channel_version>0),
  credential_version integer not null check (credential_version>0),
  recipient_count integer not null check (recipient_count between 1 and 500),
  started_by uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  paused_at timestamptz,
  pause_reason text check (pause_reason is null or char_length(pause_reason)<=100),
  resumed_at timestamptz,
  aborted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  version integer not null default 1 check (version>0),
  unique(workspace_id,id),
  unique(workspace_id,campaign_id),
  unique(workspace_id,idempotency_key),
  foreign key(workspace_id,campaign_id)
    references edm.campaigns(workspace_id,id),
  foreign key(workspace_id,snapshot_id)
    references edm.campaign_snapshots(workspace_id,id),
  foreign key(workspace_id,channel_id)
    references edm.delivery_channels(workspace_id,id),
  foreign key(workspace_id,started_by)
    references edm.workspace_members(workspace_id,user_id)
);

create table edm.campaign_delivery_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_id uuid not null,
  recipient_snapshot_id uuid not null,
  position integer not null check (position between 1 and 500),
  status text not null default 'pending' check (
    status in ('pending','processing','accepted','failed','skipped','unknown')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 4),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  active_attempt_id uuid,
  skip_reason text check (skip_reason is null or char_length(skip_reason)<=100),
  error_category text check (
    error_category is null or error_category in (
      'authentication','configuration','rate_limit','temporary','permanent','unknown'
    )
  ),
  error_code text check (error_code is null or char_length(error_code)<=100),
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  version integer not null default 1 check (version>0),
  unique(workspace_id,id),
  unique(run_id,recipient_snapshot_id),
  unique(run_id,position),
  foreign key(workspace_id,run_id)
    references edm.campaign_delivery_runs(workspace_id,id),
  foreign key(workspace_id,recipient_snapshot_id)
    references edm.campaign_recipient_snapshots(workspace_id,id)
);

create table edm.campaign_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_id uuid not null,
  task_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 4),
  credential_version integer not null check (credential_version>0),
  status text not null default 'processing'
    check (status in ('processing','accepted','failed','unknown')),
  provider_call_started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  provider_request_id text check (
    provider_request_id is null or char_length(provider_request_id)<=255
  ),
  provider_event_id text check (
    provider_event_id is null or char_length(provider_event_id)<=255
  ),
  error_category text check (
    error_category is null or error_category in (
      'authentication','configuration','rate_limit','temporary','permanent','unknown'
    )
  ),
  error_code text check (error_code is null or char_length(error_code)<=100),
  resolved_as text check (resolved_as is null or resolved_as in ('accepted','failed')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text check (
    resolution_note is null or char_length(resolution_note) between 10 and 500
  ),
  created_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,id),
  unique(task_id,attempt_number),
  foreign key(workspace_id,run_id)
    references edm.campaign_delivery_runs(workspace_id,id),
  foreign key(workspace_id,task_id)
    references edm.campaign_delivery_tasks(workspace_id,id),
  foreign key(workspace_id,resolved_by)
    references edm.workspace_members(workspace_id,user_id)
);

alter table edm.campaign_delivery_tasks add constraint campaign_delivery_tasks_active_attempt_fk
  foreign key(workspace_id,active_attempt_id)
  references edm.campaign_delivery_attempts(workspace_id,id)
  deferrable initially deferred;

create index campaign_delivery_runs_status_idx
  on edm.campaign_delivery_runs(status,updated_at);
create index campaign_delivery_runs_started_by_idx
  on edm.campaign_delivery_runs(workspace_id,started_by);
create index campaign_delivery_runs_channel_idx
  on edm.campaign_delivery_runs(workspace_id,channel_id,status);
create index campaign_delivery_tasks_ready_idx
  on edm.campaign_delivery_tasks(next_attempt_at,position)
  where status='pending';
create index campaign_delivery_tasks_lease_idx
  on edm.campaign_delivery_tasks(lease_expires_at)
  where status='processing';
create index campaign_delivery_tasks_run_idx
  on edm.campaign_delivery_tasks(workspace_id,run_id,position);
create index campaign_delivery_attempts_daily_idx
  on edm.campaign_delivery_attempts(workspace_id,provider_call_started_at);
create index campaign_delivery_attempts_task_idx
  on edm.campaign_delivery_attempts(workspace_id,task_id,attempt_number desc);
create index campaign_delivery_attempts_unknown_idx
  on edm.campaign_delivery_attempts(run_id,provider_call_started_at)
  where status='unknown' and resolved_as is null;

alter table edm.campaign_delivery_runs enable row level security;
alter table edm.campaign_delivery_tasks enable row level security;
alter table edm.campaign_delivery_attempts enable row level security;

create policy campaign_delivery_runs_member_read on edm.campaign_delivery_runs
  for select to authenticated
  using ((select edm_private.workspace_role(workspace_id)) is not null);
create policy campaign_delivery_tasks_admin_read on edm.campaign_delivery_tasks
  for select to authenticated
  using ((select edm_private.workspace_role(workspace_id))='admin');
create policy campaign_delivery_attempts_admin_read on edm.campaign_delivery_attempts
  for select to authenticated
  using ((select edm_private.workspace_role(workspace_id))='admin');

create trigger campaign_delivery_runs_updated
  before update on edm.campaign_delivery_runs
  for each row execute function edm_private.touch_updated_at();
create trigger campaign_delivery_tasks_updated
  before update on edm.campaign_delivery_tasks
  for each row execute function edm_private.touch_updated_at();

create function edm_private.delivery_counts(requested_run_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'pending',count(*) filter(where task.status='pending'),
    'processing',count(*) filter(where task.status='processing'),
    'accepted',count(*) filter(where task.status='accepted'),
    'failed',count(*) filter(where task.status='failed'),
    'skipped',count(*) filter(where task.status='skipped'),
    'unknown',count(*) filter(where task.status='unknown')
  )
  from edm.campaign_delivery_tasks task
  where task.run_id=requested_run_id;
$$;

create function edm_private.finalize_campaign_delivery(requested_run_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare
  run_row edm.campaign_delivery_runs;
  counts jsonb;
  next_status text;
  waiting integer;
  accepted_count integer;
  failed_count integer;
  skipped_count integer;
  unknown_count integer;
begin
  select * into run_row from edm.campaign_delivery_runs
  where id=requested_run_id for update;
  if not found then raise exception '正式发送任务不存在'; end if;

  counts=edm_private.delivery_counts(run_row.id);
  waiting=(counts->>'pending')::integer+(counts->>'processing')::integer;
  accepted_count=(counts->>'accepted')::integer;
  failed_count=(counts->>'failed')::integer;
  skipped_count=(counts->>'skipped')::integer;
  unknown_count=(counts->>'unknown')::integer;

  if run_row.status='paused' and run_row.aborted_at is null then
    return run_row.status;
  end if;
  if waiting>0 then
    next_status=case when accepted_count=0 then 'queued' else 'sending' end;
  elsif unknown_count>0 then
    next_status='needs_review';
  elsif accepted_count=run_row.recipient_count then
    next_status='completed';
  elsif accepted_count=0 and failed_count>0 then
    next_status='failed';
  else
    next_status='completed_with_errors';
  end if;

  update edm.campaign_delivery_runs set
    status=next_status,
    completed_at=case when next_status in ('completed','completed_with_errors','failed')
      then coalesce(completed_at,clock_timestamp()) else null end,
    version=version+case when status<>next_status then 1 else 0 end
  where id=run_row.id;
  update edm.campaigns set
    status=next_status,
    updated_at=clock_timestamp(),
    version=version+case when status<>next_status then 1 else 0 end
  where workspace_id=run_row.workspace_id and id=run_row.campaign_id;

  if next_status in ('completed','completed_with_errors','failed')
    and run_row.status not in ('completed','completed_with_errors','failed') then
    perform edm_private.log_activity(
      run_row.workspace_id,'campaign.delivery_completed','campaign',
      run_row.campaign_id,null,
      jsonb_build_object('run_id',run_row.id,'status',next_status,'counts',counts),
      'campaign-delivery-completed:'||run_row.id::text,true
    );
  end if;
  return next_status;
end;
$$;

create function edm_private.start_campaign_delivery(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_campaign_id uuid := (payload->>'campaign_id')::uuid;
  requested_key uuid := (payload->>'idempotency_key')::uuid;
  expected_version integer := (payload->>'expected_version')::integer;
  confirmed_name text := btrim(coalesce(payload->>'confirmation_name',''));
  campaign_row edm.campaigns;
  snapshot_row edm.campaign_snapshots;
  channel_row edm.delivery_channels;
  existing_run edm.campaign_delivery_runs;
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
  if snapshot_row.recipient_count>500 then raise exception '正式发送每个活动最多 500 位收件人'; end if;

  select * into channel_row from edm.delivery_channels
  where workspace_id=ws and provider='aliyun_directmail' for update;
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
    region,sender_address,sender_alias,reply_to_address,
    channel_version,credential_version,recipient_count,started_by
  ) values(
    ws,campaign_row.id,snapshot_row.id,channel_row.id,requested_key,
    channel_row.region,channel_row.sender_address,channel_row.sender_alias,
    channel_row.reply_to_address,channel_row.version,channel_row.credential_version,
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
      'channel_id',channel_row.id,'recipient_count',snapshot_row.recipient_count,
      'sender_domain',split_part(channel_row.sender_address,'@',2)
    ),'campaign-delivery-started:'||campaign_row.id::text
  );
  return jsonb_build_object('run_id',new_run_id,'status','queued','reused',false);
end;
$$;

create function edm_private.set_campaign_delivery_paused(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_run_id uuid := (payload->>'run_id')::uuid;
  expected_version integer := (payload->>'expected_version')::integer;
  should_pause boolean := (payload->>'paused')::boolean;
  run_row edm.campaign_delivery_runs;
  channel_row edm.delivery_channels;
  next_status text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以暂停或继续发送' using errcode='42501';
  end if;
  if jsonb_typeof(payload->'paused') is distinct from 'boolean' then raise exception '暂停状态无效'; end if;
  select * into run_row from edm.campaign_delivery_runs
  where workspace_id=ws and id=requested_run_id for update;
  if not found then raise exception '正式发送任务不存在'; end if;
  if run_row.version<>expected_version then raise exception '发送状态已变化，请重新加载后重试'; end if;

  if should_pause then
    if run_row.status not in ('queued','sending') then raise exception '当前发送状态不能暂停'; end if;
    update edm.campaign_delivery_runs set status='paused',paused_at=clock_timestamp(),
      pause_reason='operator_paused',version=version+1 where id=run_row.id;
    update edm.campaigns set status='paused',updated_at=clock_timestamp(),version=version+1
      where workspace_id=ws and id=run_row.campaign_id;
    next_status='paused';
    perform edm_private.log_activity(ws,'campaign.delivery_paused','campaign',run_row.campaign_id,null,
      jsonb_build_object('run_id',run_row.id),'campaign-delivery-paused:'||run_row.id::text||':'||(run_row.version+1)::text);
  else
    if run_row.status<>'paused' or run_row.aborted_at is not null then raise exception '当前发送状态不能继续'; end if;
    select * into channel_row from edm.delivery_channels
      where workspace_id=ws and id=run_row.channel_id for update;
    if not found or channel_row.status<>'verified' then raise exception '请先重新验证发信通道'; end if;
    if channel_row.region<>run_row.region
      or channel_row.sender_address<>run_row.sender_address
      or channel_row.sender_alias<>run_row.sender_alias
      or channel_row.reply_to_address is distinct from run_row.reply_to_address then
      raise exception '进行中的活动不能更换发件身份';
    end if;
    if not exists(
      select 1 from edm_private.delivery_channel_credentials credential
      where credential.workspace_id=ws and credential.channel_id=channel_row.id
        and credential.credential_version=channel_row.credential_version
    ) then raise exception '发信通道凭据不存在'; end if;
    next_status=case when exists(
      select 1 from edm.campaign_delivery_tasks where run_id=run_row.id and status='accepted'
    ) then 'sending' else 'queued' end;
    update edm.campaign_delivery_runs set status=next_status,pause_reason=null,
      resumed_at=clock_timestamp(),credential_version=channel_row.credential_version,
      version=version+1 where id=run_row.id;
    update edm.campaigns set status=next_status,updated_at=clock_timestamp(),version=version+1
      where workspace_id=ws and id=run_row.campaign_id;
    perform edm_private.log_activity(ws,'campaign.delivery_resumed','campaign',run_row.campaign_id,null,
      jsonb_build_object('run_id',run_row.id,'credential_version',channel_row.credential_version),
      'campaign-delivery-resumed:'||run_row.id::text||':'||(run_row.version+1)::text);
  end if;
  return jsonb_build_object('run_id',run_row.id,'status',next_status,'version',run_row.version+1);
end;
$$;

create function edm_private.abort_campaign_delivery(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_run_id uuid := (payload->>'run_id')::uuid;
  expected_version integer := (payload->>'expected_version')::integer;
  confirmed_name text := btrim(coalesce(payload->>'confirmation_name',''));
  run_row edm.campaign_delivery_runs;
  snapshot_row edm.campaign_snapshots;
  skipped_count integer;
  final_status text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以放弃剩余任务' using errcode='42501';
  end if;
  select * into run_row from edm.campaign_delivery_runs
    where workspace_id=ws and id=requested_run_id for update;
  if not found then raise exception '正式发送任务不存在'; end if;
  if run_row.version<>expected_version then raise exception '发送状态已变化，请重新加载后重试'; end if;
  if run_row.status not in ('queued','paused') then raise exception '当前发送状态不能放弃剩余任务'; end if;
  select * into snapshot_row from edm.campaign_snapshots
    where workspace_id=ws and id=run_row.snapshot_id;
  if confirmed_name<>snapshot_row.campaign_name then raise exception '请输入完整活动名称确认放弃'; end if;

  update edm.campaign_delivery_tasks set status='skipped',skip_reason='operator_aborted',
    completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null,version=version+1
  where run_id=run_row.id and status='pending';
  get diagnostics skipped_count=row_count;
  update edm.campaign_delivery_runs set aborted_at=clock_timestamp(),pause_reason=null,
    status='sending',version=version+1 where id=run_row.id;
  perform edm_private.log_activity(ws,'campaign.delivery_aborted','campaign',run_row.campaign_id,
    snapshot_row.campaign_name,jsonb_build_object('run_id',run_row.id,'skipped_count',skipped_count));
  final_status=edm_private.finalize_campaign_delivery(run_row.id);
  return jsonb_build_object('run_id',run_row.id,'status',final_status,'skipped_count',skipped_count);
end;
$$;

create function edm_private.get_campaign_delivery_summaries(payload jsonb) returns jsonb
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
      'counts',edm_private.delivery_counts(run.id)
    ) item
    from edm.campaign_delivery_runs run
    where run.workspace_id=ws and run.campaign_id=any(ids)
  ) summaries;
  return result;
end;
$$;

create function edm_private.list_campaign_delivery_tasks(payload jsonb) returns jsonb
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
      attempt.id as attempt_id,attempt.provider_request_id,attempt.provider_event_id,
      attempt.resolved_as,attempt.resolved_at,attempt.resolution_note
    from edm.campaign_delivery_tasks task
    join edm.campaign_recipient_snapshots recipient
      on recipient.workspace_id=task.workspace_id and recipient.id=task.recipient_snapshot_id
    left join edm.campaign_delivery_attempts attempt on attempt.id=task.active_attempt_id
    where task.workspace_id=ws and task.run_id=requested_run_id
      and (requested_status is null or task.status=requested_status)
    order by task.position
    limit 50 offset (page_no-1)*50
  ) item;
  return jsonb_build_object('items',result,'total',total,'page',page_no,'page_size',50);
end;
$$;

create function edm_private.resolve_delivery_unknown(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_task_id uuid := (payload->>'task_id')::uuid;
  resolution text := payload->>'resolution';
  note text := btrim(coalesce(payload->>'note',''));
  task_row edm.campaign_delivery_tasks;
  run_row edm.campaign_delivery_runs;
  attempt_row edm.campaign_delivery_attempts;
  final_status text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以核对未知结果' using errcode='42501';
  end if;
  if resolution not in ('accepted','failed') then raise exception '核对结果无效'; end if;
  if char_length(note) not between 10 and 500 then raise exception '核对说明须为 10 至 500 字'; end if;
  select * into task_row from edm.campaign_delivery_tasks
    where workspace_id=ws and id=requested_task_id for update;
  if not found or task_row.status<>'unknown' then raise exception '该任务不需要人工核对'; end if;
  select * into run_row from edm.campaign_delivery_runs where id=task_row.run_id for update;
  select * into attempt_row from edm.campaign_delivery_attempts
    where id=task_row.active_attempt_id for update;
  if not found or attempt_row.status<>'unknown' or attempt_row.resolved_as is not null then
    raise exception '未知结果记录不存在或已处理';
  end if;
  update edm.campaign_delivery_attempts set resolved_as=resolution,resolved_by=auth.uid(),
    resolved_at=clock_timestamp(),resolution_note=note where id=attempt_row.id;
  update edm.campaign_delivery_tasks set status=resolution,
    error_category=case when resolution='failed' then 'unknown' else null end,
    error_code=case when resolution='failed' then 'MANUALLY_RESOLVED_FAILED' else null end,
    accepted_at=case when resolution='accepted' then clock_timestamp() else null end,
    completed_at=clock_timestamp(),version=version+1 where id=task_row.id;
  perform edm_private.log_activity(ws,'campaign.delivery_unknown_resolved','campaign',
    run_row.campaign_id,null,jsonb_build_object(
      'run_id',run_row.id,'task_id',task_row.id,'resolution',resolution
    ));
  final_status=edm_private.finalize_campaign_delivery(run_row.id);
  return jsonb_build_object('run_id',run_row.id,'status',final_status,'task_id',task_row.id);
end;
$$;

create function edm_private.worker_recover_expired_delivery_leases() returns integer
language plpgsql security definer set search_path='' as $$
declare
  task_row edm.campaign_delivery_tasks;
  recovered integer := 0;
begin
  for task_row in
    select * from edm.campaign_delivery_tasks
    where status='processing' and lease_expires_at<clock_timestamp()
    for update skip locked
  loop
    update edm.campaign_delivery_attempts set status='unknown',completed_at=clock_timestamp(),
      error_category='unknown',error_code='WORKER_LEASE_EXPIRED'
    where id=task_row.active_attempt_id and status='processing';
    update edm.campaign_delivery_tasks set status='unknown',lease_token=null,
      lease_expires_at=null,error_category='unknown',error_code='WORKER_LEASE_EXPIRED',
      completed_at=clock_timestamp(),version=version+1 where id=task_row.id;
    perform edm_private.finalize_campaign_delivery(task_row.run_id);
    recovered=recovered+1;
  end loop;
  return recovered;
end;
$$;

create function edm_private.worker_claim_delivery_batch(payload jsonb) returns jsonb
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
      'channel',jsonb_build_object(
        'id',channel_row.id,'region',run_row.region,'sender_address',run_row.sender_address,
        'sender_alias',run_row.sender_alias,'reply_to_address',run_row.reply_to_address,
        'credential_version',run_row.credential_version
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

create function edm_private.worker_complete_delivery_task(payload jsonb) returns jsonb
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
  select * into task_row from edm.campaign_delivery_tasks
    where id=requested_task_id for update;
  if not found then raise exception '正式发送任务不存在'; end if;
  if task_row.status<>'processing' or task_row.active_attempt_id<>requested_attempt_id
    or task_row.lease_token<>requested_lease then
    return jsonb_build_object('task_id',task_row.id,'status',task_row.status,'reused',true);
  end if;
  select * into run_row from edm.campaign_delivery_runs where id=task_row.run_id for update;

  update edm.campaign_delivery_attempts set status=result_status,completed_at=clock_timestamp(),
    provider_request_id=left(nullif(payload->>'provider_request_id',''),255),
    provider_event_id=left(nullif(payload->>'provider_event_id',''),255),
    error_category=category,error_code=code where id=requested_attempt_id;

  if result_status='failed' and category in ('rate_limit','temporary') and task_row.attempt_count<4 then
    next_retry=clock_timestamp()+case task_row.attempt_count
      when 1 then interval '30 seconds'
      when 2 then interval '2 minutes'
      else interval '10 minutes' end;
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

create function edm_private.guard_active_campaign_delivery_channel() returns trigger
language plpgsql set search_path='' as $$
declare
  has_active boolean;
  all_paused boolean;
begin
  select exists(
    select 1 from edm.campaign_delivery_runs run
    where run.workspace_id=old.workspace_id and run.channel_id=old.id
      and run.status in ('queued','sending','paused','needs_review')
  ),not exists(
    select 1 from edm.campaign_delivery_runs run
    where run.workspace_id=old.workspace_id and run.channel_id=old.id
      and run.status in ('queued','sending','needs_review')
  ) into has_active,all_paused;
  if not has_active then return new; end if;
  if new.status='disconnected' or new.disconnected_at is not null then
    raise exception '请先结束使用该通道的正式发送任务';
  end if;
  if new.region<>old.region
    or new.sender_domain<>old.sender_domain
    or new.sender_address<>old.sender_address
    or new.sender_alias<>old.sender_alias
    or new.reply_to_address is distinct from old.reply_to_address then
    raise exception '进行中的活动不能更换发件身份';
  end if;
  if not all_paused and (
    new.credential_version<>old.credential_version
    or new.status<>old.status
  ) then raise exception '请先暂停正式发送再更新通道凭据'; end if;
  return new;
end;
$$;

create trigger delivery_channels_active_campaign_guard
  before update on edm.delivery_channels
  for each row execute function edm_private.guard_active_campaign_delivery_channel();

create or replace function edm_private.duplicate_confirmed_campaign(payload jsonb) returns uuid
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
  if not found or source_campaign.status not in (
    'confirmed','completed','completed_with_errors','failed'
  ) then raise exception '只能复制已确认或已结束活动'; end if;
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
      'source_campaign_id',source_campaign_id,'source_snapshot_id',source_snapshot.id,
      'template_id',selected_template.id,'audience_type',source_snapshot.audience_type,
      'variable_keys',variable_keys
    )
  );
  return duplicate_id;
end;
$$;

create or replace function edm_private.get_campaign_export_chunk(payload jsonb) returns jsonb
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
  if not found or campaign_row.status not in (
    'confirmed','completed','completed_with_errors','failed'
  ) then raise exception '只有已确认或已结束活动可以导出'; end if;
  select * into snapshot_row from edm.campaign_snapshots
  where workspace_id=ws and campaign_id=requested_campaign_id;
  if not found then raise exception '活动快照不存在'; end if;
  perform edm_private.log_activity(
    ws,'campaign.csv_exported','campaign',campaign_row.id,snapshot_row.campaign_name,
    jsonb_build_object(
      'snapshot_id',snapshot_row.id,'template_version',snapshot_row.template_version,
      'recipient_count',snapshot_row.recipient_count,'export_id',export_id
    ),
    'campaign-csv-export:'||campaign_row.id::text||':'||export_id::text
  );
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'position',item.position,'email',item.email,'name',item.name,
      'subject',item.subject,'body',item.body
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
    'campaign_name',snapshot_row.campaign_name,'confirmed_at',snapshot_row.confirmed_at,
    'recipient_count',snapshot_row.recipient_count,'rows',rows_result,
    'next_position',last_position,'has_more',last_position<snapshot_row.recipient_count
  );
end;
$$;

create function edm.start_campaign_delivery(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select edm_private.start_campaign_delivery(payload);
$$;
create function edm.set_campaign_delivery_paused(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select edm_private.set_campaign_delivery_paused(payload);
$$;
create function edm.abort_campaign_delivery(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select edm_private.abort_campaign_delivery(payload);
$$;
create function edm.get_campaign_delivery_summaries(payload jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select edm_private.get_campaign_delivery_summaries(payload);
$$;
create function edm.list_campaign_delivery_tasks(payload jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select edm_private.list_campaign_delivery_tasks(payload);
$$;
create function edm.resolve_delivery_unknown(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$
  select edm_private.resolve_delivery_unknown(payload);
$$;
create function edm.worker_recover_expired_delivery_leases() returns integer
language sql security definer set search_path='' as $$
  select edm_private.worker_recover_expired_delivery_leases();
$$;
create function edm.worker_claim_delivery_batch(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$
  select edm_private.worker_claim_delivery_batch(payload);
$$;
create function edm.worker_complete_delivery_task(payload jsonb) returns jsonb
language sql security definer set search_path='' as $$
  select edm_private.worker_complete_delivery_task(payload);
$$;

revoke all on edm.campaign_delivery_runs,edm.campaign_delivery_tasks,
  edm.campaign_delivery_attempts from public,anon,authenticated;
grant select on edm.campaign_delivery_runs to authenticated;

revoke all on function
  edm.start_campaign_delivery(jsonb),
  edm.set_campaign_delivery_paused(jsonb),
  edm.abort_campaign_delivery(jsonb),
  edm.get_campaign_delivery_summaries(jsonb),
  edm.list_campaign_delivery_tasks(jsonb),
  edm.resolve_delivery_unknown(jsonb),
  edm.worker_recover_expired_delivery_leases(),
  edm.worker_claim_delivery_batch(jsonb),
  edm.worker_complete_delivery_task(jsonb)
from public,anon,authenticated;

grant execute on function
  edm.start_campaign_delivery(jsonb),
  edm.set_campaign_delivery_paused(jsonb),
  edm.abort_campaign_delivery(jsonb),
  edm.get_campaign_delivery_summaries(jsonb),
  edm.list_campaign_delivery_tasks(jsonb),
  edm.resolve_delivery_unknown(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function
      edm.worker_recover_expired_delivery_leases(),
      edm.worker_claim_delivery_batch(jsonb),
      edm.worker_complete_delivery_task(jsonb)
    to service_role;
  end if;
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.campaign_delivery_runs,edm.campaign_delivery_tasks,
      edm.campaign_delivery_attempts from aigc_api;
    revoke all on function
      edm.start_campaign_delivery(jsonb),
      edm.set_campaign_delivery_paused(jsonb),
      edm.abort_campaign_delivery(jsonb),
      edm.get_campaign_delivery_summaries(jsonb),
      edm.list_campaign_delivery_tasks(jsonb),
      edm.resolve_delivery_unknown(jsonb),
      edm.worker_recover_expired_delivery_leases(),
      edm.worker_claim_delivery_batch(jsonb),
      edm.worker_complete_delivery_task(jsonb)
    from aigc_api;
  end if;
end $$;
