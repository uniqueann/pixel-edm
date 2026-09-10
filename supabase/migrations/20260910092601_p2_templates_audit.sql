-- P2 模板与业务审计：仅修改 edm / edm_private，不触碰共享 Auth 与 aigc。
create table edm.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references edm.workspaces(id),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 80),
  category text not null check (category=btrim(category) and char_length(category) between 1 and 50),
  subject text not null check (subject=btrim(subject) and char_length(subject) between 1 and 200 and subject !~ E'[\\r\\n]'),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  default_key text check (default_key is null or default_key ~ '^[a-z][a-z0-9_]{0,49}$'),
  source_template_id uuid,
  archived_at timestamptz,
  created_by uuid references edm.members(user_id),
  updated_by uuid references edm.members(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique(workspace_id,id),
  foreign key(workspace_id,source_template_id) references edm.templates(workspace_id,id)
);
create unique index templates_default_key_idx on edm.templates(workspace_id,default_key) where default_key is not null;
create index templates_list_idx on edm.templates(workspace_id,(archived_at is not null),created_at desc,id desc);
create index templates_source_idx on edm.templates(workspace_id,source_template_id) where source_template_id is not null;
create index templates_created_by_idx on edm.templates(created_by) where created_by is not null;
create index templates_updated_by_idx on edm.templates(updated_by) where updated_by is not null;

create table edm.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references edm.workspaces(id),
  actor_id uuid references edm.members(user_id),
  actor_name text not null check (char_length(actor_name) between 1 and 80),
  actor_role text not null check (actor_role in ('system','admin','editor','viewer')),
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,79}$'),
  target_type text not null check (target_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  target_id uuid,
  target_label text not null default '' check (char_length(target_label) <= 254),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object' and pg_column_size(metadata)<=16384),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now()
);
create unique index activity_logs_dedupe_idx on edm.activity_logs(workspace_id,dedupe_key) where dedupe_key is not null;
create index activity_logs_list_idx on edm.activity_logs(workspace_id,created_at desc,id desc);
create index activity_logs_actor_idx on edm.activity_logs(workspace_id,actor_id,created_at desc) where actor_id is not null;
create index activity_logs_actor_fk_idx on edm.activity_logs(actor_id) where actor_id is not null;

alter table edm.templates enable row level security;
alter table edm.activity_logs enable row level security;
create policy templates_read on edm.templates for select to authenticated
  using ((select edm_private.workspace_role(workspace_id)) is not null);
create policy activity_logs_admin_read on edm.activity_logs for select to authenticated
  using ((select edm_private.workspace_role(workspace_id))='admin');

create function edm_private.template_text_is_valid(value text) returns boolean
language sql immutable set search_path='' as $$
  select value is not null and regexp_replace(
    value,
    '\{\{[[:space:]]*(name|email|store_name|sender_name|discount|product|order_number)[[:space:]]*\}\}',
    '',
    'g'
  ) !~ '(\{\{|\}\})';
$$;
alter table edm.templates add constraint templates_subject_variables_valid check (edm_private.template_text_is_valid(subject));
alter table edm.templates add constraint templates_body_variables_valid check (edm_private.template_text_is_valid(body));

create function edm_private.log_activity(
  ws uuid,
  activity_action text,
  activity_target_type text,
  activity_target_id uuid,
  activity_target_label text,
  activity_metadata jsonb default '{}'::jsonb,
  activity_dedupe_key text default null,
  system_actor boolean default false
) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid(); role_name text; actor_display_name text; result_id uuid;
begin
  if not exists(select 1 from edm.workspaces where id=ws) then raise exception '工作区不存在'; end if;
  if system_actor then
    uid=null; role_name='system'; actor_display_name='系统';
  else
    if uid is null then raise exception '需要登录' using errcode='42501'; end if;
    role_name=edm_private.workspace_role(ws);
    if role_name is null then raise exception '工作区不可访问' using errcode='42501'; end if;
    select m.display_name into actor_display_name from edm.members m where m.user_id=uid;
    actor_display_name=coalesce(nullif(actor_display_name,''),'工作区成员');
  end if;
  insert into edm.activity_logs(workspace_id,actor_id,actor_name,actor_role,action,target_type,target_id,target_label,metadata,dedupe_key)
    values(ws,uid,actor_display_name,role_name,activity_action,activity_target_type,activity_target_id,left(coalesce(activity_target_label,''),254),
      coalesce(activity_metadata,'{}'::jsonb),activity_dedupe_key)
    on conflict(workspace_id,dedupe_key) where dedupe_key is not null do nothing
    returning id into result_id;
  return result_id;
