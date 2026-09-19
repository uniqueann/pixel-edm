-- cloud-only: supabase-managed-extensions
-- P8-2 将定时领取切换到 provider-aware worker；旧函数保留为兼容代理。

do $schedule$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in ('edm-directmail-worker','edm-delivery-worker')
  loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule(
    'edm-delivery-worker',
    '10 seconds',
    $job$
      select net.http_post(
        url:='https://gnrhyahjegvcicektebh.supabase.co/functions/v1/edm-delivery-worker',
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
