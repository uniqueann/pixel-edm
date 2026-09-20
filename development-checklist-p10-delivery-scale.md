# P10 发信扛量（多租户公平调度）

更新日期：2026-09-20。状态：content-up 已应用迁移并部署 worker（PR #16）。优先验收：**10 户 × 单活动 500 收件人同时入队**。

## 目标

- 多工作区同时发送时，单户长队列不能占满 worker 候选窗口。
- 在套餐/通道 `least` 限速内，提高全平台 drain 能力（更大 batch、更密 cron）。
- SendGrid 与支付不在本阶段范围。

## 瓶颈（改前）

| 项 | 改前 | 改后（本阶段） |
|----|------|----------------|
| cron | 10s × 1 | **5s** × 1（content-up 迁移） |
| 单批领取 | 硬上限 10 | 默认 **50**，上限 **100**（RPC + Edge `EDM_WORKER_CLAIM_LIMIT`） |
| 候选扫描 | 100 行全局 FIFO | **500 行**，按工作区轮次 **公平排序** |
| 公平性 | 先排队的大 run 挤占扫描窗口 | 每户按 pending 轮次交错 |

## 工程项

- [x] 迁移 `20260920183000_p10_delivery_worker_fair_claim.sql`：公平 claim + batch/扫描参数。
- [x] 迁移 `20260920183100_p10_delivery_worker_schedule.sql`（cloud-only）：cron 5s。
- [x] Edge `edm-delivery-worker`：`EDM_WORKER_CLAIM_LIMIT`（默认 50，最大 100）。
- [x] 测试 `tests/delivery-scale-fair-claim.test.mjs`（含 10 工作区缩小场景）。
- [x] content-up 应用 `20260920183000_p10_delivery_worker_fair_claim`、`20260920183100_p10_delivery_worker_schedule`；已部署 `edm-delivery-worker`（默认 claim 50）。
- [ ] 生产 soak：10 户 free 档各 500 收件活动，观察队列深度与每户 attempt 曲线。

## 吞吐粗算（free 全员）

- 单批最多约 10×2=20 封/次（每户 max_rate_per_second=2）。
- cron 5s → 约 **4 批/分钟** → 理想 **~80 封/分钟** 平台级（仍受 ESP 与 Edge 耗时约束）。
- 5000 封 backlog 约 **1 小时量级** drain（非瞬时 5000 并发 SMTP）。

## 验证

```sh
npm test -- tests/delivery-scale-fair-claim.test.mjs
npm test
npm run typecheck
```
