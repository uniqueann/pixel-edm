-- P11-0：Creem / Dodo 工作区账单基础（Webhook 经 service_role 调 edm.sync_workspace_plan_from_payment）。

create table edm_private.workspace_billing_subscriptions (
  workspace_id uuid primary key references edm.workspaces(id) on delete cascade,
  payment_provider text not null check (payment_provider in ('creem', 'dodo')),
  provider_customer_id text not null,
  provider_subscription_id text,
  subscription_status text not null default 'inactive'
    check (subscription_status in (
      'inactive', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete'
    )),
  billed_plan text not null default 'free' check (billed_plan in ('free', 'pro', 'team')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_billing_provider_customer_uid unique (payment_provider, provider_customer_id),
  constraint workspace_billing_provider_sub_uid unique (payment_provider, provider_subscription_id)
);

create index workspace_billing_subscriptions_status_idx
  on edm_private.workspace_billing_subscriptions(subscription_status);

create trigger workspace_billing_subscriptions_updated
  before update on edm_private.workspace_billing_subscriptions
  for each row execute function edm_private.touch_updated_at();

create table edm_private.billing_payment_events (
  payment_provider text not null check (payment_provider in ('creem', 'dodo')),
  provider_event_id text not null,
  event_type text not null,
  workspace_id uuid references edm.workspaces(id) on delete set null,
  processed_at timestamptz not null default now(),
  primary key (payment_provider, provider_event_id)
);

revoke all on edm_private.workspace_billing_subscriptions, edm_private.billing_payment_events
  from public, anon, authenticated;

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
  period_end timestamptz;
  cancel_at_end boolean;
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

  insert into edm_private.workspace_billing_subscriptions(
    workspace_id, payment_provider, provider_customer_id, provider_subscription_id,
    subscription_status, billed_plan, current_period_end, cancel_at_period_end
  ) values (
    ws, provider, customer_id, subscription_id, sub_status,
    coalesce(target_plan, 'free'), period_end, cancel_at_end
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

  effective_plan := case
    when sub_status in ('active', 'trialing') then coalesce(target_plan, 'free')
    when sub_status in ('canceled', 'unpaid', 'incomplete') then 'free'
    when sub_status = 'past_due' then coalesce(target_plan, 'free')
    else 'free'
  end;

  if effective_plan not in ('free', 'pro', 'team') then
    effective_plan := 'free';
  end if;

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

create or replace function edm_private.get_workspace_billing_status(payload jsonb)
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
  if edm_private.workspace_role(ws) <> 'admin' then
    raise exception '仅管理员可查看账单状态' using errcode = '42501';
  end if;

  select * into workspace_row from edm.workspaces where id = ws;
  if not found then
    raise exception '工作区不存在' using errcode = '22023';
  end if;

  select * into sub_row from edm_private.workspace_billing_subscriptions where workspace_id = ws;

  return jsonb_build_object(
    'plan', workspace_row.plan,
    'payment_provider', sub_row.payment_provider,
    'has_payment_provider', sub_row.workspace_id is not null,
    'subscription_status', coalesce(sub_row.subscription_status, 'none'),
    'billed_plan', coalesce(sub_row.billed_plan, workspace_row.plan),
    'current_period_end', sub_row.current_period_end,
    'cancel_at_period_end', coalesce(sub_row.cancel_at_period_end, false)
  );
end;
$$;

create or replace function edm.get_workspace_billing_status(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select edm_private.get_workspace_billing_status(payload);
$$;

create or replace function edm.sync_workspace_plan_from_payment(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select edm_private.sync_workspace_plan_from_payment(payload);
$$;

revoke all on function edm_private.sync_workspace_plan_from_payment(jsonb) from public, anon, authenticated;
revoke all on function edm.sync_workspace_plan_from_payment(jsonb) from public, anon, authenticated;

revoke all on function edm_private.get_workspace_billing_status(jsonb) from public, anon;
grant execute on function edm_private.get_workspace_billing_status(jsonb) to authenticated;
grant execute on function edm.get_workspace_billing_status(jsonb) to authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function edm.sync_workspace_plan_from_payment(jsonb) to service_role;
  end if;
end $$;
