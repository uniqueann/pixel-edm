import type { EdmBilledPlan } from "./metadata";

/** 与 edm.workspaces.plan 一致 */
export type WorkspacePlan = "free" | "pro" | "team";

export function normalizeWorkspacePlan(
  value: string | null | undefined,
): WorkspacePlan {
  if (value === "pro" || value === "team") return value;
  return "free";
}

/** Checkout 目标档位是否允许（不含支付侧换档，仅 EDM 工作区 plan）。 */
export function assertCheckoutTargetAllowed(
  currentPlan: WorkspacePlan,
  targetPlan: EdmBilledPlan,
): { ok: true } | { ok: false; error: string } {
  if (targetPlan === "pro") {
    if (currentPlan !== "free") {
      return {
        ok: false,
        error:
          currentPlan === "team"
            ? "当前已是团队版，无需购买专业版。"
            : "专业版仅可从免费版新购。如需团队能力请升级团队版。",
      };
    }
    return { ok: true };
  }

  if (currentPlan === "team") {
    return { ok: false, error: "当前已是团队版。" };
  }

  return { ok: true };
}
