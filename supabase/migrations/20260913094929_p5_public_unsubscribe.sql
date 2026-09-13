-- P5-2 公开退订、签名令牌落库入口与工作区级抑制闭环。
-- 仅操作 edm / edm_private；不修改共享 Auth、AIGC 或其他项目对象。

drop policy workspace_update on edm.workspaces;
create policy workspace_update on edm.workspaces for update to authenticated
  using ((select edm_private.workspace_role(id))='admin')
  with check (
    (select edm_private.workspace_role(id))='admin'
    and char_length(btrim(mailing_address)) between 1 and 500
  );

alter table edm.campaign_delivery_runs
  add column sender_workspace_name text,
  add column sender_mailing_address text;

update edm.campaign_delivery_runs run
set sender_workspace_name=workspace.name,
    sender_mailing_address=workspace.mailing_address
from edm.workspaces workspace
where workspace.id=run.workspace_id;

alter table edm.campaign_delivery_runs
  alter column sender_workspace_name set not null,
  alter column sender_mailing_address set not null,
  add constraint campaign_delivery_runs_workspace_name_check
    check (char_length(btrim(sender_workspace_name)) between 1 and 80),
  add constraint campaign_delivery_runs_mailing_address_check
    check (char_length(btrim(sender_mailing_address)) between 1 and 500) not valid;

alter table edm.subscription_events
  add column delivery_task_id uuid,
  add constraint subscription_events_delivery_task_fk
    foreign key(workspace_id,delivery_task_id)
    references edm.campaign_delivery_tasks(workspace_id,id);

create index subscription_events_delivery_task_idx
  on edm.subscription_events(workspace_id,delivery_task_id)
  where delivery_task_id is not null;

create unique index subscription_events_public_unsubscribe_task_idx
  on edm.subscription_events(workspace_id,delivery_task_id,event_type)
  where delivery_task_id is not null
    and event_type='unsubscribed'
    and source='public_link';

create function edm_private.mask_email(target_email text) returns text
language sql immutable set search_path='' as $$
  select case
    when position('@' in target_email)=0 then '***'
    when char_length(split_part(target_email,'@',1))<=1 then
      '*@'||split_part(target_email,'@',2)
    else
      left(split_part(target_email,'@',1),1)||
      repeat('*',least(char_length(split_part(target_email,'@',1))-1,3))||
      '@'||split_part(target_email,'@',2)
  end;
$$;