end;
$$;

create function edm_private.seed_default_templates(ws uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare inserted_count integer;
begin
  if not exists(select 1 from edm.workspaces where id=ws) then raise exception '工作区不存在'; end if;
  insert into edm.templates(workspace_id,name,category,subject,body,default_key)
  values
    (ws,'欢迎新客户','欢迎系列','Welcome to {{store_name}} — here''s 10% off',E'Hi {{name}},\n\nThanks so much for joining {{store_name}}. We''re a small team and every order genuinely means a lot to us.\n\nHere''s a code for 10% off your first order: {{discount}}\n\nIf you ever have a question, just reply to this email.\n\nWelcome aboard,\n{{sender_name}}','welcome'),
    (ws,'弃购挽回','弃购挽回','You left {{product}} in your cart',E'Hi {{name}},\n\nI noticed {{product}} is still sitting in your cart. No pressure — just checking if you had any questions.\n\nHere''s {{discount}} off if you complete your order in the next 48 hours.\n\nBest,\n{{sender_name}}','abandoned_cart'),
    (ws,'促销活动','促销活动','{{discount}} off, this week only',E'Hi {{name}},\n\nQuick note from {{store_name}} — we''re running {{discount}} off through this week.\n\nCode: {{discount}}\n\nThanks for being here,\n{{sender_name}}','promotion'),
    (ws,'物流通知','物流通知','Your order {{order_number}} has shipped',E'Hi {{name}},\n\nGood news — order {{order_number}} is on its way. International shipping can take a little longer, so please allow the estimated window.\n\nThanks for your patience,\n{{sender_name}}','shipping'),
    (ws,'复购唤醒','复购唤醒','We miss you, {{name}}',E'Hi {{name}},\n\nIt''s been a while since your last order with {{store_name}}. Here''s {{discount}} off as a thank-you for being an early customer.\n\nWarmly,\n{{sender_name}}','winback'),
    (ws,'评价邀请','评价邀请','How''s {{product}} treating you?',E'Hi {{name}},\n\nHope {{product}} has been treating you well. A short review would mean a lot to a small store like ours.\n\nThank you,\n{{sender_name}}','review_request')
  on conflict(workspace_id,default_key) where default_key is not null do nothing;
  get diagnostics inserted_count=row_count;
  if inserted_count>0 then
    perform edm_private.log_activity(ws,'template.defaults_initialized','template_defaults',null,'六套默认模板',
      jsonb_build_object('inserted_count',inserted_count),'template-defaults-v1',true);
  end if;
  return inserted_count;
end;
$$;

create or replace function edm_private.initialize_member() returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); ws uuid; member_status text;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('edm:init:'||uid::text,0));
  insert into edm.members(user_id) values(uid) on conflict(user_id) do nothing;
  select status into member_status from edm.members where user_id=uid for update;
  if member_status<>'active' then raise exception 'EDM 账号已停用' using errcode='42501'; end if;
  select id into ws from edm.workspaces where bootstrap_owner_id=uid;
  if ws is null then
    insert into edm.workspaces(owner_id,bootstrap_owner_id) values(uid,uid) returning id into ws;
    insert into edm.workspace_members(workspace_id,user_id,role) values(ws,uid,'admin');
    perform edm_private.seed_default_templates(ws);
  end if;
  return ws;
end;
$$;

