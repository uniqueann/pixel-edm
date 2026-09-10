-- 客户导入、订阅证据与抑制记录。仅修改 EDM 对象。
alter table edm.contacts
  add column subscription_status text not null default 'unconfirmed'
    check (subscription_status in ('unconfirmed','subscribed','unsubscribed','bounced','complained')),
  add column consent_source text check (consent_source is null or length(consent_source) <= 100),
  add column consent_note text check (consent_note is null or length(consent_note) <= 500),
  add column consent_at timestamptz;

create table edm.contact_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references edm.workspaces(id),
  source_type text not null check (source_type in ('paste','csv')),
  source_name text not null check (length(btrim(source_name)) between 1 and 200),
  consent_declared boolean not null default false,
  consent_source text check (consent_source is null or length(consent_source) <= 100),
  consent_note text check (consent_note is null or length(consent_note) <= 500),
  consent_at timestamptz,
  status text not null default 'prepared' check (status in ('prepared','processing','completed','failed')),
  total_source_rows integer not null check (total_source_rows between 1 and 1000),
  total_groups integer not null check (total_groups between 1 and 1000),
  processed_groups integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references edm.members(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,id)
);

create table edm.contact_import_rows (
  import_id uuid not null references edm.contact_imports(id),
  workspace_id uuid not null,
  item_no integer not null check (item_no > 0),
  source_rows integer[] not null check (cardinality(source_rows) > 0),
  email text not null,
  name text not null default '',
  tags text[] not null default '{}',
  requested_status text not null check (requested_status in ('unconfirmed','subscribed','unsubscribed','bounced','complained')),
  consent_source text,
  consent_note text,
  consent_at timestamptz,
  preview_result text not null check (preview_result in ('new','update','unchanged','archived_skipped','suppressed_protected','suppressed','error')),
  result text not null default 'pending' check (result in ('pending','created','updated','unchanged','archived_skipped','suppressed_protected','suppressed','error')),
  message text not null default '',
  contact_id uuid,
  processed_at timestamptz,
  primary key(import_id,item_no),
  foreign key(workspace_id,import_id) references edm.contact_imports(workspace_id,id),
  foreign key(workspace_id,contact_id) references edm.contacts(workspace_id,id)
);

create table edm.subscription_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references edm.workspaces(id),
  contact_id uuid,
  email text not null,
  event_type text not null check (event_type in ('consented','unsubscribed','bounced','complained','email_changed')),
  source text not null check (length(source) between 1 and 100),
  note text not null default '' check (length(note) <= 500),
  consent_at timestamptz,
  import_id uuid,
  import_item_no integer,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references edm.members(user_id),
  created_at timestamptz not null default now(),
  foreign key(workspace_id,contact_id) references edm.contacts(workspace_id,id),
  foreign key(workspace_id,import_id) references edm.contact_imports(workspace_id,id),
  unique(workspace_id,id),
  unique(import_id,import_item_no,event_type)
);

create table edm.suppressions (
  workspace_id uuid not null references edm.workspaces(id),
  email text not null check (email=lower(btrim(email)) and length(email)<=254),
  reason text not null check (reason in ('unsubscribed','bounced','complained')),
  first_event_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(workspace_id,email,reason),
  foreign key(workspace_id,first_event_id) references edm.subscription_events(workspace_id,id)
);

create index contact_imports_list_idx on edm.contact_imports(workspace_id,created_at desc);
create index contact_imports_created_by_idx on edm.contact_imports(created_by);
create index contact_import_rows_pending_idx on edm.contact_import_rows(import_id,item_no) where result='pending';
create unique index contact_import_rows_valid_email_idx on edm.contact_import_rows(import_id,email) where preview_result<>'error';
create index contact_import_rows_import_fk_idx on edm.contact_import_rows(workspace_id,import_id);
create index contact_import_rows_contact_fk_idx on edm.contact_import_rows(workspace_id,contact_id) where contact_id is not null;
create index subscription_events_contact_idx on edm.subscription_events(workspace_id,email,created_at desc);
create index subscription_events_contact_fk_idx on edm.subscription_events(workspace_id,contact_id) where contact_id is not null;
create index subscription_events_import_fk_idx on edm.subscription_events(workspace_id,import_id) where import_id is not null;
create index subscription_events_created_by_idx on edm.subscription_events(created_by) where created_by is not null;
create index suppressions_lookup_idx on edm.suppressions(workspace_id,email);
create index suppressions_event_fk_idx on edm.suppressions(workspace_id,first_event_id);
create index contacts_created_by_idx on edm.contacts(created_by);
create index contact_tags_workspace_contact_idx on edm.contact_tags(workspace_id,contact_id);

