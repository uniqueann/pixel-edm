-- P12：套餐主轴改为有效客户数 + 活跃成员数；发信日配额/速率仍为内部护栏。

alter table edm.delivery_plan_limits
  drop constraint if exists delivery_plan_limits_max_recipients_per_campaign_check;

alter table edm.delivery_plan_limits
  add column if not exists max_billable_contacts integer,
  add column if not exists max_active_members integer;

update edm.delivery_plan_limits set
  max_billable_contacts = case plan
    when 'free' then 500
    when 'pro' then 5000
    when 'team' then 25000
  end,
  max_active_members = case plan
    when 'free' then 1
    when 'pro' then 5
    when 'team' then 20
  end,
  max_recipients_per_campaign = case plan
    when 'free' then 500
    when 'pro' then 5000
    when 'team' then 25000
  end
where max_billable_contacts is null or max_active_members is null;

alter table edm.delivery_plan_limits
  alter column max_billable_contacts set not null,
  alter column max_active_members set not null;

alter table edm.delivery_plan_limits
  add constraint delivery_plan_limits_max_recipients_per_campaign_check
    check (max_recipients_per_campaign between 1 and 1000000),
  add constraint delivery_plan_limits_max_billable_contacts_check
    check (max_billable_contacts between 1 and 1000000),
  add constraint delivery_plan_limits_max_active_members_check
    check (max_active_members between 1 and 1000);

