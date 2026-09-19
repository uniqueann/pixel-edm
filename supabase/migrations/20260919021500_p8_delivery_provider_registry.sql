-- P8-1 发信通道多服务商去耦：服务商注册表、provider_config 与归一化退信分级。
-- 仅操作 edm / edm_private；不修改 aigc、共享 Auth 触发器或既有迁移历史。
-- 本批不开放新服务商：amazon_ses 以 enabled=false 登记，配置入口在 P8-2 打开。
-- DirectMail 的界面、RPC 出入参和发送行为在本批保持不变；旧字段在响应中继续返回。

-- 1. 服务商注册表

create table edm.delivery_providers (
  provider text primary key
    check (provider ~ '^[a-z][a-z0-9_]{2,39}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 60),
  enabled boolean not null default false,
  sender_alias_max_length integer not null
    check (sender_alias_max_length between 1 and 64),
  requires_sender_domain boolean not null default true,
  supports_open_tracking boolean not null default false,
  supports_click_tracking boolean not null default false,
  requires_html_for_tracking boolean not null default false,
  supports_link_tracking_opt_out boolean not null default false,
  requires_webhook_subscription_confirmation boolean not null default false,
  default_rate_per_second integer not null
    check (default_rate_per_second between 1 and 1000),
  default_daily_quota integer not null
    check (default_daily_quota between 1 and 10000000),
  quota_timezone text not null default 'UTC'
    check (char_length(quota_timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table edm.delivery_providers enable row level security;

create policy delivery_providers_member_read on edm.delivery_providers
  for select to authenticated using (true);

create trigger delivery_providers_updated before update on edm.delivery_providers
  for each row execute function edm_private.touch_updated_at();

-- 限速默认值沿用 P4 既有阿里云口径，确保去耦后发送节奏不变。
-- SES 默认值按沙箱额度登记，正式额度在管理员申请通过后按通道覆盖。
insert into edm.delivery_providers(
  provider,display_name,enabled,sender_alias_max_length,requires_sender_domain,
  supports_open_tracking,supports_click_tracking,requires_html_for_tracking,
  supports_link_tracking_opt_out,requires_webhook_subscription_confirmation,
  default_rate_per_second,default_daily_quota,quota_timezone
) values
  ('aliyun_directmail','阿里云邮件推送',true,14,true,true,true,true,true,false,5,2000,'Asia/Shanghai'),
  ('amazon_ses','Amazon SES',false,64,false,true,true,true,true,true,1,200,'UTC');

-- 2. 通道表：厂商专属项迁入 provider_config，单值约束换为注册表外键

alter table edm.delivery_channels
  add column provider_config jsonb not null default '{}'::jsonb,
  add column is_primary boolean not null default false,
  add column rate_per_second integer
    check (rate_per_second is null or rate_per_second between 1 and 1000),
  add column daily_quota integer
    check (daily_quota is null or daily_quota between 1 and 10000000);

update edm.delivery_channels set provider_config=jsonb_strip_nulls(jsonb_build_object(
  'region',region,
  'tracking_tag_name',tracking_tag_name
));

-- 去耦前每个工作区最多只有一个通道，全部置为主通道。
update edm.delivery_channels set is_primary=true;

alter table edm.delivery_channels rename column access_key_hint to credential_hint;
alter table edm.delivery_channels
  rename constraint delivery_channels_access_key_hint_check
  to delivery_channels_credential_hint_check;

-- delivery_channels_check 是 sender_address 与 sender_domain 的联合约束，
-- 跨列约束由 Postgres 命名为表级名称。
alter table edm.delivery_channels
  drop constraint delivery_channels_provider_check,
  drop constraint delivery_channels_sender_alias_check,
  drop constraint delivery_channels_check;

alter table edm.delivery_channels alter column provider drop default;
alter table edm.delivery_channels alter column sender_domain drop not null;

alter table edm.delivery_channels
  add constraint delivery_channels_provider_fkey
    foreign key(provider) references edm.delivery_providers(provider),
  add constraint delivery_channels_provider_config_check
    check (jsonb_typeof(provider_config)='object'),
  add constraint delivery_channels_sender_alias_check check (
    sender_alias=btrim(sender_alias) and char_length(sender_alias) between 1 and 64
  ),
  add constraint delivery_channels_sender_address_check check (
    sender_address=lower(btrim(sender_address))
    and char_length(sender_address) between 3 and 254
    and sender_address ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    and (sender_domain is null or split_part(sender_address,'@',2)=sender_domain)
  );

-- 同时删除依赖 tracking_tag_name 的 delivery_channels_tracking_config_check。
alter table edm.delivery_channels
  drop column region,
  drop column tracking_tag_name;

create index delivery_channels_provider_idx on edm.delivery_channels(provider);
create unique index delivery_channels_primary_idx
  on edm.delivery_channels(workspace_id) where is_primary;

-- 3. 发送运行：冻结 provider 与 provider_config，切换通道不影响在途活动

alter table edm.campaign_delivery_runs
  add column provider text,
  add column provider_config jsonb not null default '{}'::jsonb;

update edm.campaign_delivery_runs set
  provider='aliyun_directmail',
  provider_config=jsonb_strip_nulls(jsonb_build_object(
    'region',region,
    'tracking_tag_name',tracking_tag_name
  ));

alter table edm.campaign_delivery_runs
  alter column provider set not null,
  add constraint campaign_delivery_runs_provider_fkey
    foreign key(provider) references edm.delivery_providers(provider),
  add constraint campaign_delivery_runs_provider_config_check
    check (jsonb_typeof(provider_config)='object');

alter table edm.campaign_delivery_runs
  drop column region,
  drop column tracking_tag_name;

create index campaign_delivery_runs_provider_idx
  on edm.campaign_delivery_runs(provider);

-- 4. 回执事件：归一化退信分级，SQL 不再判读厂商状态码

alter table edm.campaign_delivery_events
  add column failure_class text check (
    failure_class is null
    or failure_class in ('hard_bounce','soft_bounce','complaint','undetermined')
  );

update edm.campaign_delivery_events set failure_class=case
  when provider_status='2' then 'hard_bounce'
  when provider_status='3' then 'complaint'
  else 'undetermined'
end
where event_type='delivery_failed';

alter table edm.campaign_delivery_events
  drop constraint campaign_delivery_events_provider_check;
alter table edm.campaign_delivery_events alter column provider drop default;
alter table edm.campaign_delivery_events
  add constraint campaign_delivery_events_provider_fkey
    foreign key(provider) references edm.delivery_providers(provider);

create index campaign_delivery_events_provider_idx
  on edm.campaign_delivery_events(provider);

-- 5. 逐服务商配置校验与归一化

create function edm_private.delivery_provider_config(
  provider_name text,
  config jsonb
) returns jsonb
language plpgsql immutable set search_path='' as $$
declare
  source jsonb := coalesce(config,'{}'::jsonb);
  region_value text;
  tag_value text;
  configuration_set text;
begin
  if jsonb_typeof(source)<>'object' then raise exception '服务商配置格式无效'; end if;
  region_value=nullif(btrim(coalesce(source->>'region','')),'');
  tag_value=nullif(btrim(coalesce(source->>'tracking_tag_name','')),'');
  configuration_set=nullif(btrim(coalesce(source->>'configuration_set_name','')),'');

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
    return jsonb_strip_nulls(jsonb_build_object(
      'region',region_value,
      'configuration_set_name',configuration_set
    ));
  end if;

  raise exception '不支持的发信服务商';
end;
$$;

-- 行为追踪所需的厂商专属配置是否齐备。
create function edm_private.delivery_tracking_configured(
  provider_name text,
  config jsonb
) returns boolean
language sql immutable set search_path='' as $$
  select case provider_name
    when 'aliyun_directmail' then coalesce(config->>'tracking_tag_name','')<>''
    when 'amazon_ses' then coalesce(config->>'configuration_set_name','')<>''
    else false
  end;
$$;

-- 适配器未提供归一化分级时的兜底映射；P8-2 起由各服务商适配器直接提交。
create function edm_private.delivery_failure_class(
  provider_name text,
  provider_status text,
  failure_type text
) returns text
language sql immutable set search_path='' as $$
  select case
    when provider_name='aliyun_directmail' and provider_status='2' then 'hard_bounce'
    when provider_name='aliyun_directmail' and provider_status='3' then 'complaint'
    when provider_name='amazon_ses' and lower(coalesce(failure_type,''))='permanent'
      then 'hard_bounce'
    when provider_name='amazon_ses' and lower(coalesce(failure_type,''))='transient'
      then 'soft_bounce'
    else 'undetermined'
  end;
$$;

create function edm_private.list_delivery_providers() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'provider',provider,
    'display_name',display_name,
    'enabled',enabled,
    'sender_alias_max_length',sender_alias_max_length,
    'requires_sender_domain',requires_sender_domain,
    'supports_open_tracking',supports_open_tracking,
    'supports_click_tracking',supports_click_tracking,
    'requires_html_for_tracking',requires_html_for_tracking,
    'supports_link_tracking_opt_out',supports_link_tracking_opt_out,
    'requires_webhook_subscription_confirmation',requires_webhook_subscription_confirmation,
    'default_rate_per_second',default_rate_per_second,
    'default_daily_quota',default_daily_quota,
    'quota_timezone',quota_timezone
  ) order by display_name),'[]'::jsonb)
  from edm.delivery_providers
  where (select auth.uid()) is not null;
$$;

create function edm.list_delivery_providers() returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.list_delivery_providers(); $$;

-- 6. RPC 重写：按主通道与服务商分派，响应保留旧字段

create or replace function edm_private.get_delivery_channel(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_channel_id uuid := nullif(payload->>'channel_id','')::uuid;
  role_name text;
  channel_row edm.delivery_channels;
  provider_row edm.delivery_providers;
  token_row edm_private.delivery_webhook_tokens;
  has_credentials boolean;
begin
  if auth.uid() is null then raise exception '需要登录' using errcode='42501'; end if;
  role_name=edm_private.workspace_role(ws);
  if role_name is null then raise exception '工作区不可访问' using errcode='42501'; end if;

  if requested_channel_id is null then
    select * into channel_row from edm.delivery_channels
    where workspace_id=ws and is_primary;
  else
    select * into channel_row from edm.delivery_channels
    where workspace_id=ws and id=requested_channel_id;
  end if;
  if not found then return null; end if;
  select * into provider_row from edm.delivery_providers
  where provider=channel_row.provider;

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
    'provider_config',channel_row.provider_config,
    'is_primary',channel_row.is_primary,
    -- 旧客户端仍读取扁平的 region 与 tracking_tag_name。
    'region',channel_row.provider_config->>'region',
    'sender_domain',channel_row.sender_domain,
    'sender_address',channel_row.sender_address,'sender_alias',channel_row.sender_alias,
    'reply_to_address',channel_row.reply_to_address,'credential_configured',has_credentials,
    'credential_hint',case when role_name='admin' then channel_row.credential_hint end,
    'access_key_hint',case when role_name='admin' then channel_row.credential_hint end,
    'credential_version',case when role_name='admin' then channel_row.credential_version end,
    'last_verified_at',channel_row.last_verified_at,
    'last_error_code',case when role_name='admin' then channel_row.last_error_code end,
    'tracking_enabled',channel_row.tracking_enabled,
    'tracking_tag_name',channel_row.provider_config->>'tracking_tag_name',
    'rate_per_second',coalesce(channel_row.rate_per_second,provider_row.default_rate_per_second),
    'daily_quota',coalesce(channel_row.daily_quota,provider_row.default_daily_quota),
    'capabilities',jsonb_build_object(
      'display_name',provider_row.display_name,
      'sender_alias_max_length',provider_row.sender_alias_max_length,
      'requires_sender_domain',provider_row.requires_sender_domain,
      'supports_open_tracking',provider_row.supports_open_tracking,
      'supports_click_tracking',provider_row.supports_click_tracking,
      'requires_html_for_tracking',provider_row.requires_html_for_tracking,
      'supports_link_tracking_opt_out',provider_row.supports_link_tracking_opt_out,
      'requires_webhook_subscription_confirmation',
        provider_row.requires_webhook_subscription_confirmation
    ),
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

create or replace function edm_private.save_delivery_channel(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  channel_id uuid := (payload->>'id')::uuid;
  provider_name text := coalesce(
    nullif(btrim(coalesce(payload->>'provider','')),''),'aliyun_directmail'
  );
  channel_domain text := nullif(lower(btrim(coalesce(payload->>'sender_domain',''))),'');
  channel_address text := lower(btrim(coalesce(payload->>'sender_address','')));
  channel_alias text := btrim(coalesce(payload->>'sender_alias',''));
  channel_reply_to text := nullif(lower(btrim(coalesce(payload->>'reply_to_address',''))),'');
  provider_row edm.delivery_providers;
  incoming_config jsonb;
  config_value jsonb;
  expected integer;
  current_row edm.delivery_channels;
  credential jsonb := payload->'credential';
  has_credential boolean := credential is not null;
  credential_key_id text;
  hint_value text;
  envelope_version integer;
  nonce_bytes bytea;
  ciphertext_bytes bytea;
  reset_verification boolean := false;
  action_name text;
  is_first_channel boolean;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以配置发信通道' using errcode='42501';
  end if;
  if channel_id is null then raise exception '通道标识不能为空'; end if;

  select * into provider_row from edm.delivery_providers where provider=provider_name;
  if not found then raise exception '不支持的发信服务商'; end if;
  if not provider_row.enabled then raise exception '该发信服务商暂未开放'; end if;

  select * into current_row from edm.delivery_channels
  where workspace_id=ws and provider=provider_name for update;

  -- 旧客户端只提交扁平的 region，其余厂商配置保持不变。
  if payload ? 'provider_config' then
    incoming_config=payload->'provider_config';
  else
    incoming_config=coalesce(current_row.provider_config,'{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'region',nullif(btrim(coalesce(payload->>'region','')),'')
      ));
  end if;
  config_value=edm_private.delivery_provider_config(provider_name,incoming_config);

  if provider_row.requires_sender_domain and channel_domain is null then
    raise exception '请填写发件域名';
  end if;
  if channel_domain is not null and (
    channel_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    or char_length(channel_domain)>253
  ) then raise exception '发件域名格式无效'; end if;
  if char_length(channel_address) not between 3 and 254
    or channel_address !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or (channel_domain is not null and split_part(channel_address,'@',2)<>channel_domain) then
    raise exception '发件地址必须属于所填发件域名';
  end if;
  if char_length(channel_alias) not between 1 and provider_row.sender_alias_max_length then
    raise exception '发件人名称应为 1 至 % 个字符',provider_row.sender_alias_max_length;
  end if;
  if channel_reply_to is not null and (
    char_length(channel_reply_to) not between 3 and 254
    or channel_reply_to !~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ) then raise exception '回复地址格式无效'; end if;

  if has_credential then
    if jsonb_typeof(credential)<>'object' then raise exception '凭据密文格式无效'; end if;
    credential_key_id=btrim(coalesce(credential->>'key_id',''));
    hint_value=coalesce(
      credential->>'credential_hint',credential->>'access_key_hint',''
    );
    envelope_version=(credential->>'credential_version')::integer;
    if char_length(credential_key_id) not between 1 and 64
      or credential_key_id !~ '^[A-Za-z0-9._-]+$'
      or char_length(hint_value)<>4 then raise exception '凭据密文元数据无效'; end if;
    begin
      nonce_bytes=decode(coalesce(credential->>'nonce',''),'base64');
      ciphertext_bytes=decode(coalesce(credential->>'ciphertext',''),'base64');
    exception when others then
      raise exception '凭据密文格式无效';
    end;
    if octet_length(nonce_bytes)<>12 or octet_length(ciphertext_bytes) not between 17 and 8192 then
      raise exception '凭据密文长度无效';
    end if;
  end if;

  if current_row.id is null then
    if not has_credential or envelope_version<>1 then raise exception '首次连接必须提交完整凭据'; end if;
    is_first_channel=not exists(
      select 1 from edm.delivery_channels where workspace_id=ws
    );
    insert into edm.delivery_channels(
      id,workspace_id,provider,provider_config,sender_domain,sender_address,sender_alias,
      reply_to_address,status,credential_hint,credential_version,is_primary,created_by,updated_by
    ) values(
      channel_id,ws,provider_name,config_value,channel_domain,channel_address,channel_alias,
      channel_reply_to,'configured',hint_value,1,is_first_channel,auth.uid(),auth.uid()
    );
    insert into edm_private.delivery_channel_credentials(
      channel_id,workspace_id,key_id,nonce,ciphertext,credential_version
    ) values(channel_id,ws,credential_key_id,nonce_bytes,ciphertext_bytes,1);
    action_name='delivery_channel.configured';
  else
    if current_row.id<>channel_id then raise exception '通道标识不匹配'; end if;
    expected=(payload->>'expected_version')::integer;
    if current_row.version is distinct from expected then raise exception '发信通道已被修改，请重新加载后重试'; end if;
    if current_row.status='disconnected' and not has_credential then raise exception '重新连接必须提交新凭据'; end if;
    if has_credential and envelope_version<>current_row.credential_version+1 then
      raise exception '凭据版本冲突，请重新加载后重试';
    end if;

    reset_verification := has_credential
      or (current_row.provider_config->>'region') is distinct from (config_value->>'region')
      or current_row.sender_domain is distinct from channel_domain
      or current_row.sender_address<>channel_address
      or current_row.status='disconnected';

    update edm.delivery_channels set
      provider_config=config_value,
      sender_domain=channel_domain,
      sender_address=channel_address,
      sender_alias=channel_alias,
      reply_to_address=channel_reply_to,
      status=case when reset_verification then 'configured' else status end,
      credential_hint=case when has_credential then hint_value else credential_hint end,
      credential_version=case when has_credential then envelope_version else current_row.credential_version end,
      last_verified_at=case when reset_verification then null else last_verified_at end,
      last_error_code=case when reset_verification then null else last_error_code end,
      disconnected_at=case when reset_verification then null else disconnected_at end,
      updated_by=auth.uid(),
      updated_at=clock_timestamp(),
      version=version+1
    where workspace_id=ws and id=channel_id;

    if has_credential then
      insert into edm_private.delivery_channel_credentials(
        channel_id,workspace_id,key_id,nonce,ciphertext,credential_version
      ) values(channel_id,ws,credential_key_id,nonce_bytes,ciphertext_bytes,envelope_version)
      on conflict on constraint delivery_channel_credentials_pkey do update set
        workspace_id=excluded.workspace_id,
        key_id=excluded.key_id,
        nonce=excluded.nonce,
        ciphertext=excluded.ciphertext,
        credential_version=excluded.credential_version,
        updated_at=clock_timestamp();
      action_name='delivery_channel.credentials_rotated';
    else
      action_name='delivery_channel.updated';
    end if;
  end if;

  perform edm_private.log_activity(
    ws,action_name,'delivery_channel',channel_id,provider_row.display_name,
    jsonb_strip_nulls(jsonb_build_object(
      'provider',provider_name,
      'region',config_value->>'region',
      'sender_domain',channel_domain,
      'credential_changed',has_credential,
      'status','configured'
    ))
  );
  return edm_private.get_delivery_channel(
    jsonb_build_object('workspace_id',ws,'channel_id',channel_id)
  );
end;
$$;

create or replace function edm_private.disconnect_delivery_channel(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  channel_id uuid := (payload->>'id')::uuid;
  expected integer;
  current_row edm.delivery_channels;
  provider_row edm.delivery_providers;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以断开发信通道' using errcode='42501';
  end if;
  select * into current_row from edm.delivery_channels
  where workspace_id=ws and id=channel_id for update;
  if not found then raise exception '发信通道不存在或不可访问'; end if;
  select * into provider_row from edm.delivery_providers where provider=current_row.provider;

  if current_row.status='disconnected' then
    return edm_private.get_delivery_channel(
      jsonb_build_object('workspace_id',ws,'channel_id',channel_id)
    );
  end if;
  expected=(payload->>'expected_version')::integer;
  if current_row.version is distinct from expected then raise exception '发信通道已被修改，请重新加载后重试'; end if;

  delete from edm_private.delivery_channel_credentials credential
  where credential.workspace_id=ws and credential.channel_id=current_row.id;
  update edm.delivery_channels set
    status='disconnected',credential_hint=null,credential_version=0,
    last_verified_at=null,last_error_code=null,disconnected_at=clock_timestamp(),
    updated_by=auth.uid(),updated_at=clock_timestamp(),version=version+1
  where workspace_id=ws and id=current_row.id;

  perform edm_private.log_activity(
    ws,'delivery_channel.disconnected','delivery_channel',current_row.id,
    provider_row.display_name,
    jsonb_strip_nulls(jsonb_build_object(
      'provider',current_row.provider,
      'region',current_row.provider_config->>'region',
      'sender_domain',current_row.sender_domain
    )),
    'delivery-channel-disconnected:'||current_row.id::text||':'||current_row.version::text
  );
  return edm_private.get_delivery_channel(
    jsonb_build_object('workspace_id',ws,'channel_id',channel_id)
  );
end;
$$;

create or replace function edm_private.configure_delivery_tracking(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  expected integer := (payload->>'expected_version')::integer;
  enabled boolean;
  tag_name text := nullif(btrim(coalesce(payload->>'tracking_tag_name','')),'');
  configuration_set text := nullif(btrim(coalesce(payload->>'configuration_set_name','')),'');
  channel_row edm.delivery_channels;
  provider_row edm.delivery_providers;
  config_value jsonb;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以配置行为追踪' using errcode='42501';
  end if;
  if jsonb_typeof(payload->'tracking_enabled') is distinct from 'boolean' then
    raise exception '行为追踪开关无效';
  end if;
  enabled=(payload->>'tracking_enabled')::boolean;

  -- 服务商决定追踪配置的校验形状，因此先取通道再校验；
  -- 校验顺序与去耦前一致：配置错误优先于断开与版本冲突。
  select * into channel_row from edm.delivery_channels
  where workspace_id=ws and id=requested_channel_id
  for update;
  if not found then raise exception '发信通道不存在或不可访问'; end if;
  select * into provider_row from edm.delivery_providers where provider=channel_row.provider;
  if enabled and not (
    provider_row.supports_open_tracking or provider_row.supports_click_tracking
  ) then raise exception '该发信服务商不支持行为追踪'; end if;

  config_value=edm_private.delivery_provider_config(
    channel_row.provider,
    channel_row.provider_config || jsonb_strip_nulls(jsonb_build_object(
      'tracking_tag_name',tag_name,
      'configuration_set_name',configuration_set
    ))
  );
  if enabled and not edm_private.delivery_tracking_configured(
    channel_row.provider,config_value
  ) then
    if channel_row.provider='aliyun_directmail' then
      raise exception '开启追踪前请填写阿里云标签';
    end if;
    raise exception '开启追踪前请填写该服务商所需的追踪配置';
  end if;

  if channel_row.status='disconnected' then raise exception '发信通道已断开'; end if;
  if channel_row.version is distinct from expected then
    raise exception '发信通道已被修改，请重新加载后重试';
  end if;

  update edm.delivery_channels set
    tracking_enabled=enabled,
    provider_config=config_value,
    updated_by=auth.uid(),
    updated_at=clock_timestamp(),
    version=version+1
  where id=channel_row.id;

  perform edm_private.log_activity(
    ws,'delivery_tracking.configured','delivery_channel',channel_row.id,
    provider_row.display_name||'行为追踪',
    jsonb_build_object(
      'provider',channel_row.provider,
      'enabled',enabled,
      'tag_configured',edm_private.delivery_tracking_configured(
        channel_row.provider,config_value
      )
    )
  );
  return edm_private.get_delivery_channel(
    jsonb_build_object('workspace_id',ws,'channel_id',channel_row.id)
  );
end;
$$;

create or replace function edm_private.freeze_delivery_tracking() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  channel_row edm.delivery_channels;
begin
  select * into channel_row
  from edm.delivery_channels
  where workspace_id=new.workspace_id and id=new.channel_id;
  if not found then raise exception '发信通道不存在'; end if;
  new.provider=channel_row.provider;
  new.provider_config=channel_row.provider_config;
  new.tracking_enabled=channel_row.tracking_enabled;
  return new;
end;
$$;

create or replace function edm_private.configure_delivery_webhook(payload jsonb) returns jsonb
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
    where workspace_id=ws and id=requested_channel_id
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
    ws,'delivery_webhook.configured','delivery_channel',requested_channel_id,'回执 Webhook',
    jsonb_build_object('rotated',current_row.channel_id is not null)
  );
  return edm_private.get_delivery_channel(
    jsonb_build_object('workspace_id',ws,'channel_id',requested_channel_id)
  );
end;
$$;

create or replace function edm_private.webhook_authorize_delivery_event(payload jsonb) returns jsonb
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
  select * into channel_row from edm.delivery_channels where id=requested_channel_id;
  if not found then return null; end if;
  update edm_private.delivery_webhook_tokens set last_authenticated_at=clock_timestamp()
  where channel_id=requested_channel_id;
  return jsonb_strip_nulls(jsonb_build_object(
    'channel_id',channel_row.id,'workspace_id',channel_row.workspace_id,
    'provider',channel_row.provider,
    'provider_config',channel_row.provider_config,
    'region',channel_row.provider_config->>'region',
    'sender_address',channel_row.sender_address
  ));
end;
$$;

create or replace function edm_private.webhook_ingest_delivery_event(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  requested_digest text := lower(coalesce(payload->>'token_digest',''));
  incoming_failure_class text := nullif(btrim(coalesce(payload->>'failure_class','')),'');
  resolved_failure_class text;
  channel_row edm.delivery_channels;
  existing_row edm.campaign_delivery_events;
  new_event_id uuid;
  result jsonb;
begin
  if requested_digest !~ '^[0-9a-f]{64}$'
    or not edm_private.delivery_webhook_token_matches(requested_channel_id,requested_digest) then
    raise exception 'WEBHOOK_UNAUTHORIZED' using errcode='42501';
  end if;
  select * into channel_row from edm.delivery_channels where id=requested_channel_id;
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
  if incoming_failure_class is not null and incoming_failure_class not in (
    'hard_bounce','soft_bounce','complaint','undetermined'
  ) then raise exception 'WEBHOOK_EVENT_INVALID'; end if;

  -- 适配器已归一化时直接采用；否则按服务商兜底推导。
  resolved_failure_class=case
    when payload->>'event_type'<>'delivery_failed' then null
    else coalesce(incoming_failure_class,edm_private.delivery_failure_class(
      channel_row.provider,
      nullif(payload->>'provider_status',''),
      nullif(payload->>'failure_type','')
    ))
  end;

  insert into edm.campaign_delivery_events(
    workspace_id,channel_id,provider,provider_event_id,provider_event_type,event_type,
    provider_env_id,provider_message_id,sender_address,recipient_email,
    provider_status,error_code,failure_type,failure_class,occurred_at,
    provider_sent_at,payload_sha256
  ) values(
    channel_row.workspace_id,channel_row.id,channel_row.provider,payload->>'provider_event_id',
    payload->>'provider_event_type',payload->>'event_type',
    left(nullif(payload->>'provider_env_id',''),255),left(nullif(payload->>'provider_message_id',''),255),
    lower(left(nullif(payload->>'sender_address',''),254)),lower(left(payload->>'recipient_email',254)),
    left(nullif(payload->>'provider_status',''),50),left(nullif(payload->>'error_code',''),100),
    left(nullif(payload->>'failure_type',''),100),resolved_failure_class,
    (payload->>'occurred_at')::timestamptz,
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

create or replace function edm_private.apply_delivery_event(requested_event_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  event_row edm.campaign_delivery_events;
  provider_label text;
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
  select display_name into provider_label from edm.delivery_providers
  where provider=event_row.provider;

  -- 投诉、退订和硬退信先进入全工作区抑制，不依赖任务是否已匹配。
  suppression_reason=case
    when event_row.event_type='fbl_complaint' then 'complained'
    when event_row.event_type='provider_unsubscribed' then 'unsubscribed'
    when event_row.event_type='delivery_failed' and event_row.failure_class='hard_bounce' then 'bounced'
    when event_row.event_type='delivery_failed' and event_row.failure_class='complaint' then 'complained'
  end;
  if suppression_reason is not null and event_row.subscription_event_id is null then
    perform pg_advisory_xact_lock(hashtextextended(event_row.workspace_id::text||':'||event_row.recipient_email,0));
    select id into target_contact_id from edm.contacts
    where workspace_id=event_row.workspace_id and email=event_row.recipient_email;
    insert into edm.subscription_events(
      workspace_id,contact_id,email,event_type,source,note,metadata
    ) values(
      event_row.workspace_id,target_contact_id,event_row.recipient_email,suppression_reason,
      event_row.provider||'_webhook','由'||coalesce(provider_label,event_row.provider)||'回执自动记录',
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
      when event_row.failure_class='hard_bounce' then 'hard_bounced'
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
    or (event_row.event_type='delivery_failed' and event_row.failure_class='complaint') then
    next_status=case
      when event_row.event_type='fbl_complaint' or event_row.failure_class='complaint' then 'complained'
      else 'unsubscribed' end;
    next_priority=case next_status when 'complained' then 2 else 1 end;
    select case feedback_status
      when 'complained' then 2 when 'unsubscribed' then 1 else 0 end
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

create or replace function edm_private.prepare_delivery_test(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  requested_channel_id uuid := (payload->>'channel_id')::uuid;
  attempt_id uuid := (payload->>'attempt_id')::uuid;
  idempotency uuid := (payload->>'idempotency_key')::uuid;
  expected integer := (payload->>'expected_version')::integer;
  channel_row edm.delivery_channels;
  provider_row edm.delivery_providers;
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
  where workspace_id=ws and id=requested_channel_id
  for update;
  if not found then raise exception '发信通道不存在或不可访问'; end if;
  select * into provider_row from edm.delivery_providers where provider=channel_row.provider;

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
    provider_row.display_name,
    jsonb_strip_nulls(jsonb_build_object(
      'provider',channel_row.provider,
      'region',channel_row.provider_config->>'region',
      'attempt_id',attempt_row.id,
      'channel_version',channel_row.version,
      'credential_version',channel_row.credential_version
    )),
    'delivery-channel-test-started:'||attempt_row.id::text
  );

  return jsonb_build_object(
    'attempt',edm_private.delivery_test_summary(attempt_row),
    'is_new',true
  );
end;
$$;

create or replace function edm.worker_claim_delivery_test(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  attempt_id uuid := (payload->>'attempt_id')::uuid;
  recipient text := lower(btrim(coalesce(payload->>'recipient_email','')));
  recipient_local text;
  recipient_domain text;
  attempt_row edm.delivery_test_attempts;
  channel_row edm.delivery_channels;
  provider_row edm.delivery_providers;
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
  where workspace_id=ws and id=attempt_row.channel_id;
  select * into credential_row from edm_private.delivery_channel_credentials
  where workspace_id=ws and channel_id=attempt_row.channel_id;
  select * into provider_row from edm.delivery_providers where provider=channel_row.provider;

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
      coalesce(provider_row.display_name,'发信通道'),
      jsonb_build_object(
        'provider',coalesce(channel_row.provider,'unknown'),'attempt_id',attempt_row.id,
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
    'channel',jsonb_strip_nulls(jsonb_build_object(
      'id',channel_row.id,
      'provider',channel_row.provider,
      'provider_config',channel_row.provider_config,
      'region',channel_row.provider_config->>'region',
      'sender_address',channel_row.sender_address,
      'sender_alias',channel_row.sender_alias,
      'reply_to_address',channel_row.reply_to_address,
      'channel_version',channel_row.version,
      'credential_version',channel_row.credential_version
    )),
    'credential',jsonb_build_object(
      'key_id',credential_row.key_id,
      'nonce',encode(credential_row.nonce,'base64'),
      'ciphertext',encode(credential_row.ciphertext,'base64'),
      'credential_version',credential_row.credential_version
    )
  );
end;
$$;

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
  workspace_row edm.workspaces;
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

    -- 限速按发送运行冻结的服务商解析，允许通道覆盖注册表默认值。
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

create or replace function edm_private.guard_active_campaign_delivery_channel() returns trigger
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
  if new.provider<>old.provider
    or (new.provider_config->>'region') is distinct from (old.provider_config->>'region')
    or new.sender_domain is distinct from old.sender_domain
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

create or replace function edm_private.set_campaign_delivery_paused(payload jsonb) returns jsonb
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
    if channel_row.provider<>run_row.provider
      or (channel_row.provider_config->>'region') is distinct from (run_row.provider_config->>'region')
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

create or replace function edm_private.campaign_delivery_statistics(requested_run_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'provider',run.provider,
    'tracking_enabled',run.tracking_enabled,
    'tracking_tag_name',run.provider_config->>'tracking_tag_name',
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

-- 7. 授权

revoke all on edm.delivery_providers from public,anon,authenticated;
revoke all on function
  edm.list_delivery_providers(),
  edm_private.list_delivery_providers(),
  edm_private.delivery_provider_config(text,jsonb),
  edm_private.delivery_tracking_configured(text,jsonb),
  edm_private.delivery_failure_class(text,text,text)
from public,anon,authenticated;
grant execute on function
  edm.list_delivery_providers(),
  edm_private.list_delivery_providers()
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.delivery_providers from aigc_api;
    revoke all on function
      edm.list_delivery_providers(),
      edm_private.list_delivery_providers(),
      edm_private.delivery_provider_config(text,jsonb),
      edm_private.delivery_tracking_configured(text,jsonb),
      edm_private.delivery_failure_class(text,text,text)
    from aigc_api;
  end if;
end $$;
