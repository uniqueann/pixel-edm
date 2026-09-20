-- cloud-only: supabase-managed-extensions
-- P10 扛量：缩短 cron 间隔（10s → 5s），仍调用 edm-delivery-worker。

do $schedule$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in ('edm-directmail-worker', 'edm-delivery-worker')
  loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule(
    'edm-delivery-worker',
    '5 seconds',
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
