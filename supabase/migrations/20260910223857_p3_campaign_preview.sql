-- P3-3 动态收件人、变量完整性校验与前三封预览。仅修改 EDM 对象。
create index contacts_campaign_eligible_idx
on edm.contacts(workspace_id,created_at,id)
where archived_at is null and subscription_status='subscribed';

create function edm_private.campaign_required_variables(subject_value text,body_value text) returns text[]
language sql immutable set search_path='' as $$
  select coalesce(array_agg(variable.key order by variable.position),'{}'::text[])
  from (
    values
      ('store_name',1),
      ('sender_name',2),
      ('discount',3),
      ('product',4),
      ('order_number',5)
  ) as variable(key,position)
  where (subject_value||E'\n'||body_value) ~ (
    '\{\{[[:space:]]*'||variable.key||'[[:space:]]*\}\}'
  );
$$;

-- 替换值按字面量处理，避免反斜杠被 regexp_replace 当作反向引用。
create function edm_private.render_campaign_text(
  source_value text,
  contact_name text,
  contact_email text,
  campaign_variables jsonb
) returns text
language plpgsql immutable set search_path='' as $$
declare
  result text := source_value;
  variable_key text;
  replacement_value text;
begin
  foreach variable_key in array array[
    'name','email','store_name','sender_name','discount','product','order_number'
  ] loop
    replacement_value=case variable_key
      when 'name' then coalesce(nullif(btrim(contact_name),''),split_part(contact_email,'@',1))
      when 'email' then contact_email
      else btrim(coalesce(campaign_variables->>variable_key,''))
    end;
    replacement_value=replace(replacement_value,E'\\',E'\\\\');
    result=regexp_replace(
      result,
      '\{\{[[:space:]]*'||variable_key||'[[:space:]]*\}\}',
      replacement_value,
      'g'
    );
  end loop;
  return result;
end;
$$;

create function edm_private.get_campaign_preview(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  campaign_id uuid := (payload->>'id')::uuid;
  campaign_row edm.campaigns;
  template_row edm.templates;
  required_variables text[];
  missing_variables text[];
  blockers jsonb := '[]'::jsonb;
  preview_is_valid boolean;
  audience_count integer;
  eligible_count integer;
  archived_count integer;
  suppressed_count integer;
  not_subscribed_count integer;
  preview_sample jsonb;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有活动预览权限' using errcode='42501';
  end if;

  select * into campaign_row
  from edm.campaigns
  where workspace_id=ws and id=campaign_id;
  if not found then raise exception '活动不存在或不可访问'; end if;
  if campaign_row.archived_at is not null then raise exception '已归档活动不能预览'; end if;
  if campaign_row.status<>'draft' then raise exception '只有草稿活动可以预览'; end if;

  select * into template_row
  from edm.templates
  where workspace_id=ws and id=campaign_row.template_id;
  if not found then raise exception '模板不存在或不可访问'; end if;

  required_variables=edm_private.campaign_required_variables(template_row.subject,template_row.body);
  select coalesce(array_agg(variable_key order by position),'{}'::text[])
  into missing_variables
  from unnest(required_variables) with ordinality as required(variable_key,position)
  where nullif(btrim(campaign_row.variables->>variable_key),'') is null;

  if template_row.archived_at is not null then
    blockers=blockers||jsonb_build_array(jsonb_build_object(
      'code','template_archived',
      'message','当前模板已归档，请恢复模板或改选使用中的模板。'
    ));
  end if;
  if cardinality(missing_variables)>0 then
    blockers=blockers||jsonb_build_array(jsonb_build_object(
      'code','missing_variables',
      'message','请补充活动变量：'||array_to_string(
        array(select '{{'||value||'}}' from unnest(missing_variables) as value),
        '、'
      )
    ));
  end if;
  preview_is_valid=jsonb_array_length(blockers)=0;

  with audience as (
    select
      contact.id,
      contact.email,
      contact.name,
      contact.created_at,
      case
        when contact.archived_at is not null then 'archived'
        when exists(
          select 1 from edm.suppressions suppression
          where suppression.workspace_id=ws and suppression.email=contact.email
        ) then 'suppressed'
        when contact.subscription_status<>'subscribed' then 'not_subscribed'
      end as exclusion_reason
    from edm.contacts contact
    where contact.workspace_id=ws
      and (
        campaign_row.audience_type='all'
        or exists(
          select 1 from edm.contact_tags contact_tag
          where contact_tag.workspace_id=ws
            and contact_tag.contact_id=contact.id
            and contact_tag.tag_id=campaign_row.tag_id
        )
      )
  ), totals as (
    select
      count(*)::integer as audience_count,
      count(*) filter(where exclusion_reason is null)::integer as eligible_count,
      count(*) filter(where exclusion_reason='archived')::integer as archived_count,
      count(*) filter(where exclusion_reason='suppressed')::integer as suppressed_count,
      count(*) filter(where exclusion_reason='not_subscribed')::integer as not_subscribed_count
    from audience
  ), sample as (
    select * from audience
    where exclusion_reason is null and preview_is_valid
    order by created_at,id
    limit 3
  )
  select
    totals.audience_count,
    totals.eligible_count,
    totals.archived_count,
    totals.suppressed_count,
    totals.not_subscribed_count,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'contact_id',sample.id,
          'email',sample.email,
          'name',coalesce(nullif(btrim(sample.name),''),split_part(sample.email,'@',1)),
          'subject',edm_private.render_campaign_text(
            template_row.subject,sample.name,sample.email,campaign_row.variables
          ),
          'body',edm_private.render_campaign_text(
            template_row.body,sample.name,sample.email,campaign_row.variables
          )
        ) order by sample.created_at,sample.id
      ) from sample
    ),'[]'::jsonb)
  into
    audience_count,
    eligible_count,
    archived_count,
    suppressed_count,
    not_subscribed_count,
    preview_sample
  from totals;

  return jsonb_build_object(
    'campaign',jsonb_build_object(
      'id',campaign_row.id,
      'name',campaign_row.name,
      'version',campaign_row.version
    ),
    'template',jsonb_build_object(
      'id',template_row.id,
      'name',template_row.name,
      'version',template_row.version
    ),
    'calculated_at',statement_timestamp(),
    'validation',jsonb_build_object(
      'valid',preview_is_valid,
      'missing_variables',to_jsonb(missing_variables),
      'blockers',blockers
    ),
    'recipients',jsonb_build_object(
      'audience_count',audience_count,
      'eligible_count',eligible_count,
      'excluded_count',audience_count-eligible_count,
      'excluded',jsonb_build_object(
        'archived',archived_count,
        'not_subscribed',not_subscribed_count,
        'suppressed',suppressed_count
      ),
      'sample',preview_sample
    )
  );
end;
$$;

create function edm.get_campaign_preview(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.get_campaign_preview(payload); $$;

revoke all on function
  edm.get_campaign_preview(jsonb),
  edm_private.get_campaign_preview(jsonb),
  edm_private.campaign_required_variables(text,text),
  edm_private.render_campaign_text(text,text,text,jsonb)
from public,anon,authenticated;
grant execute on function
  edm.get_campaign_preview(jsonb),
  edm_private.get_campaign_preview(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on function
      edm.get_campaign_preview(jsonb),
      edm_private.get_campaign_preview(jsonb),
      edm_private.campaign_required_variables(text,text),
      edm_private.render_campaign_text(text,text,text,jsonb)
    from aigc_api;
  end if;
end $$;