create function edm_private.resolve_public_unsubscribe(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  requested_task_id uuid := nullif(payload->>'task_id','')::uuid;
  task_row edm.campaign_delivery_tasks;
  run_row edm.campaign_delivery_runs;
  recipient_row edm.campaign_recipient_snapshots;
  suppression_exists boolean;
begin
  if requested_task_id is null then raise exception 'UNSUBSCRIBE_NOT_FOUND'; end if;
  select * into task_row from edm.campaign_delivery_tasks
  where id=requested_task_id and attempt_count>0;
  if not found then raise exception 'UNSUBSCRIBE_NOT_FOUND'; end if;
  select * into run_row from edm.campaign_delivery_runs where id=task_row.run_id;
  select * into recipient_row from edm.campaign_recipient_snapshots
  where id=task_row.recipient_snapshot_id and workspace_id=task_row.workspace_id;
  if run_row.id is null or recipient_row.id is null then raise exception 'UNSUBSCRIBE_NOT_FOUND'; end if;
  select exists(
    select 1 from edm.suppressions suppression
    where suppression.workspace_id=task_row.workspace_id
      and suppression.email=recipient_row.email
  ) into suppression_exists;
  return jsonb_build_object(
    'status',case when suppression_exists then 'already_suppressed' else 'ready' end,
    'workspace_name',run_row.sender_workspace_name,
    'masked_email',edm_private.mask_email(recipient_row.email)
  );
end;
$$;

create function edm_private.apply_public_unsubscribe(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  requested_task_id uuid := nullif(payload->>'task_id','')::uuid;
  entrypoint_name text := coalesce(payload->>'entrypoint','');
  key_id text := coalesce(payload->>'key_id','');
  task_row edm.campaign_delivery_tasks;
  run_row edm.campaign_delivery_runs;
  recipient_row edm.campaign_recipient_snapshots;
  event_id uuid;
  event_already_exists boolean := false;
  suppression_already_exists boolean;
begin
  if requested_task_id is null or entrypoint_name not in ('public_page','one_click')
    or key_id !~ '^[A-Za-z0-9_-]{1,32}$' then
    raise exception 'UNSUBSCRIBE_INVALID';
  end if;
  select * into task_row from edm.campaign_delivery_tasks
  where id=requested_task_id and attempt_count>0 for update;
  if not found then raise exception 'UNSUBSCRIBE_NOT_FOUND'; end if;
  select * into run_row from edm.campaign_delivery_runs where id=task_row.run_id;
  select * into recipient_row from edm.campaign_recipient_snapshots
  where id=task_row.recipient_snapshot_id and workspace_id=task_row.workspace_id;
  if run_row.id is null or recipient_row.id is null then raise exception 'UNSUBSCRIBE_NOT_FOUND'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'edm:contact:'||task_row.workspace_id::text||':'||recipient_row.email,0
    )
  );
  select exists(
    select 1 from edm.suppressions suppression
    where suppression.workspace_id=task_row.workspace_id
      and suppression.email=recipient_row.email
  ) into suppression_already_exists;

  select id into event_id from edm.subscription_events
  where workspace_id=task_row.workspace_id
    and delivery_task_id=task_row.id
    and event_type='unsubscribed'
    and source='public_link';
  if found then
    event_already_exists=true;
  else
    insert into edm.subscription_events(
      workspace_id,contact_id,email,event_type,source,note,metadata,delivery_task_id
    ) values(
      task_row.workspace_id,recipient_row.contact_id,recipient_row.email,
      'unsubscribed','public_link','收件人通过公开退订入口请求停止后续邮件',
      jsonb_build_object(
        'entrypoint',entrypoint_name,'key_id',key_id,
        'run_id',run_row.id,'campaign_id',run_row.campaign_id
      ),task_row.id
    ) returning id into event_id;
  end if;

  insert into edm.suppressions(workspace_id,email,reason,first_event_id)
  values(task_row.workspace_id,recipient_row.email,'unsubscribed',event_id)
  on conflict do nothing;

  update edm.contacts contact set
    subscription_status=coalesce(
      edm_private.suppression_status(task_row.workspace_id,recipient_row.email),
      'unsubscribed'
    ),
    version=version+1,
    updated_at=clock_timestamp()
  where contact.workspace_id=task_row.workspace_id
    and contact.email=recipient_row.email
    and contact.subscription_status is distinct from coalesce(
      edm_private.suppression_status(task_row.workspace_id,recipient_row.email),
      'unsubscribed'
    );

  update edm.campaign_delivery_tasks set
    feedback_status='unsubscribed',feedback_status_at=clock_timestamp()
  where id=task_row.id and feedback_status='none';

  perform edm_private.log_activity(
    task_row.workspace_id,'contact.unsubscribed_public','contact',
    recipient_row.contact_id,edm_private.mask_email(recipient_row.email),
    jsonb_build_object(
      'run_id',run_row.id,'campaign_id',run_row.campaign_id,
      'task_id',task_row.id,'entrypoint',entrypoint_name,'key_id',key_id
    ),'public-unsubscribe:'||task_row.id::text,true
  );
  return jsonb_build_object(
    'status','unsubscribed','already_applied',event_already_exists,
    'already_suppressed',suppression_already_exists,
    'workspace_name',run_row.sender_workspace_name,
    'masked_email',edm_private.mask_email(recipient_row.email)
  );
end;
$$;

create function edm.resolve_public_unsubscribe(payload jsonb) returns jsonb
language sql security definer set search_path=''
as $$ select edm_private.resolve_public_unsubscribe(payload); $$;

create function edm.apply_public_unsubscribe(payload jsonb) returns jsonb
language sql security definer set search_path=''
as $$ select edm_private.apply_public_unsubscribe(payload); $$;

create or replace function edm_private.start_campaign_delivery(payload jsonb) returns jsonb
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
  workspace_row edm.workspaces;
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

  select * into workspace_row from edm.workspaces where id=ws for share;
  if not found or char_length(btrim(workspace_row.mailing_address))=0 then
    raise exception '请先填写发件人联系地址';
  end if;
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
    channel_version,credential_version,recipient_count,started_by,
    sender_workspace_name,sender_mailing_address
  ) values(
    ws,campaign_row.id,snapshot_row.id,channel_row.id,requested_key,
    channel_row.region,channel_row.sender_address,channel_row.sender_alias,
    channel_row.reply_to_address,channel_row.version,channel_row.credential_version,
    snapshot_row.recipient_count,auth.uid(),workspace_row.name,workspace_row.mailing_address
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

revoke all on function
  edm.resolve_public_unsubscribe(jsonb),edm.apply_public_unsubscribe(jsonb),
  edm_private.resolve_public_unsubscribe(jsonb),edm_private.apply_public_unsubscribe(jsonb),
  edm_private.mask_email(text)
from public,anon,authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function
      edm.resolve_public_unsubscribe(jsonb),edm.apply_public_unsubscribe(jsonb)
    to service_role;
  end if;
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on function
      edm.resolve_public_unsubscribe(jsonb),edm.apply_public_unsubscribe(jsonb)
    from aigc_api;
  end if;
end $$;
