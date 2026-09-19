-- P9-1 SendGrid 服务商登记：注册表、provider_config 与退信兜底。
-- 仅操作 edm / edm_private；不修改 aigc、共享 Auth 或既有迁移历史。
-- 首版 enabled=false，配置入口在 P9-3/P9-4 验收后打开。

insert into edm.delivery_providers(
  provider,display_name,enabled,sender_alias_max_length,requires_sender_domain,
  supports_open_tracking,supports_click_tracking,requires_html_for_tracking,
  supports_link_tracking_opt_out,requires_webhook_subscription_confirmation,
  default_rate_per_second,default_daily_quota,quota_timezone
) values
  ('sendgrid','SendGrid',false,64,true,true,true,true,true,false,10,100000,'UTC')
on conflict (provider) do update set
  display_name=excluded.display_name,
  sender_alias_max_length=excluded.sender_alias_max_length,
  requires_sender_domain=excluded.requires_sender_domain,
  supports_open_tracking=excluded.supports_open_tracking,
  supports_click_tracking=excluded.supports_click_tracking,
  requires_html_for_tracking=excluded.requires_html_for_tracking,
  supports_link_tracking_opt_out=excluded.supports_link_tracking_opt_out,
  requires_webhook_subscription_confirmation=
    excluded.requires_webhook_subscription_confirmation,
  default_rate_per_second=excluded.default_rate_per_second,
  default_daily_quota=excluded.default_daily_quota,
  quota_timezone=excluded.quota_timezone,
  updated_at=now();

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
  api_host_value text;
  aws_partition text;
begin
  if jsonb_typeof(source)<>'object' then raise exception '服务商配置格式无效'; end if;
  region_value=nullif(btrim(coalesce(source->>'region','')),'');
  tag_value=nullif(btrim(coalesce(source->>'tracking_tag_name','')),'');
  configuration_set=nullif(btrim(coalesce(source->>'configuration_set_name','')),'');
  sns_topic_arn=nullif(btrim(coalesce(source->>'sns_topic_arn','')),'');
  api_host_value=nullif(btrim(coalesce(source->>'api_host','')),'');
  if api_host_value is null and region_value in ('global','eu') then
    api_host_value=region_value;
  end if;

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

  if provider_name='sendgrid' then
    if api_host_value is null then api_host_value='global'; end if;
    if api_host_value not in ('global','eu') then
      raise exception 'SendGrid 数据中心无效';
    end if;
    return jsonb_build_object('api_host',api_host_value);
  end if;

  raise exception '不支持的发信服务商';
end;
$$;

create or replace function edm_private.delivery_tracking_configured(
  provider_name text,
  config jsonb
) returns boolean
language sql immutable set search_path='' as $$
  select case provider_name
    when 'aliyun_directmail' then coalesce(config->>'tracking_tag_name','')<>''
    when 'amazon_ses' then coalesce(config->>'configuration_set_name','')<>''
    when 'sendgrid' then true
    else false
  end;
$$;

create or replace function edm_private.delivery_failure_class(
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
    when provider_name='sendgrid' and lower(coalesce(failure_type,'')) in (
      'blocked','invalid','hard','hard_bounce'
    ) then 'hard_bounce'
    when provider_name='sendgrid' and lower(coalesce(failure_type,'')) in (
      'expired','soft','soft_bounce'
    ) then 'soft_bounce'
    else 'undetermined'
  end;
$$;
