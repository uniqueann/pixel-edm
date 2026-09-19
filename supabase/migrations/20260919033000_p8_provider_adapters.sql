-- P8-2 provider 适配器配套数据库变更。
-- 只扩展 edm / edm_private；不修改共享 Auth、aigc 或既有迁移历史。

-- SES 的 SNS Topic ARN 属于厂商配置；区域必须与 ARN 中区域一致。
create or replace function edm_private.delivery_provider_config(
  provider_name text,
  config jsonb
) returns jsonb
language plpgsql immutable set search_path='' as $$
declare
  source jsonb := coalesce(config,'{}'::jsonb);
  region_value text;
  tag_value text;
  configuration_set text;
  sns_topic_arn text;
  aws_partition text;
begin
  if jsonb_typeof(source)<>'object' then raise exception '服务商配置格式无效'; end if;
  region_value=nullif(btrim(coalesce(source->>'region','')),'');
  tag_value=nullif(btrim(coalesce(source->>'tracking_tag_name','')),'');
  configuration_set=nullif(btrim(coalesce(source->>'configuration_set_name','')),'');
  sns_topic_arn=nullif(btrim(coalesce(source->>'sns_topic_arn','')),'');

  if provider_name='aliyun_directmail' then
    if region_value is null or region_value not in (
      'cn-hangzhou','ap-southeast-1','us-east-1','eu-central-1'
    ) then raise exception '阿里云区域无效'; end if;
    if tag_value is not null and (
      char_length(tag_value) not between 1 and 128 or tag_value !~ '^[A-Za-z0-9_]+$'
    ) then raise exception '阿里云标签仅支持 1 至 128 位字母、数字和下划线'; end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'region',region_value,
      'tracking_tag_name',tag_value
    ));
  end if;

  if provider_name='amazon_ses' then
    if region_value is null or region_value !~ '^[a-z]{2}(-gov)?-[a-z]+-[0-9]$' then
      raise exception 'AWS 区域无效';
    end if;
    if configuration_set is not null and (
      char_length(configuration_set) not between 1 and 64
      or configuration_set !~ '^[A-Za-z0-9_-]+$'
    ) then raise exception 'SES 配置集名称仅支持 1 至 64 位字母、数字、下划线和连字符'; end if;
    aws_partition=case
      when region_value like 'cn-%' then 'aws-cn'
      when region_value like 'us-gov-%' then 'aws-us-gov'
      else 'aws'
    end;
    if sns_topic_arn is not null and (
      char_length(sns_topic_arn)>2048
      or sns_topic_arn !~ (
        '^arn:'||aws_partition||':sns:'||
        region_value||
        ':[0-9]{12}:[A-Za-z0-9_-]+$'
      )
    ) then raise exception 'SNS Topic ARN 无效或区域不匹配'; end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'region',region_value,
      'configuration_set_name',configuration_set,
      'sns_topic_arn',sns_topic_arn
    ));
  end if;

  raise exception '不支持的发信服务商';
end;
$$;

-- DirectMail 使用 EnvId，SES 使用 MessageId；发送尝试显式保存两种受理标识。
alter table edm.campaign_delivery_attempts
  add column provider_message_id text check (
    provider_message_id is null or char_length(provider_message_id)<=255
  );

create index campaign_delivery_attempts_message_idx
  on edm.campaign_delivery_attempts(provider_message_id)
  where provider_message_id is not null;

