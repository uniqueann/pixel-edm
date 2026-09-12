-- P4-3 暂停期间最后一批任务结束后，恢复时立即收敛最终状态。
create function edm_private.finalize_resumed_campaign_if_settled() returns trigger
language plpgsql set search_path='' as $$
declare
  requested_run_id uuid;
begin
  if old.status='paused' and new.status in ('queued','sending') then
    select run.id into requested_run_id
    from edm.campaign_delivery_runs run
    where run.workspace_id=new.workspace_id and run.campaign_id=new.id
      and run.status in ('queued','sending')
      and not exists(
        select 1 from edm.campaign_delivery_tasks task
        where task.run_id=run.id and task.status in ('pending','processing')
      );
    if requested_run_id is not null then
      perform edm_private.finalize_campaign_delivery(requested_run_id);
    end if;
  end if;
  return null;
end;
$$;

create trigger campaigns_finalize_resumed_delivery
  after update of status on edm.campaigns
  for each row execute function edm_private.finalize_resumed_campaign_if_settled();

revoke all on function edm_private.finalize_resumed_campaign_if_settled()
from public,anon,authenticated;

do $$ begin
  if exists(select 1 from pg_roles where rolname='aigc_api') then
    revoke all on function edm_private.finalize_resumed_campaign_if_settled()
    from aigc_api;
  end if;
end $$;
