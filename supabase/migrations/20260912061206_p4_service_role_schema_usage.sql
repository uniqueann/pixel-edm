-- P4-2 修复：Edge Function 的 service_role 需要先进入 edm schema，
-- 才能调用已单独授权的 worker RPC。保持表和 edm_private 为不可直访。
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant usage on schema edm to service_role;
  end if;
end $$;

-- 权限缺失期间已创建但从未被 worker 领取的任务不会再自行推进。
-- 只收尾迁移事务开始前的遗留 pending 记录，不改变通道状态。
do $$
declare attempt_row record;
begin
  for attempt_row in
    update edm.delivery_test_attempts
    set status='failed',
        error_category='configuration',
        error_code='EDGE_WORKER_SCHEMA_PERMISSION_MISSING',
        completed_at=clock_timestamp()
    where status='pending'
      and started_at is null
      and completed_at is null
      and created_at<transaction_timestamp()
    returning id,workspace_id,channel_id
  loop
    perform edm_private.log_activity(
      attempt_row.workspace_id,
      'delivery_channel.test_failed',
      'delivery_channel',
      attempt_row.channel_id,
      '阿里云邮件推送',
      jsonb_build_object(
        'provider','aliyun_directmail',
        'attempt_id',attempt_row.id,
        'result','failed',
        'error_category','configuration',
        'error_code','EDGE_WORKER_SCHEMA_PERMISSION_MISSING'
      ),
      'delivery-channel-test-finished:'||attempt_row.id::text,
      true
    );
  end loop;
end $$;
