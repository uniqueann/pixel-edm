-- P10：收紧 free 档（前期默认全员 free）。若上一迁移已写入旧默认，此处对齐。

update edm.delivery_plan_limits set
  daily_send_quota = 1000,
  max_rate_per_second = 2,
  updated_at = clock_timestamp()
where plan = 'free'
  and (daily_send_quota <> 1000 or max_rate_per_second <> 2);