create or replace function edm_private.worker_complete_delivery_task(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  requested_task_id uuid := (payload->>'task_id')::uuid;
  requested_attempt_id uuid := (payload->>'attempt_id')::uuid;
  requested_lease uuid := (payload->>'lease_token')::uuid;
  result_status text := payload->>'status';
  category text := nullif(payload->>'error_category','');
  code text := left(nullif(payload->>'error_code',''),100);
  request_id text := left(nullif(payload->>'provider_request_id',''),255);
  env_id text := left(nullif(payload->>'provider_env_id',''),255);
  message_id text := left(nullif(payload->>'provider_message_id',''),255);
  task_row edm.campaign_delivery_tasks;
  run_row edm.campaign_delivery_runs;
  next_retry timestamptz;
  next_task_status text;
  final_status text;
begin
  if result_status not in ('accepted','failed','unknown') then
    raise exception '发送结果无效';
  end if;
  if result_status='accepted' and (
    request_id is null or (env_id is null and message_id is null)
  ) then raise exception '邮件服务商回执不完整'; end if;

  select * into task_row from edm.campaign_delivery_tasks
  where id=requested_task_id for update;
  if not found then raise exception '正式发送任务不存在'; end if;
  if task_row.status<>'processing'
    or task_row.active_attempt_id<>requested_attempt_id
    or task_row.lease_token<>requested_lease then
    return jsonb_build_object(
      'task_id',task_row.id,'status',task_row.status,'reused',true
    );
  end if;

  select * into run_row from edm.campaign_delivery_runs
  where id=task_row.run_id for update;
  update edm.campaign_delivery_attempts set
    status=result_status,
    completed_at=clock_timestamp(),
    provider_request_id=request_id,
    provider_env_id=env_id,
    provider_message_id=message_id,
    error_category=category,
    error_code=code
  where id=requested_attempt_id;

  if result_status='failed'
    and category in ('rate_limit','temporary')
    and task_row.attempt_count<4 then
    next_retry=clock_timestamp()+case task_row.attempt_count
      when 1 then interval '30 seconds'
      when 2 then interval '2 minutes'
      else interval '10 minutes'
    end;
    next_task_status='pending';
    update edm.campaign_delivery_tasks set
      status='pending',next_attempt_at=next_retry,
      lease_token=null,lease_expires_at=null,
      error_category=category,error_code=code,
      version=version+1
    where id=task_row.id;
  else
    next_task_status=result_status;
    update edm.campaign_delivery_tasks set
      status=result_status,
      provider_message_id=case
        when result_status='accepted'
          then coalesce(provider_message_id,message_id)
        else provider_message_id
      end,
      lease_token=null,lease_expires_at=null,
      error_category=category,error_code=code,
      accepted_at=case
        when result_status='accepted' then clock_timestamp()
        else null
      end,
      completed_at=clock_timestamp(),
      version=version+1
    where id=task_row.id;
  end if;

  if result_status='failed'
    and category in ('authentication','configuration') then
    update edm.campaign_delivery_runs set
      status='paused',pause_reason='channel_'||category,
      paused_at=clock_timestamp(),version=version+1
    where id=run_row.id;
    update edm.campaigns set
      status='paused',updated_at=clock_timestamp(),version=version+1
    where workspace_id=run_row.workspace_id and id=run_row.campaign_id;
    perform edm_private.log_activity(
      run_row.workspace_id,'campaign.delivery_paused','campaign',
      run_row.campaign_id,null,
      jsonb_build_object(
        'run_id',run_row.id,
        'reason','channel_'||category,
        'error_code',code
      ),
      'campaign-delivery-auto-paused:'||requested_attempt_id::text,
      true
    );
    final_status='paused';
  else
    final_status=edm_private.finalize_campaign_delivery(run_row.id);
  end if;
  return jsonb_build_object(
    'task_id',task_row.id,
    'task_status',next_task_status,
    'run_status',final_status,
    'next_attempt_at',next_retry,
    'reused',false
  );
end;
$$;

-- 测试发送审计按通道 provider 取显示名，不再硬编码阿里云。
create or replace function edm.worker_complete_delivery_test(payload jsonb) returns jsonb
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
  provider_label text;
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

  select display_name into provider_label from edm.delivery_providers
  where provider=channel_row.provider;
  perform edm_private.log_activity(
    ws,
    case when result_status='accepted'
      then 'delivery_channel.test_accepted'
      else 'delivery_channel.test_'||result_status end,
    'delivery_channel',attempt_row.channel_id,
    coalesce(provider_label,channel_row.provider,'发信服务商'),
    jsonb_strip_nulls(jsonb_build_object(
      'provider',channel_row.provider,
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

revoke all on function edm_private.delivery_provider_config(text,jsonb)
from public,anon,authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on function edm_private.delivery_provider_config(text,jsonb)
    from aigc_api;
  end if;
end $$;
