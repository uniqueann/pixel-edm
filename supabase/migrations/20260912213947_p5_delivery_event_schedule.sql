-- cloud-only: supabase-managed-extensions
-- P5-1 回执自动重匹配与 180 天保留清理。复用项目现有 pg_cron 扩展。

do $schedule$
declare existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname='edm-delivery-event-reconcile'
  loop perform cron.unschedule(existing_job); end loop;
  perform cron.schedule(
    'edm-delivery-event-reconcile','* * * * *',
    $$select edm.worker_reconcile_delivery_events('{"limit":100}'::jsonb);$$
  );

  for existing_job in
    select jobid from cron.job where jobname='edm-delivery-event-retention'
  loop perform cron.unschedule(existing_job); end loop;
  perform cron.schedule(
    'edm-delivery-event-retention','17 3 * * *',
    $$select edm.worker_cleanup_delivery_events('{}'::jsonb);$$
  );
end;
$schedule$;
