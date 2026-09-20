-- P10 扛量：多租户公平领取 + 放大 batch/扫描窗口（目标 10 户 × 500 同时排队）。
-- 仅 edm / edm_private。

create or replace function edm_private.worker_claim_delivery_batch(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  max_batch constant integer := 100;
  default_batch constant integer := 50;
  candidate_scan constant integer := 500;
  requested_limit integer := least(
    greatest(coalesce((payload->>'limit')::integer, default_batch), 1),
    max_batch
  );
  task_row edm.campaign_delivery_tasks;
  run_row edm.campaign_delivery_runs;
  channel_row edm.delivery_channels;
  credential_row edm_private.delivery_channel_credentials;
  recipient_row edm.campaign_recipient_snapshots;
  contact_row edm.contacts;
  plan_limits edm.delivery_plan_limits;
  new_attempt_id uuid;
  lease uuid;
  claimed jsonb := '[]'::jsonb;
  claimed_count integer := 0;
  workspace_claims jsonb := '{}'::jsonb;
  recent_calls integer;
  daily_calls integer;
  retry_at timestamptz;
  limit_per_second integer;
  limit_daily integer;
  quota_zone text;
begin
  perform edm_private.worker_recover_expired_delivery_leases();
  -- 按工作区轮次公平排序，避免单户长队列占满候选扫描窗口。
  for task_row in
    select t.*
    from edm.campaign_delivery_tasks t
    join (
      select task.id as task_id,
        row_number() over (
          partition by task.workspace_id
          order by task.next_attempt_at, task.position
        ) as ws_round
      from edm.campaign_delivery_tasks task
      join edm.campaign_delivery_runs run on run.id = task.run_id
      where task.status = 'pending'
        and task.next_attempt_at <= clock_timestamp()
        and run.status in ('queued', 'sending')
    ) fair on fair.task_id = t.id
    order by fair.ws_round, t.workspace_id, t.next_attempt_at, t.position
    for update of t skip locked
    limit candidate_scan
  loop
    exit when claimed_count >= requested_limit;
    select * into run_row from edm.campaign_delivery_runs where id = task_row.run_id for update;
    if run_row.status not in ('queued', 'sending') then continue; end if;

    select * into plan_limits
    from edm_private.delivery_plan_limits_for_workspace(task_row.workspace_id);
    if not found then continue; end if;

    select
      coalesce(channel.rate_per_second, prov.default_rate_per_second),
      coalesce(channel.daily_quota, prov.default_daily_quota),
      prov.quota_timezone
    into limit_per_second, limit_daily, quota_zone
    from edm.delivery_channels channel
    join edm.delivery_providers prov on prov.provider = channel.provider
    where channel.workspace_id = run_row.workspace_id and channel.id = run_row.channel_id;
    if limit_per_second is null then
      select default_rate_per_second, default_daily_quota, quota_timezone
      into limit_per_second, limit_daily, quota_zone
      from edm.delivery_providers where provider = run_row.provider;
    end if;

    limit_per_second := least(limit_per_second, plan_limits.max_rate_per_second);
    limit_daily := least(limit_daily, plan_limits.daily_send_quota);
    quota_zone := plan_limits.quota_timezone;

    if coalesce((workspace_claims->>task_row.workspace_id::text)::integer, 0) >= limit_per_second then
      continue;
    end if;
    if char_length(btrim(run_row.sender_workspace_name)) = 0
      or char_length(btrim(run_row.sender_mailing_address)) = 0 then
      update edm.campaign_delivery_runs set status = 'paused', pause_reason = 'sender_compliance',
        paused_at = clock_timestamp(), version = version + 1 where id = run_row.id;
      update edm.campaigns set status = 'paused', updated_at = clock_timestamp(), version = version + 1
        where workspace_id = run_row.workspace_id and id = run_row.campaign_id;
      perform edm_private.log_activity(
        run_row.workspace_id, 'campaign.delivery_paused', 'campaign', run_row.campaign_id, null,
        jsonb_build_object('run_id', run_row.id, 'reason', 'sender_compliance'),
        'campaign-delivery-compliance-paused:' || run_row.id::text, true
      );
      continue;
    end if;

    select count(*) into recent_calls from edm.campaign_delivery_attempts attempt
    where attempt.workspace_id = task_row.workspace_id
      and attempt.provider_call_started_at > clock_timestamp() - interval '1 second';
    if recent_calls >= limit_per_second then continue; end if;
    select count(*) into daily_calls from edm.campaign_delivery_attempts attempt
    where attempt.workspace_id = task_row.workspace_id
      and (attempt.provider_call_started_at at time zone quota_zone)::date =
        (clock_timestamp() at time zone quota_zone)::date;
    if daily_calls >= limit_daily then
      retry_at = (date_trunc('day', clock_timestamp() at time zone quota_zone) + interval '1 day')
        at time zone quota_zone;
      update edm.campaign_delivery_tasks set next_attempt_at = retry_at, version = version + 1
        where id = task_row.id;
      continue;
    end if;

    select * into recipient_row from edm.campaign_recipient_snapshots
      where workspace_id = task_row.workspace_id and id = task_row.recipient_snapshot_id;
    select * into contact_row from edm.contacts
      where workspace_id = task_row.workspace_id and id = recipient_row.contact_id;
    if not found or contact_row.archived_at is not null
      or contact_row.email <> recipient_row.email
      or contact_row.subscription_status <> 'subscribed'
      or exists(
        select 1 from edm.suppressions suppression
        where suppression.workspace_id = task_row.workspace_id
          and suppression.email = recipient_row.email
      ) then
      update edm.campaign_delivery_tasks set status = 'skipped', skip_reason = 'recipient_ineligible',
        completed_at = clock_timestamp(), version = version + 1 where id = task_row.id;
      perform edm_private.finalize_campaign_delivery(task_row.run_id);
      continue;
    end if;

    select * into channel_row from edm.delivery_channels
      where workspace_id = run_row.workspace_id and id = run_row.channel_id;
    select * into credential_row from edm_private.delivery_channel_credentials
      where workspace_id = run_row.workspace_id and channel_id = run_row.channel_id
        and credential_version = run_row.credential_version;
    if channel_row.id is null or credential_row.channel_id is null
      or channel_row.status <> 'verified'
      or channel_row.provider <> run_row.provider
      or (channel_row.provider_config->>'region') is distinct from (run_row.provider_config->>'region')
      or channel_row.sender_address <> run_row.sender_address
      or channel_row.sender_alias <> run_row.sender_alias
      or channel_row.reply_to_address is distinct from run_row.reply_to_address then
      update edm.campaign_delivery_runs set status = 'paused', pause_reason = 'channel_configuration',
        paused_at = clock_timestamp(), version = version + 1 where id = run_row.id;
      update edm.campaigns set status = 'paused', updated_at = clock_timestamp(), version = version + 1
        where workspace_id = run_row.workspace_id and id = run_row.campaign_id;
      continue;
    end if;

    lease = gen_random_uuid();
    insert into edm.campaign_delivery_attempts(
      workspace_id, run_id, task_id, attempt_number, credential_version
    ) values (
      task_row.workspace_id, task_row.run_id, task_row.id, task_row.attempt_count + 1,
      run_row.credential_version
    ) returning id into new_attempt_id;
    update edm.campaign_delivery_tasks set status = 'processing',
      attempt_count = attempt_count + 1, lease_token = lease,
      lease_expires_at = clock_timestamp() + interval '90 seconds',
      active_attempt_id = new_attempt_id, error_category = null, error_code = null,
      completed_at = null, version = version + 1 where id = task_row.id;
    if run_row.status = 'queued' then
      update edm.campaign_delivery_runs set status = 'sending', version = version + 1 where id = run_row.id;
      update edm.campaigns set status = 'sending', updated_at = clock_timestamp(), version = version + 1
        where workspace_id = run_row.workspace_id and id = run_row.campaign_id;
    end if;
    claimed = claimed || jsonb_build_array(jsonb_build_object(
      'task_id', task_row.id, 'run_id', run_row.id, 'workspace_id', run_row.workspace_id,
      'attempt_id', new_attempt_id, 'lease_token', lease,
      'recipient_email', recipient_row.email, 'subject', recipient_row.subject, 'body', recipient_row.body,
      'workspace_name', run_row.sender_workspace_name,
      'mailing_address', run_row.sender_mailing_address,
      'channel', jsonb_strip_nulls(jsonb_build_object(
        'id', channel_row.id,
        'provider', run_row.provider,
        'provider_config', run_row.provider_config,
        'region', run_row.provider_config->>'region',
        'sender_address', run_row.sender_address,
        'sender_alias', run_row.sender_alias, 'reply_to_address', run_row.reply_to_address,
        'credential_version', run_row.credential_version,
        'tracking_enabled', run_row.tracking_enabled,
        'tracking_tag_name', run_row.provider_config->>'tracking_tag_name'
      )),
      'credential', jsonb_build_object(
        'key_id', credential_row.key_id, 'nonce', encode(credential_row.nonce, 'base64'),
        'ciphertext', encode(credential_row.ciphertext, 'base64'),
        'credential_version', credential_row.credential_version
      )
    ));
    workspace_claims = jsonb_set(
      workspace_claims,
      array[task_row.workspace_id::text],
      to_jsonb(coalesce((workspace_claims->>task_row.workspace_id::text)::integer, 0) + 1),
      true
    );
    claimed_count = claimed_count + 1;
  end loop;
  return claimed;
end;
$$;
