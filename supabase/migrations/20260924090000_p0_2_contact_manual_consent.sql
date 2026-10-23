-- P0-2：允许在手动添加/编辑客户时声明“已获得订阅同意”，并留下与导入一致的证据。
-- 仅替换 edm_private.save_contact；不批量修改任何存量客户。
-- 未声明同意时行为与此前完全一致（新客户保持“未确认”）。

create or replace function edm_private.save_contact(payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare ws uuid := (payload->>'workspace_id')::uuid; cid uuid := (payload->>'id')::uuid;
  tag_values text[]; current_row edm.contacts; normalized_email text := lower(btrim(payload->>'email'));
  suppression text; action_name text;
  consent_declared boolean := coalesce((payload->>'consent_declared')::boolean,false);
  consent_src text := btrim(coalesce(payload->>'consent_source',''));
  consent_text text := btrim(coalesce(payload->>'consent_note',''));
  consent_time timestamptz; consent_recorded boolean := false;
begin
  if auth.uid() is null or coalesce(edm_private.workspace_role(ws),'') not in ('admin','editor') then
    raise exception '没有客户管理权限' using errcode='42501'; end if;
  if jsonb_typeof(payload->'tags') is distinct from 'array' then raise exception '标签格式错误'; end if;
  select coalesce(array_agg(btrim(value)),'{}') into tag_values from jsonb_array_elements_text(payload->'tags');
  if cardinality(tag_values)>20 then raise exception '每位客户最多 20 个标签'; end if;
  if consent_declared then
    if length(consent_src) not between 1 and 100 then raise exception '声明订阅同意时请填写 1 至 100 字的同意来源'; end if;
    if length(consent_text) not between 1 and 500 then raise exception '声明订阅同意时请填写 1 至 500 字的授权说明'; end if;
    consent_time := coalesce(nullif(payload->>'consent_at','')::timestamptz, clock_timestamp());
    if consent_time > clock_timestamp() then raise exception '同意时间不能晚于当前时间'; end if;
  end if;
  if cid is null then
    perform edm_private.assert_workspace_billable_contact_headroom(ws, 1);
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
  if consent_declared then
    select * into current_row from edm.contacts where id=cid;
    if edm_private.suppression_status(ws,current_row.email) is not null
      or current_row.subscription_status in ('unsubscribed','bounced','complained') then
      raise exception '该邮箱已退订、退信或投诉，不能标记为已获得同意'; end if;
    -- 已订阅客户保留原有同意证据，不被覆盖。
    if current_row.subscription_status='unconfirmed' then
      update edm.contacts set subscription_status='subscribed',consent_source=consent_src,
        consent_note=consent_text,consent_at=consent_time where id=cid;
      insert into edm.subscription_events(workspace_id,contact_id,email,event_type,source,note,consent_at,metadata,created_by)
        values(ws,cid,current_row.email,'consented',consent_src,consent_text,consent_time,
          jsonb_build_object('channel','manual_form'),auth.uid());
      consent_recorded := true;
    end if;
  end if;
  perform edm_private.log_activity(ws,action_name,'contact',cid,
    coalesce(nullif(btrim(coalesce(payload->>'name','')),''),normalized_email),
    jsonb_build_object('tag_count',cardinality(tag_values),'consent_recorded',consent_recorded));
  return cid;
end;
$$;
