-- P4-0 / P4-1 阿里云邮件推送通道配置。
-- 仅创建 EDM 对象；不修改共享 Auth、AIGC 或其他项目对象。

create table edm.delivery_channels (
  id uuid primary key,
  workspace_id uuid not null references edm.workspaces(id),
  provider text not null default 'aliyun_directmail'
    check (provider='aliyun_directmail'),
  status text not null default 'incomplete'
    check (status in ('incomplete','configured','verified','error','disconnected')),
  region text not null
    check (region in ('cn-hangzhou','ap-southeast-1','us-east-1','eu-central-1')),
  sender_domain text not null
    check (
      sender_domain=lower(btrim(sender_domain))
      and char_length(sender_domain) between 3 and 253
      and sender_domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    ),
  sender_address text not null
    check (
      sender_address=lower(btrim(sender_address))
      and char_length(sender_address) between 3 and 254
      and sender_address ~ '^[^[:space:]@]+@[^[:space:]@]+$'
      and split_part(sender_address,'@',2)=sender_domain
    ),
  sender_alias text not null
    check (sender_alias=btrim(sender_alias) and char_length(sender_alias) between 1 and 14),
  reply_to_address text
    check (
      reply_to_address is null or (
        reply_to_address=lower(btrim(reply_to_address))
        and char_length(reply_to_address) between 3 and 254
        and reply_to_address ~ '^[^[:space:]@]+@[^[:space:]@]+$'
      )
    ),
  access_key_hint text check (access_key_hint is null or char_length(access_key_hint)=4),
  credential_version integer not null default 0 check (credential_version>=0),
  last_verified_at timestamptz,
  last_error_code text check (last_error_code is null or char_length(last_error_code)<=100),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz,
  version integer not null default 1 check (version>0),
  unique(workspace_id,id),
  unique(workspace_id,provider),
  foreign key(workspace_id,created_by) references edm.workspace_members(workspace_id,user_id),
  foreign key(workspace_id,updated_by) references edm.workspace_members(workspace_id,user_id)
);

create index delivery_channels_created_by_idx
  on edm.delivery_channels(workspace_id,created_by);
create index delivery_channels_updated_by_idx
  on edm.delivery_channels(workspace_id,updated_by);

create table edm_private.delivery_channel_credentials (
  channel_id uuid primary key,
  workspace_id uuid not null,
  key_id text not null
    check (char_length(key_id) between 1 and 64 and key_id ~ '^[A-Za-z0-9._-]+$'),
  nonce bytea not null check (octet_length(nonce)=12),
  ciphertext bytea not null check (octet_length(ciphertext) between 17 and 8192),
  credential_version integer not null check (credential_version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,channel_id),
  foreign key(workspace_id,channel_id)
    references edm.delivery_channels(workspace_id,id) on delete cascade
);

alter table edm.delivery_channels enable row level security;
alter table edm_private.delivery_channel_credentials enable row level security;

create policy delivery_channels_member_read on edm.delivery_channels
  for select to authenticated
  using ((select edm_private.workspace_role(workspace_id)) is not null);

-- 私密表即使未来误授予表权限，也明确拒绝客户端角色访问。
create policy delivery_channel_credentials_deny_authenticated
  on edm_private.delivery_channel_credentials
  for all to authenticated using (false) with check (false);

create trigger delivery_channels_updated before update on edm.delivery_channels
  for each row execute function edm_private.touch_updated_at();
create trigger delivery_channel_credentials_updated
  before update on edm_private.delivery_channel_credentials
  for each row execute function edm_private.touch_updated_at();