alter table edm.contact_imports enable row level security;
alter table edm.contact_import_rows enable row level security;
alter table edm.subscription_events enable row level security;
alter table edm.suppressions enable row level security;

create policy contact_imports_read on edm.contact_imports for select to authenticated
  using (edm_private.workspace_role(workspace_id) in ('admin','editor'));
create policy contact_import_rows_read on edm.contact_import_rows for select to authenticated
  using (edm_private.workspace_role(workspace_id) in ('admin','editor'));
create policy subscription_events_read on edm.subscription_events for select to authenticated
  using (edm_private.workspace_role(workspace_id) in ('admin','editor'));
create policy suppressions_read on edm.suppressions for select to authenticated
  using (edm_private.workspace_role(workspace_id) in ('admin','editor'));

create function edm_private.suppression_status(ws uuid, target_email text) returns text
language sql stable security definer set search_path='' as $$
  select case
    when bool_or(reason='complained') then 'complained'
    when bool_or(reason='bounced') then 'bounced'
    when bool_or(reason='unsubscribed') then 'unsubscribed'
  end
  from edm.suppressions where workspace_id=ws and email=lower(btrim(target_email));
$$;

create function edm_private.add_contact_tags(ws uuid, cid uuid, values_to_add text[], replace_existing boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare value text; tid uuid; before_count integer; after_count integer;
begin
  select count(*) into before_count from edm.contact_tags where contact_id=cid;
  if replace_existing then delete from edm.contact_tags where contact_id=cid; end if;
  foreach value in array coalesce(values_to_add,'{}') loop
    value=btrim(value);
    if length(value) not between 1 and 30 then raise exception '标签须为 1 至 30 字'; end if;
    insert into edm.tags(workspace_id,name) values(ws,value)
      on conflict(workspace_id,normalized_name) do nothing;
    select id into tid from edm.tags where workspace_id=ws and normalized_name=lower(value);
    insert into edm.contact_tags(workspace_id,contact_id,tag_id) values(ws,cid,tid) on conflict do nothing;
  end loop;
  select count(*) into after_count from edm.contact_tags where contact_id=cid;
  if after_count>20 then raise exception '合并后标签超过 20 个'; end if;
  return replace_existing or after_count<>before_count;
end;
$$;

create or replace function edm_private.save_contact(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; cid uuid := (payload->>'id')::uuid;
  tag_values text[]; current_row edm.contacts; normalized_email text := lower(btrim(payload->>'email'));
  suppression text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有客户管理权限' using errcode='42501'; end if;
  if jsonb_typeof(payload->'tags') is distinct from 'array' then raise exception '标签格式错误'; end if;
  select coalesce(array_agg(btrim(value)),'{}') into tag_values from jsonb_array_elements_text(payload->'tags');
  if cardinality(tag_values)>20 then raise exception '每位客户最多 20 个标签'; end if;
  if cid is null then
    insert into edm.contacts(workspace_id,email,name,created_by)
      values(ws,normalized_email,btrim(coalesce(payload->>'name','')),auth.uid()) returning id into cid;
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
  end if;
  perform edm_private.add_contact_tags(ws,cid,tag_values,true);
  return cid;
end;
$$;

create function edm_private.preview_import_row(ws uuid, row_data jsonb) returns text
language plpgsql stable security definer set search_path='' as $$
declare c edm.contacts; suppression text; requested text := row_data->>'requested_status'; changes boolean := false;
begin
  if coalesce(row_data->>'validation_error','')<>'' then return 'error'; end if;
  select * into c from edm.contacts where workspace_id=ws and email=row_data->>'email';
  suppression=edm_private.suppression_status(ws,row_data->>'email');
  if requested in ('unsubscribed','bounced','complained') then return 'suppressed'; end if;
  if c.id is not null and c.archived_at is not null then return 'archived_skipped'; end if;
  if suppression is not null then return 'suppressed_protected'; end if;
  if c.id is null then return 'new'; end if;
  changes=(c.name='' and coalesce(row_data->>'name','')<>'')
    or (c.subscription_status='unconfirmed' and requested='subscribed')
    or exists(select 1 from jsonb_array_elements_text(row_data->'tags') v
      where not exists(select 1 from edm.contact_tags ct join edm.tags t on t.id=ct.tag_id
        where ct.contact_id=c.id and t.normalized_name=lower(btrim(v.value))));
  return case when changes then 'update' else 'unchanged' end;
end;
$$;

create function edm_private.prepare_contact_import(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; new_import_id uuid; row_data jsonb; item integer := 0;
  total_sources integer := (payload->>'total_source_rows')::integer; preview text; validation_error text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有名单导入权限' using errcode='42501'; end if;
  if total_sources not between 1 and 1000 or jsonb_array_length(payload->'rows') not between 1 and 1000 then
    raise exception '每次最多导入 1000 条记录'; end if;
  if coalesce((payload->>'consent_declared')::boolean,false) and
    (btrim(coalesce(payload->>'consent_source',''))='' or btrim(coalesce(payload->>'consent_note',''))='') then
    raise exception '声明订阅同意时必须填写来源和证据说明'; end if;
  if nullif(payload->>'consent_at','')::timestamptz>clock_timestamp() then raise exception '同意时间不能晚于当前时间'; end if;
  insert into edm.contact_imports(workspace_id,source_type,source_name,consent_declared,consent_source,consent_note,consent_at,total_source_rows,total_groups,created_by)
    values(ws,payload->>'source_type',btrim(payload->>'source_name'),coalesce((payload->>'consent_declared')::boolean,false),
      nullif(btrim(payload->>'consent_source'),''),nullif(btrim(payload->>'consent_note'),''),nullif(payload->>'consent_at','')::timestamptz,
      total_sources,jsonb_array_length(payload->'rows'),auth.uid()) returning id into new_import_id;
  for row_data in select value from jsonb_array_elements(payload->'rows') loop
    item=item+1; validation_error=coalesce(row_data->>'validation_error','');
    if coalesce(row_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or row_data->>'email'<>lower(btrim(row_data->>'email')) or length(row_data->>'email')>254 then
      validation_error=concat_ws('；',nullif(validation_error,''),'邮箱格式无效');
    end if;
    if length(coalesce(row_data->>'name',''))>100 then validation_error=concat_ws('；',nullif(validation_error,''),'姓名最多 100 字'); end if;
    if jsonb_typeof(row_data->'tags') is distinct from 'array' then
      validation_error=concat_ws('；',nullif(validation_error,''),'标签格式或数量无效');
      row_data=jsonb_set(row_data,'{tags}','[]');
    elsif jsonb_array_length(row_data->'tags')>20 then
      validation_error=concat_ws('；',nullif(validation_error,''),'标签格式或数量无效');
    end if;
    if coalesce(row_data->>'requested_status','') not in ('unconfirmed','subscribed','unsubscribed','bounced','complained') then
      validation_error=concat_ws('；',nullif(validation_error,''),'订阅状态无法识别');
      row_data=jsonb_set(row_data,'{requested_status}','"unconfirmed"');
    end if;
    if row_data->>'requested_status'='subscribed' and
      (btrim(coalesce(row_data->>'consent_source',''))='' or btrim(coalesce(row_data->>'consent_note',''))='') then
      validation_error=concat_ws('；',nullif(validation_error,''),'已订阅记录必须提供同意来源和证据说明');
    end if;
    row_data=jsonb_set(row_data,'{validation_error}',to_jsonb(validation_error));
    preview=edm_private.preview_import_row(ws,row_data);
    insert into edm.contact_import_rows(import_id,workspace_id,item_no,source_rows,email,name,tags,requested_status,consent_source,consent_note,consent_at,preview_result,result,message)
      values(new_import_id,ws,item,array(select jsonb_array_elements_text(row_data->'source_rows'))::integer[],coalesce(row_data->>'email',''),
        coalesce(row_data->>'name',''),array(select jsonb_array_elements_text(row_data->'tags')),row_data->>'requested_status',
        nullif(row_data->>'consent_source',''),nullif(row_data->>'consent_note',''),nullif(row_data->>'consent_at','')::timestamptz,
        preview,case when preview='error' then 'error' else 'pending' end,validation_error);
  end loop;
  update edm.contact_imports set processed_groups=(select count(*) from edm.contact_import_rows where import_id=contact_imports.id and result<>'pending'),
    summary=(select jsonb_object_agg(preview_result,n) from (select preview_result,count(*) n from edm.contact_import_rows where import_id=contact_imports.id group by preview_result) s)
    where id=new_import_id;
  return edm_private.get_contact_import(jsonb_build_object('workspace_id',ws,'id',new_import_id,'page',1));
end;
$$;

create function edm_private.confirm_contact_import(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; iid uuid := (payload->>'id')::uuid;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then raise exception '没有名单导入权限' using errcode='42501'; end if;
  update edm.contact_imports set status=case when exists(select 1 from edm.contact_import_rows where import_id=iid and result='pending') then 'processing' else 'completed' end,
    updated_at=clock_timestamp() where id=iid and workspace_id=ws and status in ('prepared','processing');
  if not found then raise exception '导入任务不存在或状态不可确认'; end if;
  return edm_private.get_contact_import(jsonb_build_object('workspace_id',ws,'id',iid,'page',1));
end;
$$;

create function edm_private.process_contact_import_batch(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; iid uuid := (payload->>'id')::uuid; r edm.contact_import_rows;
  c edm.contacts; cid uuid; changed boolean; suppression text; event_id uuid; final_result text;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then raise exception '没有名单导入权限' using errcode='42501'; end if;
  if not exists(select 1 from edm.contact_imports where id=iid and workspace_id=ws and status='processing') then raise exception '导入任务未确认或已经结束'; end if;
  for r in select * from edm.contact_import_rows where import_id=iid and result='pending' order by item_no limit 100 for update skip locked loop
    begin
      c=null; cid=null; changed=false; final_result=null; suppression=null;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('edm:contact:'||ws::text||':'||r.email,0));
      select * into c from edm.contacts where workspace_id=ws and email=r.email for update;
      cid=c.id;
      if c.id is not null and c.archived_at is not null and r.requested_status not in ('unsubscribed','bounced','complained') then
        final_result='archived_skipped';
      else
        if c.id is null then
          insert into edm.contacts(workspace_id,email,name,subscription_status,consent_source,consent_note,consent_at,created_by)
            values(ws,r.email,r.name,case when r.requested_status in ('subscribed','unsubscribed','bounced','complained') then r.requested_status else 'unconfirmed' end,
              case when r.requested_status='subscribed' then r.consent_source end,case when r.requested_status='subscribed' then r.consent_note end,
              case when r.requested_status='subscribed' then r.consent_at end,auth.uid()) returning * into c;
          changed=edm_private.add_contact_tags(ws,c.id,r.tags,false); final_result='created';
          if r.requested_status='subscribed' then
            insert into edm.subscription_events(workspace_id,contact_id,email,event_type,source,note,consent_at,import_id,import_item_no,created_by)
              values(ws,c.id,r.email,'consented',coalesce(r.consent_source,'import'),coalesce(r.consent_note,''),r.consent_at,iid,r.item_no,auth.uid());
          end if;
        elsif c.archived_at is null then
          changed=false;
          if c.name='' and r.name<>'' then update edm.contacts set name=r.name where id=c.id; changed=true; end if;
          if edm_private.add_contact_tags(ws,c.id,r.tags,false) then changed=true; end if;
        end if;
        cid=c.id;
        if r.requested_status in ('unsubscribed','bounced','complained') then
          insert into edm.subscription_events(workspace_id,contact_id,email,event_type,source,note,import_id,import_item_no,created_by)
            values(ws,c.id,r.email,r.requested_status,'import',coalesce(r.consent_note,''),iid,r.item_no,auth.uid()) returning id into event_id;
          insert into edm.suppressions(workspace_id,email,reason,first_event_id) values(ws,r.email,r.requested_status,event_id) on conflict do nothing;
          suppression=edm_private.suppression_status(ws,r.email);
          update edm.contacts set subscription_status=suppression,version=version+1,updated_at=clock_timestamp() where id=c.id;
          final_result='suppressed';
        else
          suppression=edm_private.suppression_status(ws,r.email);
          if suppression is not null then
            update edm.contacts set subscription_status=suppression,version=version+case when changed then 1 else 0 end,updated_at=case when changed then clock_timestamp() else updated_at end where id=c.id;
            final_result='suppressed_protected';
          elsif r.requested_status='subscribed' and c.subscription_status='unconfirmed' then
            update edm.contacts set subscription_status='subscribed',consent_source=r.consent_source,consent_note=r.consent_note,consent_at=r.consent_at,
              version=version+1,updated_at=clock_timestamp() where id=c.id;
            insert into edm.subscription_events(workspace_id,contact_id,email,event_type,source,note,consent_at,import_id,import_item_no,created_by)
              values(ws,c.id,r.email,'consented',coalesce(r.consent_source,'import'),coalesce(r.consent_note,''),r.consent_at,iid,r.item_no,auth.uid());
            final_result=case when final_result='created' then 'created' else 'updated' end;
          elsif final_result is distinct from 'created' then
            if changed then update edm.contacts set version=version+1,updated_at=clock_timestamp() where id=c.id; final_result='updated'; else final_result='unchanged'; end if;
          end if;
        end if;
      end if;
      update edm.contact_import_rows set result=final_result,contact_id=cid,processed_at=clock_timestamp(),message=case final_result
        when 'archived_skipped' then '客户已归档，未自动恢复' when 'suppressed_protected' then '已有抑制记录，订阅状态未恢复' else '' end
        where import_id=iid and item_no=r.item_no;
    exception when others then
      update edm.contact_import_rows set result='error',message=left(sqlerrm,500),processed_at=clock_timestamp() where import_id=iid and item_no=r.item_no;
    end;
  end loop;
  update edm.contact_imports set processed_groups=(select count(*) from edm.contact_import_rows where import_id=iid and result<>'pending'),
    status=case when exists(select 1 from edm.contact_import_rows where import_id=iid and result='pending') then 'processing' else 'completed' end,
    summary=(select jsonb_object_agg(result,n) from (select result,count(*) n from edm.contact_import_rows where import_id=iid group by result) s),updated_at=clock_timestamp()
    where id=iid and workspace_id=ws;
  return edm_private.get_contact_import(jsonb_build_object('workspace_id',ws,'id',iid,'page',1));
end;
$$;

create function edm_private.get_contact_import(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; iid uuid := (payload->>'id')::uuid; page_no integer := greatest(coalesce((payload->>'page')::integer,1),1);
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then raise exception '没有名单导入权限' using errcode='42501'; end if;
  if not exists(select 1 from edm.contact_imports where id=iid and workspace_id=ws) then raise exception '导入任务不存在'; end if;
  return jsonb_build_object('job',(select to_jsonb(j) from edm.contact_imports j where id=iid),
    'rows',coalesce((select jsonb_agg(to_jsonb(r) order by item_no) from (select * from edm.contact_import_rows where import_id=iid order by item_no limit 50 offset (page_no-1)*50) r),'[]'),
    'row_total',(select count(*) from edm.contact_import_rows where import_id=iid),'page',page_no);
end;
$$;

create function edm_private.unsubscribe_contact(payload jsonb) returns uuid
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
  return c.id;
end;
$$;

create function edm_private.list_contact_imports(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then raise exception '没有名单导入权限' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(j) order by created_at desc) from
    (select id,source_type,source_name,status,total_source_rows,total_groups,processed_groups,summary,created_at,updated_at
     from edm.contact_imports where workspace_id=ws order by created_at desc limit 10) j),'[]');
end;
$$;

create function edm_private.export_contact_import(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; iid uuid := (payload->>'id')::uuid;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then raise exception '没有名单导入权限' using errcode='42501'; end if;
  if not exists(select 1 from edm.contact_imports where id=iid and workspace_id=ws) then raise exception '导入任务不存在'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('source_rows',source_rows,'email',email,'result',result,'message',message) order by item_no)
    from edm.contact_import_rows where import_id=iid),'[]');
end;
$$;

create or replace function edm.list_contacts(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; total integer; page_no integer; result jsonb; status_filter text := nullif(payload->>'subscription_status','');
begin
 if edm_private.workspace_role(ws) is null then raise exception '工作区不可访问' using errcode='42501'; end if;
 select count(*) into total from edm.contacts c where c.workspace_id=ws
  and (c.archived_at is not null)=coalesce((payload->>'archived')::boolean,false)
  and (strpos(lower(c.email),lower(coalesce(payload->>'q','')))>0 or strpos(lower(c.name),lower(coalesce(payload->>'q','')))>0)
  and (status_filter is null or c.subscription_status=status_filter)
  and (nullif(payload->>'tag_id','') is null or exists(select 1 from edm.contact_tags ct where ct.contact_id=c.id and ct.tag_id=(payload->>'tag_id')::uuid));
 page_no=least(greatest(coalesce((payload->>'page')::integer,1),1),greatest((total+19)/20,1));
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (
 select c.*,coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name) from edm.tags t join edm.contact_tags ct on ct.tag_id=t.id where ct.contact_id=c.id),'[]') as tags
 from edm.contacts c where c.workspace_id=ws and (c.archived_at is not null)=coalesce((payload->>'archived')::boolean,false)
 and (strpos(lower(c.email),lower(coalesce(payload->>'q','')))>0 or strpos(lower(c.name),lower(coalesce(payload->>'q','')))>0)
 and (status_filter is null or c.subscription_status=status_filter)
 and (nullif(payload->>'tag_id','') is null or exists(select 1 from edm.contact_tags ct where ct.contact_id=c.id and ct.tag_id=(payload->>'tag_id')::uuid))
 order by c.created_at desc,c.id desc limit 20 offset (page_no-1)*20) r;
 return jsonb_build_object('items',result,'total',total,'page',page_no,'tags',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from edm.tags where workspace_id=ws),'[]'),
 'active_count',(select count(*) from edm.contacts where workspace_id=ws and archived_at is null));
