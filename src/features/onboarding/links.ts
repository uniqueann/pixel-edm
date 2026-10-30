import { settingsSectionHref } from "@/features/settings/anchors";
import type { PreparationTask } from "./model";

export const preparationOverviewHref = "/dashboard#onboarding";
export type GuideTask = PreparationTask | "campaigns";

export function preparationHref(task: GuideTask, hasContacts = false) {
  if (task === "store" || task === "channels") {
    const [pathname, hash] = settingsSectionHref(task).split("#");
    return `${pathname}?guide=${task}#${hash}`;
  }
  return `${task === "contacts" && !hasContacts ? "/contacts/import" : `/${task}`}?guide=${task}`;
}