create function edm_private.get_delivery_channel(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  role_name text;
  channel_row edm.delivery_channels;
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

  return jsonb_strip_nulls(jsonb_build_object(
    'id',channel_row.id,
    'workspace_id',channel_row.workspace_id,
    'provider',channel_row.provider,
    'status',channel_row.status,
    'region',channel_row.region,
    'sender_domain',channel_row.sender_domain,
    'sender_address',channel_row.sender_address,
    'sender_alias',channel_row.sender_alias,
    'reply_to_address',channel_row.reply_to_address,
    'credential_configured',has_credentials,
    'access_key_hint',case when role_name='admin' then channel_row.access_key_hint else null end,
    'credential_version',case when role_name='admin' then channel_row.credential_version else null end,
    'last_verified_at',channel_row.last_verified_at,
    'last_error_code',case when role_name='admin' then channel_row.last_error_code else null end,
    'disconnected_at',channel_row.disconnected_at,
    'created_at',channel_row.created_at,
    'updated_at',channel_row.updated_at,
    'version',channel_row.version
  ));
end;
$$;

create function edm_private.save_delivery_channel(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  channel_id uuid := (payload->>'id')::uuid;
  channel_region text := btrim(coalesce(payload->>'region',''));
  channel_domain text := lower(btrim(coalesce(payload->>'sender_domain','')));
  channel_address text := lower(btrim(coalesce(payload->>'sender_address','')));
  channel_alias text := btrim(coalesce(payload->>'sender_alias',''));
  channel_reply_to text := nullif(lower(btrim(coalesce(payload->>'reply_to_address',''))),'');
  expected integer;
  current_row edm.delivery_channels;
  credential jsonb := payload->'credential';
  has_credential boolean := credential is not null;
  credential_key_id text;
  credential_hint text;
  envelope_version integer;
  nonce_bytes bytea;
  ciphertext_bytes bytea;
  reset_verification boolean := false;
  action_name text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以配置发信通道' using errcode='42501';
  end if;
  if channel_id is null then raise exception '通道标识不能为空'; end if;
  if channel_region not in ('cn-hangzhou','ap-southeast-1','us-east-1','eu-central-1') then
    raise exception '阿里云区域无效';
  end if;
  if channel_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    or char_length(channel_domain)>253 then raise exception '发件域名格式无效'; end if;
  if char_length(channel_address) not between 3 and 254
    or channel_address !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or split_part(channel_address,'@',2)<>channel_domain then
    raise exception '发件地址必须属于所填发件域名';
  end if;
  if char_length(channel_alias) not between 1 and 14 then raise exception '发件人名称应为 1 至 14 个字符'; end if;
  if channel_reply_to is not null and (
    char_length(channel_reply_to) not between 3 and 254
    or channel_reply_to !~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ) then raise exception '回复地址格式无效'; end if;

  if has_credential then
    if jsonb_typeof(credential)<>'object' then raise exception '凭据密文格式无效'; end if;
    credential_key_id=btrim(coalesce(credential->>'key_id',''));
    credential_hint=coalesce(credential->>'access_key_hint','');
    envelope_version=(credential->>'credential_version')::integer;
    if char_length(credential_key_id) not between 1 and 64
      or credential_key_id !~ '^[A-Za-z0-9._-]+$'
      or char_length(credential_hint)<>4 then raise exception '凭据密文元数据无效'; end if;
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

  select * into current_row from edm.delivery_channels
  where workspace_id=ws and provider='aliyun_directmail' for update;

  if not found then
    if not has_credential or envelope_version<>1 then raise exception '首次连接必须提交完整凭据'; end if;
    insert into edm.delivery_channels(
      id,workspace_id,region,sender_domain,sender_address,sender_alias,reply_to_address,
      status,access_key_hint,credential_version,created_by,updated_by
    ) values(
      channel_id,ws,channel_region,channel_domain,channel_address,channel_alias,channel_reply_to,
      'configured',credential_hint,1,auth.uid(),auth.uid()
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
      or current_row.region<>channel_region
      or current_row.sender_domain<>channel_domain
      or current_row.sender_address<>channel_address
      or current_row.status='disconnected';

    update edm.delivery_channels set
      region=channel_region,
      sender_domain=channel_domain,
      sender_address=channel_address,
      sender_alias=channel_alias,
      reply_to_address=channel_reply_to,
      status=case when reset_verification then 'configured' else status end,
      access_key_hint=case when has_credential then credential_hint else access_key_hint end,
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
    ws,action_name,'delivery_channel',channel_id,'阿里云邮件推送',
    jsonb_build_object(
      'provider','aliyun_directmail',
      'region',channel_region,
      'sender_domain',channel_domain,
      'credential_changed',has_credential,
      'status','configured'
    )
  );
  return edm_private.get_delivery_channel(jsonb_build_object('workspace_id',ws));
end;
$$;

create function edm_private.disconnect_delivery_channel(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  channel_id uuid := (payload->>'id')::uuid;
  expected integer;
  current_row edm.delivery_channels;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以断开发信通道' using errcode='42501';
  end if;
  select * into current_row from edm.delivery_channels
  where workspace_id=ws and id=channel_id and provider='aliyun_directmail' for update;
  if not found then raise exception '发信通道不存在或不可访问'; end if;

  -- 已断开时直接返回，确保重复点击不会重复写审计。
  if current_row.status='disconnected' then
    return edm_private.get_delivery_channel(jsonb_build_object('workspace_id',ws));
  end if;
  expected=(payload->>'expected_version')::integer;
  if current_row.version is distinct from expected then raise exception '发信通道已被修改，请重新加载后重试'; end if;

  delete from edm_private.delivery_channel_credentials credential
  where credential.workspace_id=ws and credential.channel_id=current_row.id;
  update edm.delivery_channels set
    status='disconnected',access_key_hint=null,credential_version=0,
    last_verified_at=null,last_error_code=null,disconnected_at=clock_timestamp(),
    updated_by=auth.uid(),updated_at=clock_timestamp(),version=version+1
  where workspace_id=ws and id=current_row.id;

  perform edm_private.log_activity(
    ws,'delivery_channel.disconnected','delivery_channel',current_row.id,'阿里云邮件推送',
    jsonb_build_object('provider','aliyun_directmail','region',current_row.region,'sender_domain',current_row.sender_domain),
    'delivery-channel-disconnected:'||current_row.id::text||':'||current_row.version::text
  );
  return edm_private.get_delivery_channel(jsonb_build_object('workspace_id',ws));
end;
$$;

create function edm.get_delivery_channel(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.get_delivery_channel(payload); $$;
create function edm.save_delivery_channel(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.save_delivery_channel(payload); $$;
create function edm.disconnect_delivery_channel(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.disconnect_delivery_channel(payload); $$;

revoke all on edm.delivery_channels,edm_private.delivery_channel_credentials
from public,anon,authenticated;
revoke all on function
  edm.get_delivery_channel(jsonb),
  edm.save_delivery_channel(jsonb),
  edm.disconnect_delivery_channel(jsonb),
  edm_private.get_delivery_channel(jsonb),
  edm_private.save_delivery_channel(jsonb),
  edm_private.disconnect_delivery_channel(jsonb)
from public,anon,authenticated;
grant execute on function
  edm.get_delivery_channel(jsonb),
  edm.save_delivery_channel(jsonb),
  edm.disconnect_delivery_channel(jsonb),
  edm_private.get_delivery_channel(jsonb),
  edm_private.save_delivery_channel(jsonb),
  edm_private.disconnect_delivery_channel(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.delivery_channels,edm_private.delivery_channel_credentials from aigc_api;
    revoke all on function
      edm.get_delivery_channel(jsonb),
      edm.save_delivery_channel(jsonb),
      edm.disconnect_delivery_channel(jsonb),
      edm_private.get_delivery_channel(jsonb),
      edm_private.save_delivery_channel(jsonb),
      edm_private.disconnect_delivery_channel(jsonb)
    from aigc_api;
  end if;
end $$;
