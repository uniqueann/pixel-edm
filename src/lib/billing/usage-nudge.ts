/** 已用达到上限的 80% 且尚未用满时，返回剩余数量。 */
export function remainingAtUsageNudge(used: number, max: number) {
  if (!Number.isFinite(used) || !Number.isFinite(max) || max <= 0) return null;
  if (used >= max) return null;
  if (used / max < 0.8) return null;
  return max - used;
}
