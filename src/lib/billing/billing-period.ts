/** 周期结束时间未知时视为仍在周期内，避免误把预约取消当成立刻降级。 */
export function billingPeriodStillOpen(iso: string | null | undefined) {
  if (!iso) return true;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return true;
  return time > Date.now();
}
