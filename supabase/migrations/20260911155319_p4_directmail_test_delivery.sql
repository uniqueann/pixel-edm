-- P4-2 阿里云 DirectMail 测试发送、幂等记录与验证状态回写。
-- 仅创建 EDM 对象；不修改共享 Auth、AIGC、pgmq、pg_cron 或其他项目对象。

create table edm.delivery_test_attempts (
  id uuid primary key,
  workspace_id uuid not null,
  channel_id uuid not null,
  idempotency_key uuid not null,
  requested_by uuid not null,
  channel_version integer not null check (channel_version>0),
  credential_version integer not null check (credential_version>0),
  status text not null default 'pending'
    check (status in ('pending','processing','accepted','failed','unknown')),
  recipient_hint text
    check (recipient_hint is null or char_length(recipient_hint) between 5 and 254),
  provider_request_id text
    check (provider_request_id is null or char_length(provider_request_id)<=160),
  provider_event_id text
    check (provider_event_id is null or char_length(provider_event_id)<=160),
  error_category text
    check (error_category is null or error_category in (
      'authentication','configuration','rate_limit','temporary','permanent','unknown'
    )),
  error_code text check (error_code is null or char_length(error_code)<=100),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(workspace_id,id),
  unique(workspace_id,channel_id,idempotency_key),
  foreign key(workspace_id,channel_id)
    references edm.delivery_channels(workspace_id,id) on delete cascade,
  foreign key(workspace_id,requested_by)
    references edm.workspace_members(workspace_id,user_id)
);

create index delivery_test_attempts_recent_idx
  on edm.delivery_test_attempts(workspace_id,channel_id,created_at desc);
create index delivery_test_attempts_requested_by_idx
  on edm.delivery_test_attempts(workspace_id,requested_by);

alter table edm.delivery_test_attempts enable row level security;

-- 测试记录不直接开放表权限，只能通过下方最小化 RPC 读取。
create policy delivery_test_attempts_deny_authenticated
  on edm.delivery_test_attempts
  for all to authenticated using (false) with check (false);

create function edm_private.delivery_test_summary(attempt edm.delivery_test_attempts)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',attempt.id,
    'workspace_id',attempt.workspace_id,
    'channel_id',attempt.channel_id,
    'status',attempt.status,
    'recipient_hint',attempt.recipient_hint,
    'provider_request_hint',case when attempt.provider_request_id is not null
      then '••••'||right(attempt.provider_request_id,6) end,
    'provider_event_hint',case when attempt.provider_event_id is not null
      then '••••'||right(attempt.provider_event_id,6) end,
    'error_category',attempt.error_category,
    'error_code',attempt.error_code,
    'started_at',attempt.started_at,
    'completed_at',attempt.completed_at,
    'created_at',attempt.created_at
  ));
$$;