create function edm_private.save_template(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; template_id uuid := (payload->>'id')::uuid;
  current_row edm.templates; template_name text := btrim(coalesce(payload->>'name',''));
  template_category text := btrim(coalesce(payload->>'category',''));
  template_subject text := btrim(coalesce(payload->>'subject','')); template_body text := coalesce(payload->>'body','');
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有模板管理权限' using errcode='42501'; end if;
  if char_length(template_name) not between 1 and 80 then raise exception '模板名称应为 1 至 80 字'; end if;
  if char_length(template_category) not between 1 and 50 then raise exception '分类应为 1 至 50 字'; end if;
  if char_length(template_subject) not between 1 and 200 or template_subject ~ E'[\r\n]' then raise exception '主题应为 1 至 200 字且不能换行'; end if;
  if char_length(btrim(template_body)) not between 1 and 20000 then raise exception '正文应为 1 至 20000 字'; end if;
  if not edm_private.template_text_is_valid(template_subject) or not edm_private.template_text_is_valid(template_body) then
    raise exception '模板包含未知变量或未闭合的双花括号'; end if;
  if template_id is null then
    insert into edm.templates(workspace_id,name,category,subject,body,created_by,updated_by)
      values(ws,template_name,template_category,template_subject,template_body,auth.uid(),auth.uid()) returning id into template_id;
    perform edm_private.log_activity(ws,'template.created','template',template_id,template_name,jsonb_build_object('category',template_category));
  else
    select * into current_row from edm.templates where id=template_id and workspace_id=ws for update;
    if not found then raise exception '模板不存在或不可访问'; end if;
    if current_row.version is distinct from (payload->>'expected_version')::integer then raise exception '模板已被修改，请重新加载后重试'; end if;
    if current_row.archived_at is not null then raise exception '请先恢复模板再编辑'; end if;
    update edm.templates set name=template_name,category=template_category,subject=template_subject,body=template_body,
      updated_by=auth.uid(),version=version+1,updated_at=clock_timestamp() where id=template_id;
    perform edm_private.log_activity(ws,'template.updated','template',template_id,template_name,
      jsonb_build_object('fields',jsonb_build_array('name','category','subject','body')));
  end if;
  return template_id;
end;
$$;

create function edm_private.duplicate_template(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; source_id uuid := (payload->>'id')::uuid;
  source_row edm.templates; new_id uuid; new_name text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有模板管理权限' using errcode='42501'; end if;
  select * into source_row from edm.templates where id=source_id and workspace_id=ws;
  if not found then raise exception '模板不存在或不可访问'; end if;
  new_name=left(source_row.name,73)||' 副本';
  insert into edm.templates(workspace_id,name,category,subject,body,source_template_id,created_by,updated_by)
    values(ws,new_name,source_row.category,source_row.subject,source_row.body,source_row.id,auth.uid(),auth.uid()) returning id into new_id;
  perform edm_private.log_activity(ws,'template.duplicated','template',new_id,new_name,jsonb_build_object('source_template_id',source_id));
  return new_id;
end;
$$;

create function edm_private.set_template_archived(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; template_id uuid := (payload->>'id')::uuid;
  current_row edm.templates; should_archive boolean := (payload->>'archived')::boolean;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有模板管理权限' using errcode='42501'; end if;
  if jsonb_typeof(payload->'archived') is distinct from 'boolean' then raise exception '归档状态错误'; end if;
  select * into current_row from edm.templates where id=template_id and workspace_id=ws for update;
  if not found then raise exception '模板不存在或不可访问'; end if;
  if current_row.version is distinct from (payload->>'expected_version')::integer then raise exception '模板已被修改，请重新加载后重试'; end if;
  update edm.templates set archived_at=case when should_archive then coalesce(archived_at,clock_timestamp()) else null end,
    updated_by=auth.uid(),version=version+1,updated_at=clock_timestamp() where id=template_id;
  perform edm_private.log_activity(ws,case when should_archive then 'template.archived' else 'template.restored' end,
    'template',template_id,current_row.name,'{}'::jsonb);
  return template_id;
end;
$$;

create function edm_private.list_templates(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; total integer; page_no integer;
  show_archived boolean := coalesce((payload->>'archived')::boolean,false); result jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws) is null then raise exception '工作区不可访问' using errcode='42501'; end if;
  select count(*) into total from edm.templates where workspace_id=ws and (archived_at is not null)=show_archived;
  page_no=least(greatest(coalesce((payload->>'page')::integer,1),1),greatest((total+19)/20,1));
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc),'[]'::jsonb) into result from (
    select id,workspace_id,name,category,subject,body,default_key,source_template_id,archived_at,created_at,updated_at,version
    from edm.templates where workspace_id=ws and (archived_at is not null)=show_archived
    order by created_at desc,id desc limit 20 offset (page_no-1)*20
  ) t;
  return jsonb_build_object('items',result,'total',total,'page',page_no,
    'active_count',(select count(*) from edm.templates where workspace_id=ws and archived_at is null));
end;
$$;

create function edm_private.list_activity_logs(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; total integer; page_no integer;
  page_size integer := least(greatest(coalesce((payload->>'page_size')::integer,20),1),50);
  actor_filter text := nullif(payload->>'actor',''); result jsonb; actors jsonb;
begin
  if auth.uid() is null or edm_private.workspace_role(ws)<>'admin' then raise exception '没有日志查看权限' using errcode='42501'; end if;
  if actor_filter is not null and actor_filter<>'system' and actor_filter !~ '^[0-9a-fA-F-]{36}$' then raise exception '操作者筛选无效'; end if;
  select count(*) into total from edm.activity_logs l where l.workspace_id=ws
    and (actor_filter is null or (actor_filter='system' and l.actor_id is null) or l.actor_id::text=actor_filter);
  page_no=least(greatest(coalesce((payload->>'page')::integer,1),1),greatest((total+page_size-1)/page_size,1));
  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id desc),'[]'::jsonb) into result from (
    select id,actor_id,actor_name,actor_role,action,target_type,target_id,target_label,metadata,created_at
    from edm.activity_logs l where l.workspace_id=ws
      and (actor_filter is null or (actor_filter='system' and l.actor_id is null) or l.actor_id::text=actor_filter)
    order by created_at desc,id desc limit page_size offset (page_no-1)*page_size
  ) l;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.actor_key,'name',a.actor_name) order by a.actor_name),'[]'::jsonb) into actors from (
    select distinct on (coalesce(actor_id::text,'system')) coalesce(actor_id::text,'system') actor_key,actor_name,created_at
    from edm.activity_logs where workspace_id=ws order by coalesce(actor_id::text,'system'),created_at desc
  ) a;
  return jsonb_build_object('items',result,'total',total,'page',page_no,'page_size',page_size,'actors',actors);
