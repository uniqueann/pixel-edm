-- P4-3 为复合外键补齐前导列一致的覆盖索引。
create index campaign_delivery_runs_snapshot_fk_idx
  on edm.campaign_delivery_runs(workspace_id,snapshot_id);
create index campaign_delivery_tasks_recipient_fk_idx
  on edm.campaign_delivery_tasks(workspace_id,recipient_snapshot_id);
create index campaign_delivery_tasks_active_attempt_fk_idx
  on edm.campaign_delivery_tasks(workspace_id,active_attempt_id)
  where active_attempt_id is not null;
create index campaign_delivery_attempts_run_fk_idx
  on edm.campaign_delivery_attempts(workspace_id,run_id);
create index campaign_delivery_attempts_resolved_by_fk_idx
  on edm.campaign_delivery_attempts(workspace_id,resolved_by)
  where resolved_by is not null;