end;
$$;

create function edm.prepare_contact_import(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.prepare_contact_import(payload); $$;
create function edm.confirm_contact_import(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.confirm_contact_import(payload); $$;
create function edm.process_contact_import_batch(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.process_contact_import_batch(payload); $$;
create function edm.get_contact_import(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.get_contact_import(payload); $$;
create function edm.unsubscribe_contact(payload jsonb) returns uuid language sql security invoker set search_path='' as $$ select edm_private.unsubscribe_contact(payload); $$;
create function edm.list_contact_imports(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.list_contact_imports(payload); $$;
create function edm.export_contact_import(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select edm_private.export_contact_import(payload); $$;

create trigger contact_imports_updated before update on edm.contact_imports for each row execute function edm_private.touch_updated_at();

revoke all on edm.contact_imports,edm.contact_import_rows,edm.subscription_events,edm.suppressions from public,anon,authenticated;
grant select on edm.contact_imports,edm.contact_import_rows,edm.subscription_events,edm.suppressions to authenticated;
revoke all on all functions in schema edm_private from public,anon;
revoke all on function edm.prepare_contact_import(jsonb),edm.confirm_contact_import(jsonb),edm.process_contact_import_batch(jsonb),edm.get_contact_import(jsonb),edm.unsubscribe_contact(jsonb),edm.list_contact_imports(jsonb),edm.export_contact_import(jsonb) from public,anon;
grant execute on function edm.prepare_contact_import(jsonb),edm.confirm_contact_import(jsonb),edm.process_contact_import_batch(jsonb),edm.get_contact_import(jsonb),edm.unsubscribe_contact(jsonb),edm.list_contact_imports(jsonb),edm.export_contact_import(jsonb),
  edm_private.prepare_contact_import(jsonb),edm_private.confirm_contact_import(jsonb),edm_private.process_contact_import_batch(jsonb),edm_private.get_contact_import(jsonb),edm_private.unsubscribe_contact(jsonb),
  edm_private.list_contact_imports(jsonb),edm_private.export_contact_import(jsonb) to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on edm.contact_imports,edm.contact_import_rows,edm.subscription_events,edm.suppressions from aigc_api;
    revoke all on all functions in schema edm,edm_private from aigc_api;
  end if;
end $$;
