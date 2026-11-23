"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { settingsSectionHref } from "@/features/settings/anchors";
import {
  preparationDefaultExpanded,
  preparationModel,
  preparationPreferenceKey,
  type PreparationFacts,
  type PreparationTask,
} from "./model";
import { preparationHref } from "./links";
import styles from "./preparation.module.css";

const preferenceEvent = "edm-preparation-preference";
const memoryPreferences = new Map<string, string>();
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(preferenceEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(preferenceEvent, callback);
  };
}
function readPreference(key: string) {
  if (memoryPreferences.has(key)) return memoryPreferences.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryPreferences.get(key) ?? null;
  }
}
function savePreference(key: string, expanded: boolean) {
  const value = expanded ? "expanded" : "collapsed";
  try {
    localStorage.setItem(key, value);
    memoryPreferences.delete(key);
  } catch {
    memoryPreferences.set(key, value);
    /* 浏览器禁用存储时，本次会话仍可展开和收起。 */
  }
  window.dispatchEvent(new Event(preferenceEvent));
}

export function PreparationGuide({
  facts,
  userId,
  workspaceId,
  otherDataUnavailable = false,
}: {
  facts: PreparationFacts;
  userId: string;
  workspaceId: string;
  otherDataUnavailable?: boolean;
}) {
  const t = useTranslations("dashboard.preparation");
  const model = preparationModel(facts);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const preferenceKey = preparationPreferenceKey(
    userId,
    workspaceId,
    facts.role,
  );
  const preference = useSyncExternalStore(
    subscribe,
    () => readPreference(preferenceKey),
    () => null,
  );
  const expanded =
    preference === "expanded" ||
    (preference !== "collapsed" && preparationDefaultExpanded(model));
  useEffect(() => {
    const reveal = () => {
      if (location.hash === "#onboarding") savePreference(preferenceKey, true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [preferenceKey]);

  const roleRestriction =
    facts.role === "viewer"
      ? t("restrictions.viewer")
      : facts.canWrite === null
        ? t("restrictions.unknown")
        : t("restrictions.seatExceeded");

  const localizedItemCopy = (key: PreparationTask) => {
    switch (key) {
      case "store":
        return {
          title: t("items.store.title"),
          detail: facts.storeReady
            ? t("items.store.done")
            : t("items.store.todo"),
          action: t("items.store.action"),
          restriction: t("restrictions.storeAdminOnly"),
        };
      case "channels":
        return {
          title: t("items.channels.title"),
          detail: facts.channel?.detail ?? t("items.channels.unknown"),
          action: t("items.channels.action"),
          restriction: t("restrictions.channelAdminOnly"),
        };
      case "contacts":
        return {
          title: t("items.contacts.title"),
          detail:
            facts.contacts === null
              ? t("items.contacts.unknown")
              : facts.contacts.subscribed > 0
                ? t("items.contacts.done", {
                    count: facts.contacts.subscribed,
                  })
                : facts.contacts.active > 0
                  ? t("items.contacts.activeOnly", {
                      count: facts.contacts.active,
                    })
                  : t("items.contacts.empty"),
          action: facts.contacts?.active
            ? t("items.contacts.actionCheck")
            : t("items.contacts.actionImport"),
          restriction: roleRestriction,
        };
      case "templates":
        return {
          title: t("items.templates.title"),
          detail:
            facts.templates === null
              ? t("items.templates.unknown")
              : facts.templates > 0
                ? t("items.templates.done", { count: facts.templates })
                : t("items.templates.empty"),
          action: facts.templates
            ? t("items.templates.actionView")
            : t("items.templates.actionCreate"),
          restriction: roleRestriction,
        };
    }
  };

  const next = model.recommended;
  const nextCopy = next ? localizedItemCopy(next.key) : null;
  const canCreate =
    facts.canWrite === true && facts.templates !== null && facts.templates > 0;
  const summary = model.unknown
    ? t("summaryUnknown", { completed: model.completed })
    : model.foundationReady
      ? t("summaryDone")
      : t("summaryProgress", { completed: model.completed });

  return (
    <section
      id="onboarding"
      data-testid="onboarding-guide"
      aria-labelledby="preparation-heading"
      className={styles.guide}
    >
      <div className={styles.header}>
        <div>
          <h2 id="preparation-heading">
            {model.hasCampaigns ? t("headingExisting") : t("headingFirst")}
          </h2>
          <p role="status" aria-live="polite">
            {pending ? t("rechecking") : summary}
          </p>
        </div>
        <Button
          variant="ghost"
          className={styles.control}
          aria-expanded={expanded}
          aria-controls="preparation-content"
          onClick={() => savePreference(preferenceKey, !expanded)}
        >
          {expanded ? t("collapse") : t("expand")}
          {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        </Button>
      </div>
      {(model.unknown || otherDataUnavailable) && (
        <div className={styles.error}>
          <p>{t("partialError")}</p>
          <Button
            variant="outline"
            className={styles.control}
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
          >
            {pending ? t("retrying") : t("retry")}
          </Button>
        </div>
      )}
      <div id="preparation-content" hidden={!expanded}>
        <div className={styles.body}>
          <div className={styles.recommendation}>
            <h3>
              {nextCopy
                ? t("recommendedPrefix", { action: nextCopy.action })
                : model.unknown
                  ? t("recUnknownTitle")
                  : facts.role === "viewer"
                    ? t("recViewerTitle")
                    : model.hasCampaigns
                      ? t("recHasCampaignsTitle")
                      : model.foundationReady
                        ? t("recReadyTitle")
                        : t("recRoleStartTitle")}
            </h3>
            <p>
              {nextCopy
                ? nextCopy.detail
                : model.unknown
                  ? t("recUnknownDetail")
                  : facts.role === "viewer"
                    ? t("recViewerDetail")
                    : model.foundationReady
                      ? t("recReadyDetail")
                      : t("recRoleStartDetail")}
            </p>
            {next && nextCopy ? (
              <Button asChild className={styles.control}>
                <Link
                  href={preparationHref(
                    next.key,
                    Boolean(facts.contacts?.active),
                  )}
                >
                  {nextCopy.action}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className={styles.control}>
                <Link href={preparationHref("campaigns")}>
                  {model.hasCampaigns
                    ? t("goReviewCampaigns")
                    : canCreate
                      ? t("goCreateCampaign")
                      : t("viewCampaigns")}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            )}
            {next && model.hasCampaigns && (
              <p className={styles.createdNote}>{t("createdNote")}</p>
            )}
            <div className={styles.recommendationLinks}>
              {next && model.hasCampaigns ? (
                <Link
                  className={styles.textLink}
                  href={preparationHref("campaigns")}
                >
                  {t("goReviewCampaigns")}
                </Link>
              ) : next && canCreate ? (
                <Link
                  className={styles.textLink}
                  href={preparationHref("campaigns")}
                >
                  {t("draftFirst")}
                </Link>
              ) : null}
              <Link href="/help#help-onboarding" className={styles.textLink}>
                <CircleHelp size={16} aria-hidden />
                {t("onboardingHelp")}
              </Link>
            </div>
            <p className={styles.note}>{t("safetyNote")}</p>
          </div>
          <ol className={styles.tasks} aria-label={t("tasksAriaLabel")}>
            {model.items.map((item) => {
              const copy = localizedItemCopy(item.key);
              return (
                <li
                  key={item.key}
                  data-preparation={item.key}
                  className={
                    item.status === "done" ? styles.taskDone : undefined
                  }
                >
                  <div className={styles.taskHeading}>
                    {item.canAct && item.status !== "unknown" ? (
                      <Link
                        href={preparationHref(
                          item.key,
                          Boolean(facts.contacts?.active),
                        )}
                        className={
                          item.status === "done"
                            ? `${styles.taskLink} ${styles.taskLinkDone}`
                            : styles.taskLink
                        }
                      >
                        {copy.title}
                      </Link>
                    ) : (
                      <strong>{copy.title}</strong>
                    )}
                    <span
                      className={
                        item.status === "done" ? styles.done : styles.state
                      }
                    >
                      {item.status === "done" && (
                        <Check size={14} aria-hidden />
                      )}
                      {item.status === "done"
                        ? t("statusDone")
                        : item.status === "unknown"
                          ? t("statusUnknown")
                          : t("statusTodo")}
                    </span>
                  </div>
                  {item.status !== "done" && <p>{copy.detail}</p>}
                  {!item.canAct && item.status !== "done" && (
                    <p className={styles.permission}>{copy.restriction}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        {!facts.signatureReady && (
          <div className={styles.signature}>
            <Link
              href={settingsSectionHref("profile")}
              className={styles.textLink}
            >
              {t("signatureRecommend")}
            </Link>
            <span>{t("signatureHint")}</span>
          </div>
        )}
      </div>
    </section>
  );
}