end;
$$;

create function edm.save_template(payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select edm_private.save_template(payload); $$;
create function edm.duplicate_template(payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select edm_private.duplicate_template(payload); $$;
create function edm.set_template_archived(payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select edm_private.set_template_archived(payload); $$;
create function edm.list_templates(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.list_templates(payload); $$;
create function edm.list_activity_logs(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.list_activity_logs(payload); $$;

create or replace function edm_private.save_contact(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; cid uuid := (payload->>'id')::uuid;
  tag_values text[]; current_row edm.contacts; normalized_email text := lower(btrim(payload->>'email'));
  suppression text; action_name text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有客户管理权限' using errcode='42501'; end if;
  if jsonb_typeof(payload->'tags') is distinct from 'array' then raise exception '标签格式错误'; end if;
  select coalesce(array_agg(btrim(value)),'{}') into tag_values from jsonb_array_elements_text(payload->'tags');
  if cardinality(tag_values)>20 then raise exception '每位客户最多 20 个标签'; end if;
  if cid is null then
    insert into edm.contacts(workspace_id,email,name,created_by)
      values(ws,normalized_email,btrim(coalesce(payload->>'name','')),auth.uid()) returning id into cid;
    action_name='contact.created';
  else
    select * into current_row from edm.contacts where id=cid and workspace_id=ws for update;
    if not found then raise exception '客户不存在或不可访问'; end if;
    if current_row.version is distinct from (payload->>'expected_version')::integer then raise exception '资料已被修改，请重新加载后重试'; end if;
    if current_row.archived_at is not null then raise exception '请先恢复客户再编辑'; end if;
    if current_row.email<>normalized_email then
      suppression=edm_private.suppression_status(ws,normalized_email);
      insert into edm.subscription_events(workspace_id,contact_id,email,event_type,source,note,metadata,created_by)
        values(ws,cid,current_row.email,'email_changed','manual_edit','客户邮箱已修改',jsonb_build_object('new_email',normalized_email),auth.uid());
    end if;
    update edm.contacts set email=normalized_email,name=btrim(coalesce(payload->>'name','')),
      subscription_status=case when current_row.email<>normalized_email then coalesce(suppression,'unconfirmed') else subscription_status end,
      consent_source=case when current_row.email<>normalized_email then null else consent_source end,
      consent_note=case when current_row.email<>normalized_email then null else consent_note end,
      consent_at=case when current_row.email<>normalized_email then null else consent_at end,
      version=version+1,updated_at=clock_timestamp() where id=cid;
    action_name='contact.updated';
  end if;
  perform edm_private.add_contact_tags(ws,cid,tag_values,true);
  perform edm_private.log_activity(ws,action_name,'contact',cid,
    coalesce(nullif(btrim(coalesce(payload->>'name','')),''),normalized_email),jsonb_build_object('tag_count',cardinality(tag_values)));
  return cid;
end;
$$;

create or replace function edm_private.archive_contact(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; cid uuid := (payload->>'id')::uuid; current_row edm.contacts;
  should_archive boolean := (payload->>'archived')::boolean;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then raise exception '没有客户管理权限' using errcode='42501'; end if;
  if jsonb_typeof(payload->'archived') is distinct from 'boolean' then raise exception '归档状态错误'; end if;
  select * into current_row from edm.contacts where id=cid and workspace_id=ws for update;
  if not found then raise exception '客户不存在或不可访问'; end if;
  if current_row.version is distinct from (payload->>'expected_version')::integer then raise exception '资料已被修改，请重新加载后重试'; end if;
  update edm.contacts set archived_at=case when should_archive then coalesce(archived_at,clock_timestamp()) else null end,
    version=version+1,updated_at=clock_timestamp() where id=cid;
  perform edm_private.log_activity(ws,case when should_archive then 'contact.archived' else 'contact.restored' end,
    'contact',cid,coalesce(nullif(current_row.name,''),current_row.email),'{}'::jsonb);
  return cid;
end;
$$;

create or replace function edm_private.unsubscribe_contact(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; cid uuid := (payload->>'id')::uuid; c edm.contacts; event_id uuid;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then raise exception '没有客户管理权限' using errcode='42501'; end if;
  if btrim(coalesce(payload->>'reason',''))='' or length(btrim(payload->>'reason'))>500 then raise exception '请填写 1 至 500 字的退订原因'; end if;
  select * into c from edm.contacts where id=cid and workspace_id=ws for update;
  if not found then raise exception '客户不存在或不可访问'; end if;
  if c.version is distinct from (payload->>'expected_version')::integer then raise exception '资料已被修改，请重新加载后重试'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('edm:contact:'||ws::text||':'||c.email,0));
  insert into edm.subscription_events(workspace_id,contact_id,email,event_type,source,note,created_by)
    values(ws,c.id,c.email,'unsubscribed','manual',btrim(payload->>'reason'),auth.uid()) returning id into event_id;
  insert into edm.suppressions(workspace_id,email,reason,first_event_id) values(ws,c.email,'unsubscribed',event_id) on conflict do nothing;
  update edm.contacts set subscription_status=coalesce(edm_private.suppression_status(ws,c.email),'unsubscribed'),version=version+1,updated_at=clock_timestamp() where id=c.id;
  perform edm_private.log_activity(ws,'contact.unsubscribed','contact',c.id,coalesce(nullif(c.name,''),c.email),'{}'::jsonb);
  return c.id;
end;
$$;

create function edm_private.audit_completed_import() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='completed' and old.status is distinct from 'completed' then
    perform edm_private.log_activity(new.workspace_id,'contact_import.completed','contact_import',new.id,new.source_name,
      jsonb_build_object('source_type',new.source_type,'total_source_rows',new.total_source_rows,'total_groups',new.total_groups,'summary',new.summary),
      'contact-import-completed:'||new.id::text,auth.uid() is null);
  end if;
  return new;
end;
$$;
create trigger contact_import_completed after update of status on edm.contact_imports
  for each row execute function edm_private.audit_completed_import();

-- 迁移存量工作区；默认模板保持普通可编辑/归档数据，不伪造更早的业务历史。
select edm_private.seed_default_templates(id) from edm.workspaces order by id;

revoke all on edm.templates,edm.activity_logs from public,anon,authenticated;
grant select on edm.templates to authenticated;
revoke all on all functions in schema edm_private from public,anon;
revoke all on function edm.save_template(jsonb),edm.duplicate_template(jsonb),edm.set_template_archived(jsonb),edm.list_templates(jsonb),edm.list_activity_logs(jsonb) from public,anon;
grant execute on function edm.save_template(jsonb),edm.duplicate_template(jsonb),edm.set_template_archived(jsonb),edm.list_templates(jsonb),edm.list_activity_logs(jsonb),
  edm_private.save_template(jsonb),edm_private.duplicate_template(jsonb),edm_private.set_template_archived(jsonb),edm_private.list_templates(jsonb),edm_private.list_activity_logs(jsonb) to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.templates,edm.activity_logs from aigc_api;
    revoke all on all functions in schema edm,edm_private from aigc_api;
  end if;
end $$;
