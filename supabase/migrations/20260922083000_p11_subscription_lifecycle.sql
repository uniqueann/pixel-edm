-- P11-5：预约取消在周期结束前保留套餐；超额席位时锁定编辑者写操作。

create or replace function edm_private.sync_workspace_plan_from_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  provider text;
  event_id text;
  event_type text;
  customer_id text;
  subscription_id text;
  sub_status text;
  target_plan text;
  previous_plan text;
  period_end timestamptz;
  cancel_at_end boolean;
  access_ended boolean := false;
  period_open boolean;
  kept_plan text;
  effective_plan text;
  inserted_events integer;
begin
  provider := nullif(btrim(payload->>'payment_provider'), '');
  event_id := nullif(btrim(payload->>'provider_event_id'), '');
  event_type := nullif(btrim(payload->>'event_type'), '');
  ws := nullif(payload->>'workspace_id', '')::uuid;
  customer_id := nullif(btrim(payload->>'provider_customer_id'), '');
  subscription_id := nullif(btrim(payload->>'provider_subscription_id'), '');
  sub_status := nullif(btrim(payload->>'subscription_status'), '');
  target_plan := nullif(btrim(payload->>'billed_plan'), '');
  period_end := nullif(payload->>'current_period_end', '')::timestamptz;
  cancel_at_end := coalesce((payload->>'cancel_at_period_end')::boolean, false);

  if provider is null or provider not in ('creem', 'dodo') then
    raise exception 'payment_provider 必须是 creem 或 dodo' using errcode = '22023';
  end if;
  if event_id is null or event_type is null then
    raise exception '缺少 provider_event_id 或 event_type' using errcode = '22023';
  end if;
  if ws is null then
    raise exception '缺少 workspace_id' using errcode = '22023';
  end if;
  if customer_id is null then
    raise exception '缺少 provider_customer_id' using errcode = '22023';
  end if;
  if target_plan is not null and target_plan not in ('free', 'pro', 'team') then
    raise exception '无效的 billed_plan' using errcode = '22023';
  end if;

  select billed_plan into previous_plan
  from edm_private.workspace_billing_subscriptions
  where workspace_id = ws;

  insert into edm_private.billing_payment_events(
    payment_provider, provider_event_id, event_type, workspace_id
  ) values (provider, event_id, event_type, ws)
  on conflict (payment_provider, provider_event_id) do nothing;

  get diagnostics inserted_events = row_count;
  if inserted_events = 0 then
    return jsonb_build_object('ok', true, 'duplicate', true, 'workspace_id', ws);
  end if;

  if sub_status is null then
    sub_status := 'inactive';
  end if;
  if sub_status = 'cancelled' then
    sub_status := 'canceled';
  end if;
  if sub_status = 'expired' then
    access_ended := true;
    sub_status := 'canceled';
  end if;

  insert into edm_private.workspace_billing_subscriptions(
    workspace_id, payment_provider, provider_customer_id, provider_subscription_id,
    subscription_status, billed_plan, current_period_end, cancel_at_period_end
  ) values (
    ws, provider, customer_id, subscription_id, sub_status,
    coalesce(target_plan, previous_plan, 'free'), period_end, cancel_at_end
  )
  on conflict (workspace_id) do update set
    payment_provider = excluded.payment_provider,
    provider_customer_id = excluded.provider_customer_id,
    provider_subscription_id = coalesce(
      excluded.provider_subscription_id,
      workspace_billing_subscriptions.provider_subscription_id
    ),
    subscription_status = excluded.subscription_status,
    billed_plan = coalesce(excluded.billed_plan, workspace_billing_subscriptions.billed_plan),
    current_period_end = coalesce(
      excluded.current_period_end,
      workspace_billing_subscriptions.current_period_end
    ),
    cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = now();

  select current_period_end into period_end
  from edm_private.workspace_billing_subscriptions
  where workspace_id = ws;

  period_open := period_end is null or period_end > now();
  kept_plan := coalesce(nullif(target_plan, 'free'), previous_plan, 'free');

  if sub_status in ('active', 'trialing') then
    effective_plan := case
      when target_plan in ('pro', 'team') then target_plan
      else coalesce(previous_plan, 'free')
    end;
  elsif sub_status = 'past_due' then
    effective_plan := case
      when target_plan in ('pro', 'team') then target_plan
      else coalesce(previous_plan, 'free')
    end;
  elsif access_ended then
    effective_plan := 'free';
  elsif cancel_at_end and period_open and kept_plan in ('pro', 'team') then
    -- 预约取消：周期未结束前继续使用已付费档。
    effective_plan := kept_plan;
    sub_status := 'active';
  elsif sub_status in ('canceled', 'unpaid', 'incomplete') then
    effective_plan := 'free';
  else
    effective_plan := 'free';
  end if;

  if effective_plan not in ('free', 'pro', 'team') then
    effective_plan := 'free';
  end if;

  update edm_private.workspace_billing_subscriptions set
    subscription_status = sub_status,
    billed_plan = effective_plan,
    cancel_at_period_end = cancel_at_end,
    updated_at = now()
  where workspace_id = ws;

  update edm.workspaces set plan = effective_plan, updated_at = now()
  where id = ws;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'workspace_id', ws,
    'plan', effective_plan,
    'payment_provider', provider,
    'subscription_status', sub_status
  );
