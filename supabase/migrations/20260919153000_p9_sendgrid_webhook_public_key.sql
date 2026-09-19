-- P9-2：SendGrid Event Webhook 验签公钥可写入 provider_config（可选字段）。
-- 仅操作 edm_private.delivery_provider_config 的 sendgrid 分支。

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
  webhook_public_key text;
  aws_partition text;
begin
  if jsonb_typeof(source)<>'object' then raise exception '服务商配置格式无效'; end if;
  region_value=nullif(btrim(coalesce(source->>'region','')),'');
  tag_value=nullif(btrim(coalesce(source->>'tracking_tag_name','')),'');
  configuration_set=nullif(btrim(coalesce(source->>'configuration_set_name','')),'');
  sns_topic_arn=nullif(btrim(coalesce(source->>'sns_topic_arn','')),'');
  api_host_value=nullif(btrim(coalesce(source->>'api_host','')),'');
  webhook_public_key=nullif(btrim(coalesce(source->>'event_webhook_public_key','')),'');
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
    if webhook_public_key is not null and char_length(webhook_public_key)>8192 then
      raise exception 'SendGrid Webhook 公钥过长';
    end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'api_host',api_host_value,
      'event_webhook_public_key',webhook_public_key
    ));
  end if;

  raise exception '不支持的发信服务商';
end;
$$;