create function edm_private.prepare_delivery_test(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  attempt_id uuid := (payload->>'attempt_id')::uuid;
  idempotency uuid := (payload->>'idempotency_key')::uuid;
  expected integer := (payload->>'expected_version')::integer;
  channel_row edm.delivery_channels;
  attempt_row edm.delivery_test_attempts;
  recent_count integer;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以发送测试邮件' using errcode='42501';
  end if;
  if requested_channel_id is null or attempt_id is null or idempotency is null then
    raise exception '测试发送标识无效';
  end if;

  select * into channel_row from edm.delivery_channels
  where workspace_id=ws and id=requested_channel_id and provider='aliyun_directmail'
  for update;
  if not found then raise exception '发信通道不存在或不可访问'; end if;

  select * into attempt_row from edm.delivery_test_attempts attempt
  where attempt.workspace_id=ws and attempt.channel_id=requested_channel_id
    and attempt.idempotency_key=idempotency;
  if found then
    return jsonb_build_object(
      'attempt',edm_private.delivery_test_summary(attempt_row),
      'is_new',false
    );
  end if;

  if channel_row.version is distinct from expected then
    raise exception '发信通道已被修改，请重新加载后重试';
  end if;
  if channel_row.status in ('incomplete','disconnected') then
    raise exception '发信通道尚未连接';
  end if;
  if channel_row.credential_version<1 or not exists(
    select 1 from edm_private.delivery_channel_credentials credential
    where credential.workspace_id=ws and credential.channel_id=channel_row.id
      and credential.credential_version=channel_row.credential_version
  ) then raise exception '发信凭据不存在，请重新连接'; end if;

  select count(*) into recent_count from edm.delivery_test_attempts attempt
  where attempt.workspace_id=ws and attempt.channel_id=channel_row.id
    and attempt.created_at>clock_timestamp()-interval '10 minutes';
  if recent_count>=5 then
    raise exception '测试发送过于频繁，请稍后再试' using errcode='P0001';
  end if;

  insert into edm.delivery_test_attempts(
    id,workspace_id,channel_id,idempotency_key,requested_by,
    channel_version,credential_version
  ) values(
    attempt_id,ws,channel_row.id,idempotency,auth.uid(),
    channel_row.version,channel_row.credential_version
  ) returning * into attempt_row;

  perform edm_private.log_activity(
    ws,'delivery_channel.test_started','delivery_channel',channel_row.id,
    '阿里云邮件推送',
    jsonb_build_object(
      'provider','aliyun_directmail',
      'region',channel_row.region,
      'attempt_id',attempt_row.id,
      'channel_version',channel_row.version,
      'credential_version',channel_row.credential_version
    ),
    'delivery-channel-test-started:'||attempt_row.id::text
  );

  return jsonb_build_object(
    'attempt',edm_private.delivery_test_summary(attempt_row),
    'is_new',true
  );
end;
$$;

create function edm_private.get_delivery_test_summary(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  attempt_id uuid := nullif(payload->>'attempt_id','')::uuid;
  attempt_row edm.delivery_test_attempts;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以查看测试发送结果' using errcode='42501';
  end if;
  if attempt_id is null then
    select * into attempt_row from edm.delivery_test_attempts attempt
    where attempt.workspace_id=ws and attempt.channel_id=requested_channel_id
    order by attempt.created_at desc limit 1;
  else
    select * into attempt_row from edm.delivery_test_attempts attempt
    where attempt.workspace_id=ws and attempt.channel_id=requested_channel_id
      and attempt.id=attempt_id;
  end if;
  if not found then return null; end if;
  return edm_private.delivery_test_summary(attempt_row);
end;
$$;

-- 仅供 Edge Function 的 Secret Key 调用。完整收件邮箱只在本次调用内使用，
-- 数据库只保存掩码，不保存或审计完整邮箱与凭据明文。
create function edm.worker_claim_delivery_test(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  attempt_id uuid := (payload->>'attempt_id')::uuid;
  recipient text := lower(btrim(coalesce(payload->>'recipient_email','')));
  recipient_local text;
  recipient_domain text;
  attempt_row edm.delivery_test_attempts;
  channel_row edm.delivery_channels;
  credential_row edm_private.delivery_channel_credentials;
begin
  if recipient !~ '^[^[:space:]@]+@[^[:space:]@]+$' or char_length(recipient)>254 then
    raise exception '测试收件邮箱无效';
  end if;
  recipient_local=split_part(recipient,'@',1);
  recipient_domain=split_part(recipient,'@',2);

  select * into attempt_row from edm.delivery_test_attempts
  where workspace_id=ws and id=attempt_id for update;
  if not found then raise exception '测试发送记录不存在'; end if;
  if attempt_row.status<>'pending' then
    return jsonb_build_object(
      'attempt',edm_private.delivery_test_summary(attempt_row),
      'claim_acquired',false
    );
  end if;

  select * into channel_row from edm.delivery_channels
  where workspace_id=ws and id=attempt_row.channel_id and provider='aliyun_directmail';
  select * into credential_row from edm_private.delivery_channel_credentials
  where workspace_id=ws and channel_id=attempt_row.channel_id;

  if channel_row.id is null or credential_row.channel_id is null
    or channel_row.status in ('incomplete','disconnected')
    or channel_row.version<>attempt_row.channel_version
    or channel_row.credential_version<>attempt_row.credential_version
    or credential_row.credential_version<>attempt_row.credential_version then
    update edm.delivery_test_attempts set
      status='failed',recipient_hint=left(recipient_local,1)||'***@'||recipient_domain,
      error_category='configuration',error_code='CHANNEL_CONFIGURATION_CHANGED',
      completed_at=clock_timestamp()
    where workspace_id=ws and id=attempt_id
    returning * into attempt_row;
    perform edm_private.log_activity(
      ws,'delivery_channel.test_failed','delivery_channel',attempt_row.channel_id,
      '阿里云邮件推送',
      jsonb_build_object(
        'provider','aliyun_directmail','attempt_id',attempt_row.id,
        'result','failed','error_category','configuration',
        'error_code','CHANNEL_CONFIGURATION_CHANGED'
      ),
      'delivery-channel-test-finished:'||attempt_row.id::text,
      true
    );
    return jsonb_build_object(
      'attempt',edm_private.delivery_test_summary(attempt_row),
      'claim_acquired',false
    );
  end if;

  update edm.delivery_test_attempts set
    status='processing',recipient_hint=left(recipient_local,1)||'***@'||recipient_domain,
    started_at=clock_timestamp()
  where workspace_id=ws and id=attempt_id
  returning * into attempt_row;

  return jsonb_build_object(
    'attempt',edm_private.delivery_test_summary(attempt_row),
    'claim_acquired',true,
    'recipient_email',recipient,
    'channel',jsonb_build_object(
      'id',channel_row.id,
      'region',channel_row.region,
      'sender_address',channel_row.sender_address,
      'sender_alias',channel_row.sender_alias,
      'reply_to_address',channel_row.reply_to_address,
      'channel_version',channel_row.version,
      'credential_version',channel_row.credential_version
    ),
    'credential',jsonb_build_object(
      'key_id',credential_row.key_id,
      'nonce',encode(credential_row.nonce,'base64'),
      'ciphertext',encode(credential_row.ciphertext,'base64'),
      'credential_version',credential_row.credential_version
    )
  );
end;
$$;

create function edm.worker_complete_delivery_test(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  attempt_id uuid := (payload->>'attempt_id')::uuid;
  result_status text := btrim(coalesce(payload->>'status',''));
  result_category text := nullif(btrim(coalesce(payload->>'error_category','')),'');
  result_code text := nullif(left(btrim(coalesce(payload->>'error_code','')),100),'');
  request_id text := nullif(left(btrim(coalesce(payload->>'provider_request_id','')),160),'');
  event_id text := nullif(left(btrim(coalesce(payload->>'provider_event_id','')),160),'');
  attempt_row edm.delivery_test_attempts;
  channel_row edm.delivery_channels;
begin
  if result_status not in ('accepted','failed','unknown') then
    raise exception '测试发送结果状态无效';
  end if;
  if result_category is not null and result_category not in (
    'authentication','configuration','rate_limit','temporary','permanent','unknown'
  ) then raise exception '测试发送错误分类无效'; end if;
  if result_status='accepted' and (request_id is null or event_id is null) then
    raise exception '邮件服务商回执不完整';
  end if;
  if result_status<>'accepted' and result_category is null then
    result_category='unknown';
  end if;

  select * into attempt_row from edm.delivery_test_attempts
  where workspace_id=ws and id=attempt_id for update;
  if not found then raise exception '测试发送记录不存在'; end if;
  if attempt_row.status in ('accepted','failed','unknown') then
    return edm_private.delivery_test_summary(attempt_row);
  end if;
  if attempt_row.status<>'processing' then raise exception '测试发送尚未领取'; end if;

  update edm.delivery_test_attempts set
    status=result_status,
    provider_request_id=case when result_status='accepted' then request_id else null end,
    provider_event_id=case when result_status='accepted' then event_id else null end,
    error_category=case when result_status='accepted' then null else result_category end,
    error_code=case when result_status='accepted' then null else coalesce(result_code,'UNKNOWN') end,
    completed_at=clock_timestamp()
  where workspace_id=ws and id=attempt_id
  returning * into attempt_row;

  select * into channel_row from edm.delivery_channels
  where workspace_id=ws and id=attempt_row.channel_id for update;
  if found and channel_row.version=attempt_row.channel_version
    and channel_row.credential_version=attempt_row.credential_version then
    update edm.delivery_channels set
      status=case
        when result_status='accepted' then 'verified'
        when result_category in ('authentication','configuration','permanent') then 'error'
        when channel_row.status='verified' then 'verified'
        else 'configured'
      end,
      last_verified_at=case
        when result_status='accepted' then clock_timestamp()
        else channel_row.last_verified_at
      end,
      last_error_code=case
        when result_status='accepted' then null
        else coalesce(result_code,'UNKNOWN')
      end,
      updated_at=clock_timestamp(),version=version+1
    where workspace_id=ws and id=attempt_row.channel_id;
  end if;

  perform edm_private.log_activity(
    ws,
    case when result_status='accepted'
      then 'delivery_channel.test_accepted'
      else 'delivery_channel.test_'||result_status end,
    'delivery_channel',attempt_row.channel_id,'阿里云邮件推送',
    jsonb_strip_nulls(jsonb_build_object(
      'provider','aliyun_directmail',
      'attempt_id',attempt_row.id,
      'result',result_status,
      'error_category',case when result_status='accepted' then null else result_category end,
      'error_code',case when result_status='accepted' then null else coalesce(result_code,'UNKNOWN') end
    )),
    'delivery-channel-test-finished:'||attempt_row.id::text,
    true
  );

  return edm_private.delivery_test_summary(attempt_row);
end;
$$;

create function edm.prepare_delivery_test(payload jsonb) returns jsonb
language sql security definer set search_path=''
as $$ select edm_private.prepare_delivery_test(payload); $$;
create function edm.get_delivery_test_summary(payload jsonb) returns jsonb
language sql security definer set search_path=''
as $$ select edm_private.get_delivery_test_summary(payload); $$;

revoke all on edm.delivery_test_attempts from public,anon,authenticated;
revoke all on function
  edm.prepare_delivery_test(jsonb),
  edm.get_delivery_test_summary(jsonb),
  edm.worker_claim_delivery_test(jsonb),
  edm.worker_complete_delivery_test(jsonb),
  edm_private.delivery_test_summary(edm.delivery_test_attempts),
  edm_private.prepare_delivery_test(jsonb),
  edm_private.get_delivery_test_summary(jsonb)
from public,anon,authenticated;
grant execute on function
  edm.prepare_delivery_test(jsonb),
  edm.get_delivery_test_summary(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function
      edm.worker_claim_delivery_test(jsonb),
      edm.worker_complete_delivery_test(jsonb)
    to service_role;
  end if;
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.delivery_test_attempts from aigc_api;
    revoke all on function
      edm.prepare_delivery_test(jsonb),
      edm.get_delivery_test_summary(jsonb),
      edm.worker_claim_delivery_test(jsonb),
      edm.worker_complete_delivery_test(jsonb),
      edm_private.delivery_test_summary(edm.delivery_test_attempts),
      edm_private.prepare_delivery_test(jsonb),
      edm_private.get_delivery_test_summary(jsonb)
    from aigc_api;
  end if;
end $$;
