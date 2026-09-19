-- P8-3 多通道列表与主通道切换；只扩展 edm / edm_private。

create or replace function edm_private.list_delivery_channels(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  role_name text;
begin
  if auth.uid() is null then raise exception '需要登录' using errcode='42501'; end if;
  role_name=edm_private.workspace_role(ws);
  if role_name is null then raise exception '工作区不可访问' using errcode='42501'; end if;

  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',channel.id,
      'workspace_id',channel.workspace_id,
      'provider',channel.provider,
      'display_name',provider.display_name,
      'status',channel.status,
      'is_primary',channel.is_primary,
      'region',channel.provider_config->>'region',
      'sender_domain',channel.sender_domain,
      'sender_address',channel.sender_address,
      'sender_alias',channel.sender_alias,
      'credential_configured',exists(
        select 1 from edm_private.delivery_channel_credentials credential
        where credential.workspace_id=ws and credential.channel_id=channel.id
      ),
      'credential_hint',case when role_name='admin' then channel.credential_hint end,
      'tracking_enabled',channel.tracking_enabled,
      'version',channel.version,
      'updated_at',channel.updated_at
    )) order by channel.is_primary desc, channel.created_at)
    from edm.delivery_channels channel
    join edm.delivery_providers provider on provider.provider=channel.provider
    where channel.workspace_id=ws
  ),'[]'::jsonb);
end;
$$;

create or replace function edm_private.set_primary_delivery_channel(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  channel_id uuid := (payload->>'channel_id')::uuid;
  expected integer := (payload->>'expected_version')::integer;
  channel_row edm.delivery_channels;
  provider_row edm.delivery_providers;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'')<>'admin' then
    raise exception '只有管理员可以切换主发信通道' using errcode='42501';
  end if;

  select * into channel_row from edm.delivery_channels
  where workspace_id=ws and id=channel_id for update;
  if not found then raise exception '发信通道不存在或不可访问'; end if;
  if channel_row.status='disconnected' then
    raise exception '已断开的发信通道不能设为主通道';
  end if;
  if channel_row.version is distinct from expected then
    raise exception '发信通道已被修改，请重新加载后重试';
  end if;
  if channel_row.is_primary then
    return edm_private.list_delivery_channels(jsonb_build_object('workspace_id',ws));
  end if;

  select * into provider_row from edm.delivery_providers
  where provider=channel_row.provider;

  update edm.delivery_channels set
    is_primary=false,
    updated_by=auth.uid(),
    updated_at=clock_timestamp(),
    version=version+1
  where workspace_id=ws and is_primary and id<>channel_id;

  update edm.delivery_channels set
    is_primary=true,
    updated_by=auth.uid(),
    updated_at=clock_timestamp(),
    version=version+1
  where id=channel_id;

  perform edm_private.log_activity(
    ws,'delivery_channel.primary_set','delivery_channel',channel_id,
    provider_row.display_name,
    jsonb_build_object('provider',channel_row.provider),
    'delivery-channel-primary:'||channel_id::text||':'||expected::text,
    true
  );

  return edm_private.list_delivery_channels(jsonb_build_object('workspace_id',ws));
end;
$$;

create function edm.list_delivery_channels(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.list_delivery_channels(payload); $$;

create function edm.set_primary_delivery_channel(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.set_primary_delivery_channel(payload); $$;

revoke all on function
  edm.list_delivery_channels(jsonb),
  edm.set_primary_delivery_channel(jsonb),
  edm_private.list_delivery_channels(jsonb),
  edm_private.set_primary_delivery_channel(jsonb)
from public,anon,authenticated;

grant execute on function
  edm.list_delivery_channels(jsonb),
  edm.set_primary_delivery_channel(jsonb),
  edm_private.list_delivery_channels(jsonb),
  edm_private.set_primary_delivery_channel(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on function
      edm.list_delivery_channels(jsonb),
      edm.set_primary_delivery_channel(jsonb),
      edm_private.list_delivery_channels(jsonb),
      edm_private.set_primary_delivery_channel(jsonb)
    from aigc_api;
  end if;
end $$;