create or replace function edm_private.workspace_billable_contact_count(p_workspace_id uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from edm.contacts
  where workspace_id = p_workspace_id and archived_at is null;
$$;

create or replace function edm_private.workspace_active_member_count(p_workspace_id uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from edm.workspace_members
  where workspace_id = p_workspace_id and status = 'active';
$$;

create or replace function edm_private.assert_workspace_billable_contact_headroom(
  p_workspace_id uuid,
  p_additional integer default 1
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  limits edm.delivery_plan_limits;
  current_count integer;
begin
  if coalesce(p_additional, 0) < 1 then return; end if;
  select * into limits from edm_private.delivery_plan_limits_for_workspace(p_workspace_id);
  if not found then raise exception '工作区套餐配置无效'; end if;
  current_count := edm_private.workspace_billable_contact_count(p_workspace_id);
  if current_count + p_additional > limits.max_billable_contacts then
    raise exception '当前套餐最多 % 位有效客户（未归档），已用 % 位',
      limits.max_billable_contacts, current_count;
  end if;
end;
$$;

create or replace function edm_private.assert_workspace_member_headroom(
  p_workspace_id uuid,
  p_additional integer default 1
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  limits edm.delivery_plan_limits;
  current_count integer;
begin
  if coalesce(p_additional, 0) < 1 then return; end if;
  select * into limits from edm_private.delivery_plan_limits_for_workspace(p_workspace_id);
  if not found then raise exception '工作区套餐配置无效'; end if;
  current_count := edm_private.workspace_active_member_count(p_workspace_id);
  if current_count + p_additional > limits.max_active_members then
    raise exception '当前套餐最多 % 位工作区成员，已有 % 位',
      limits.max_active_members, current_count;
  end if;
end;
$$;

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
  if not should_archive and current_row.archived_at is not null then
    perform edm_private.assert_workspace_billable_contact_headroom(ws, 1);
  end if;
  update edm.contacts set archived_at=case when should_archive then coalesce(archived_at,clock_timestamp()) else null end,
    version=version+1,updated_at=clock_timestamp() where id=cid;
  perform edm_private.log_activity(ws,case when should_archive then 'contact.archived' else 'contact.restored' end,
    'contact',cid,coalesce(nullif(current_row.name,''),current_row.email),'{}'::jsonb);
  return cid;
end;
$$;

create or replace function edm_private.process_contact_import_batch(payload jsonb) returns jsonb
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
          perform edm_private.assert_workspace_billable_contact_headroom(ws, 1);
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

create or replace function edm_private.create_workspace_invitation(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  ws uuid := (payload->>'workspace_id')::uuid;
  email_value text := lower(btrim(coalesce(payload->>'email','')));
  invitation_role text := coalesce(payload->>'role','');
  token_hash_value text := coalesce(payload->>'token_hash','');
  token_hint_value text := coalesce(payload->>'token_hint','');
  workspace_row edm.workspaces;
  invitation_row edm.workspace_invitations;
  existing_id uuid;
  active_member boolean;
begin
  if uid is null then raise exception '需要登录' using errcode='42501'; end if;
  if ws is null then raise exception '工作区无效'; end if;
  if invitation_role not in ('admin','editor','viewer') then raise exception '成员角色无效'; end if;
  if email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(email_value)>254 then raise exception '邮箱格式无效'; end if;
  if token_hash_value !~ '^[0-9a-f]{64}$' then raise exception '邀请令牌无效'; end if;
  if char_length(token_hint_value) not between 4 and 8 then raise exception '邀请令牌无效'; end if;

  select * into workspace_row from edm.workspaces where id=ws for update;
  if not found then raise exception '工作区不存在'; end if;
  if edm_private.workspace_role(ws)<>'admin' then
    raise exception '只有管理员可以管理团队' using errcode='42501';
  end if;

  perform edm_private.assert_workspace_member_headroom(ws, 1);

  select exists(
    select 1
    from edm.workspace_members wm
    join auth.users au on au.id=wm.user_id
    join edm.members em on em.user_id=wm.user_id
    where wm.workspace_id=ws and wm.status='active' and em.status='active'
      and lower(btrim(au.email))=email_value
  ) into active_member;
  if active_member then raise exception '该邮箱已是工作区成员'; end if;

  select id into existing_id
  from edm.workspace_invitations
  where workspace_id=ws and email_normalized=email_value and status='pending'
  for update;
  if existing_id is not null then
    if exists(select 1 from edm.workspace_invitations where id=existing_id and expires_at<=clock_timestamp()) then
      perform edm_private.expire_workspace_invitations(ws);
    else
      raise exception '该邮箱已有待处理邀请，请选择重新生成邀请链接';
    end if;
  end if;

  insert into edm.workspace_invitations(
    workspace_id,email_normalized,role,token_hash,token_hint,expires_at,invited_by
  ) values (
    ws,email_value,invitation_role,token_hash_value,token_hint_value,
    clock_timestamp()+interval '7 days',uid
  ) returning * into invitation_row;

  if workspace_row.type='personal' then
    update edm.workspaces set type='team',updated_at=clock_timestamp() where id=ws;
    perform edm_private.log_activity(
      ws,'workspace.converted_to_team','workspace',ws,workspace_row.name,
      jsonb_build_object('from_type','personal','to_type','team'),
      'workspace.converted_to_team:'||ws::text
    );
  end if;

  perform edm_private.log_activity(
    ws,'team.invitation_created','invitation',invitation_row.id,
    edm_private.mask_invitation_email(email_value),
    jsonb_build_object('role',invitation_role,'expires_at',invitation_row.expires_at),
    'team.invitation_created:'||invitation_row.id::text
  );
  return jsonb_build_object(
    'id',invitation_row.id,'workspace_id',ws,'email',email_value,
    'email_hint',edm_private.mask_invitation_email(email_value),
    'role',invitation_role,'status',invitation_row.status,
    'expires_at',invitation_row.expires_at,'version',invitation_row.version
  );
end;
$$;

create or replace function edm_private.accept_workspace_invitation(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  token_hash_value text := coalesce(payload->>'token_hash','');
  invitation_row edm.workspace_invitations;
  workspace_row edm.workspaces;
  member_row edm.workspace_members;
  member_exists boolean;
  auth_email text;
  confirmed_at timestamptz;
  member_status text;
begin
  if uid is null then raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501'; end if;
  if token_hash_value !~ '^[0-9a-f]{64}$' then
    raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501';
  end if;
  select * into invitation_row from edm.workspace_invitations where token_hash=token_hash_value;
  if not found then raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501'; end if;
  select * into workspace_row from edm.workspaces where id=invitation_row.workspace_id for update;
  select * into invitation_row from edm.workspace_invitations where id=invitation_row.id for update;
  if invitation_row.status='pending' and invitation_row.expires_at<=clock_timestamp() then
    perform edm_private.expire_workspace_invitations(invitation_row.workspace_id);
    return jsonb_build_object('status','expired');
  end if;
  if invitation_row.status<>'pending' then
    raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501';
  end if;

  select email,email_confirmed_at into auth_email,confirmed_at from auth.users where id=uid;
  if auth_email is null or confirmed_at is null or lower(btrim(auth_email))<>invitation_row.email_normalized then
    raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501';
  end if;
  insert into edm.members(user_id,status) values(uid,'active') on conflict(user_id) do nothing;
  select status into member_status from edm.members where user_id=uid for update;
  if member_status<>'active' then
    raise exception '邀请无法接受，请使用邀请邮箱的已验证账号登录' using errcode='42501';
  end if;

  select * into member_row from edm.workspace_members
  where workspace_id=invitation_row.workspace_id and user_id=uid for update;
  member_exists := found;
  if member_exists and member_row.status='active' then
    update edm.workspace_invitations
    set status='accepted',accepted_by=uid,accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where id=invitation_row.id returning * into invitation_row;
  elsif member_exists then
    perform edm_private.assert_workspace_member_headroom(invitation_row.workspace_id, 1);
    update edm.workspace_members
    set role=invitation_row.role,status='active',removed_at=null,joined_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where workspace_id=invitation_row.workspace_id and user_id=uid;
    update edm.workspace_invitations
    set status='accepted',accepted_by=uid,accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where id=invitation_row.id returning * into invitation_row;
  else
    perform edm_private.assert_workspace_member_headroom(invitation_row.workspace_id, 1);
    insert into edm.workspace_members(workspace_id,user_id,role,status,joined_at)
    values(invitation_row.workspace_id,uid,invitation_row.role,'active',clock_timestamp());
    update edm.workspace_invitations
    set status='accepted',accepted_by=uid,accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
    where id=invitation_row.id returning * into invitation_row;
  end if;

  perform edm_private.log_activity(
    invitation_row.workspace_id,'team.invitation_accepted','invitation',invitation_row.id,
    edm_private.mask_invitation_email(invitation_row.email_normalized),
    jsonb_build_object('role',invitation_row.role),
    'team.invitation_accepted:'||invitation_row.id::text
  );
  return jsonb_build_object(
    'workspace_id',invitation_row.workspace_id,'invitation_id',invitation_row.id,
    'role',invitation_row.role,'status','accepted','workspace_name',workspace_row.name
  );
end;
$$;

create or replace function edm_private.get_workspace_delivery_plan(payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ws uuid := (payload->>'workspace_id')::uuid;
  limits edm.delivery_plan_limits;
  usage_today integer;
  billable_contacts integer;
  active_members integer;
begin
  if ws is null then raise exception '工作区标识无效'; end if;
  if auth.uid() is null or edm_private.workspace_role(ws) is null then
    raise exception '没有权限查看发信套餐' using errcode='42501';
  end if;
  select * into limits from edm_private.delivery_plan_limits_for_workspace(ws);
  if not found then raise exception '工作区套餐配置无效'; end if;
  usage_today := edm_private.workspace_daily_send_usage(ws, limits.quota_timezone);
  billable_contacts := edm_private.workspace_billable_contact_count(ws);
  active_members := edm_private.workspace_active_member_count(ws);
  return jsonb_build_object(
    'plan', limits.plan,
    'plan_display_name', limits.display_name,
    'max_billable_contacts', limits.max_billable_contacts,
    'billable_contacts', billable_contacts,
    'remaining_billable_contacts', greatest(limits.max_billable_contacts - billable_contacts, 0),
    'max_active_members', limits.max_active_members,
    'active_members', active_members,
    'remaining_member_slots', greatest(limits.max_active_members - active_members, 0),
    'daily_send_quota', limits.daily_send_quota,
    'usage_today', usage_today,
    'remaining_today', greatest(limits.daily_send_quota - usage_today, 0),
    'max_recipients_per_campaign', limits.max_recipients_per_campaign,
    'quota_timezone', limits.quota_timezone
  );
end;
$$;