end;
$$;

create or replace function edm_private.get_workspace_billing_cancel_target(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid;
  workspace_row edm.workspaces;
  sub_row edm_private.workspace_billing_subscriptions;
begin
  ws := nullif(payload->>'workspace_id', '')::uuid;
  if ws is null then
    raise exception '缺少 workspace_id' using errcode = '22023';
  end if;

  select * into workspace_row from edm.workspaces where id = ws;
  if not found then
    raise exception '工作区不存在' using errcode = '22023';
  end if;

  select * into sub_row
  from edm_private.workspace_billing_subscriptions
  where workspace_id = ws;

  return jsonb_build_object(
    'plan', workspace_row.plan,
    'payment_provider', sub_row.payment_provider,
    'provider_subscription_id', sub_row.provider_subscription_id,
    'provider_customer_id', sub_row.provider_customer_id,
    'subscription_status', coalesce(sub_row.subscription_status, 'none'),
    'billed_plan', coalesce(sub_row.billed_plan, workspace_row.plan),
    'current_period_end', sub_row.current_period_end,
    'cancel_at_period_end', coalesce(sub_row.cancel_at_period_end, false),
    'has_subscription', sub_row.workspace_id is not null
  );
end;
$$;

create or replace function edm.get_workspace_billing_cancel_target(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select edm_private.get_workspace_billing_cancel_target(payload);
$$;

revoke all on function edm_private.get_workspace_billing_cancel_target(jsonb) from public, anon, authenticated;
revoke all on function edm.get_workspace_billing_cancel_target(jsonb) from public, anon, authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function edm.get_workspace_billing_cancel_target(jsonb) to service_role;
  end if;
end $$;

-- 活跃成员超过当前档席位时，编辑者不能继续改客户、模板、活动或导入。管理员仍可操作。
create or replace function edm_private.assert_editor_write_within_member_cap(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  limits edm.delivery_plan_limits;
  members integer;
begin
  if p_workspace_id is null then
    raise exception '缺少 workspace_id' using errcode = '22023';
  end if;
  actor_role := edm_private.workspace_role(p_workspace_id);
  if actor_role is distinct from 'editor' then
    return;
  end if;
  select * into limits
  from edm_private.delivery_plan_limits_for_workspace(p_workspace_id);
  if not found then
    raise exception '工作区套餐配置无效';
  end if;
  members := edm_private.workspace_active_member_count(p_workspace_id);
  if members > limits.max_active_members then
    raise exception '当前套餐席位已超出上限，协作编辑已锁定。请管理员减员或重新订阅后再试。'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function edm_private.assert_editor_write_within_member_cap(uuid) from public, anon;
grant execute on function edm_private.assert_editor_write_within_member_cap(uuid) to authenticated;

create or replace function edm.save_contact(payload jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  perform edm_private.assert_editor_write_within_member_cap((payload->>'workspace_id')::uuid);
  return edm_private.save_contact(payload);
end;
$$;

create or replace function edm.save_template(payload jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  perform edm_private.assert_editor_write_within_member_cap((payload->>'workspace_id')::uuid);
  return edm_private.save_template(payload);
end;
$$;

create or replace function edm.duplicate_template(payload jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  perform edm_private.assert_editor_write_within_member_cap((payload->>'workspace_id')::uuid);
  return edm_private.duplicate_template(payload);
end;
$$;

create or replace function edm.save_campaign(payload jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  perform edm_private.assert_editor_write_within_member_cap((payload->>'workspace_id')::uuid);
  return edm_private.save_campaign(payload);
end;
$$;

create or replace function edm.confirm_campaign(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform edm_private.assert_editor_write_within_member_cap((payload->>'workspace_id')::uuid);
  return edm_private.confirm_campaign(payload);
end;
$$;

create or replace function edm.start_campaign_delivery(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform edm_private.assert_editor_write_within_member_cap((payload->>'workspace_id')::uuid);
  return edm_private.start_campaign_delivery(payload);
end;
$$;

create or replace function edm.prepare_contact_import(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform edm_private.assert_editor_write_within_member_cap((payload->>'workspace_id')::uuid);
  return edm_private.prepare_contact_import(payload);
end;
$$;

create or replace function edm.confirm_contact_import(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform edm_private.assert_editor_write_within_member_cap((payload->>'workspace_id')::uuid);
  return edm_private.confirm_contact_import(payload);
end;
$$;

create or replace function edm.process_contact_import_batch(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform edm_private.assert_editor_write_within_member_cap((payload->>'workspace_id')::uuid);
  return edm_private.process_contact_import_batch(payload);
end;
$$;
