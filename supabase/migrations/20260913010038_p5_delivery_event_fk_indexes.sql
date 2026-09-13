-- P5-1 回执事件复合外键索引，避免关联校验和父记录维护时扫描全表。

create index campaign_delivery_events_channel_fk_idx
  on edm.campaign_delivery_events(workspace_id,channel_id);
create index campaign_delivery_events_run_fk_idx
  on edm.campaign_delivery_events(workspace_id,run_id)
  where run_id is not null;
create index campaign_delivery_events_attempt_fk_idx
  on edm.campaign_delivery_events(workspace_id,attempt_id)
  where attempt_id is not null;
create index campaign_delivery_events_subscription_event_fk_idx
  on edm.campaign_delivery_events(workspace_id,subscription_event_id)
  where subscription_event_id is not null;
