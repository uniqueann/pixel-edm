-- P3-2 活动编辑选项：只返回表单需要的模板摘要与标签，不暴露模板正文。
create function edm_private.get_campaign_editor_options(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  templates_result jsonb;
  tags_result jsonb;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有活动管理权限' using errcode='42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',t.id,
        'name',t.name,
        'category',t.category,
        'variable_keys',coalesce((
          select jsonb_agg(variable.key order by variable.position)
          from (
            values
              ('store_name',1),
              ('sender_name',2),
              ('discount',3),
              ('product',4),
              ('order_number',5)
          ) as variable(key,position)
          where (t.subject||E'\n'||t.body) ~ (
            '\{\{[[:space:]]*'||variable.key||'[[:space:]]*\}\}'
          )
        ),'[]'::jsonb)
      ) order by lower(t.category),lower(t.name),t.id
    ),
    '[]'::jsonb
  ) into templates_result
  from edm.templates t
  where t.workspace_id=ws and t.archived_at is null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id',tag.id,'name',tag.name)
      order by lower(tag.name),tag.id
    ),
    '[]'::jsonb
  ) into tags_result
  from edm.tags tag
  where tag.workspace_id=ws;

  return jsonb_build_object('templates',templates_result,'tags',tags_result);
end;
$$;

create function edm.get_campaign_editor_options(payload jsonb) returns jsonb
language sql security invoker set search_path=''
as $$ select edm_private.get_campaign_editor_options(payload); $$;

revoke all on function
  edm.get_campaign_editor_options(jsonb),
  edm_private.get_campaign_editor_options(jsonb)
from public,anon,authenticated;
grant execute on function
  edm.get_campaign_editor_options(jsonb),
  edm_private.get_campaign_editor_options(jsonb)
to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on function
      edm.get_campaign_editor_options(jsonb),
      edm_private.get_campaign_editor_options(jsonb)
    from aigc_api;
  end if;
end $$;
