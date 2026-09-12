-- cloud-only: supabase-managed-extensions
-- P4-3 云端 worker 调度。共享扩展已在部署前核对为可用且尚未启用。

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select vault.create_secret(
  encode(extensions.gen_random_bytes(32),'hex'),
  'edm_delivery_worker_token',
  '卖家邮局 P4-3 worker 调用令牌'
)
where not exists(
  select 1 from vault.secrets where name='edm_delivery_worker_token'
);

create function edm.worker_authorize_delivery_invocation(payload jsonb) returns boolean
language sql security definer set search_path='' as $$
  select char_length(coalesce(payload->>'token',''))>=32 and exists(
    select 1 from vault.decrypted_secrets secret
    where secret.name='edm_delivery_worker_token'
      and secret.decrypted_secret=payload->>'token'
  );
$$;

revoke all on function edm.worker_authorize_delivery_invocation(jsonb)
from public,anon,authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function edm.worker_authorize_delivery_invocation(jsonb)
    to service_role;
  end if;
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on function edm.worker_authorize_delivery_invocation(jsonb)
    from aigc_api;
  end if;
end $$;

do $schedule$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname='edm-directmail-worker'
  loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule(
    'edm-directmail-worker',
    '10 seconds',
    $job$
      select net.http_post(
        url:='https://gnrhyahjegvcicektebh.supabase.co/functions/v1/edm-directmail-worker',
        headers:=jsonb_build_object(
          'Content-Type','application/json',
          'x-edm-worker-token',(
            select decrypted_secret from vault.decrypted_secrets
            where name='edm_delivery_worker_token'
          )
        ),
        body:='{}'::jsonb,
        timeout_milliseconds:=25000
      );
    $job$
  );
end;
$schedule$;
