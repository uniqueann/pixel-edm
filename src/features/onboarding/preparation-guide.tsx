"use client";

import { useEffect, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  preparationModel,
  preparationPreferenceKey,
  type PreparationFacts,
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
    (preference !== "collapsed" && model.hasCampaigns !== true);
  useEffect(() => {
    const reveal = () => {
      if (location.hash === "#onboarding") savePreference(preferenceKey, true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [preferenceKey]);
  const next = model.recommended;
  const canCreate =
    facts.canWrite === true && facts.templates !== null && facts.templates > 0;
  const summary = model.unknown
    ? `${model.completed}/4 项基础准备已完成，部分信息待核对`
    : model.foundationReady
      ? "4/4 项基础准备已完成"
      : `${model.completed}/4 项基础准备已完成`;
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
            {model.hasCampaigns ? "工作区准备清单" : "准备你的第一场活动"}
          </h2>
          <p role="status" aria-live="polite">
            {pending ? "正在重新核对准备信息…" : summary}
          </p>
        </div>
        <Button
          variant="ghost"
          className={styles.control}
          aria-expanded={expanded}
          aria-controls="preparation-content"
          onClick={() => savePreference(preferenceKey, !expanded)}
        >
          {expanded ? "收起清单" : "查看准备清单"}
          {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        </Button>
      </div>
      {(model.unknown || otherDataUnavailable) && (
        <div className={styles.error}>
          <p>
            部分总览信息暂时无法读取，保留为待核对。你可以继续浏览现有功能。
          </p>
          <Button
            variant="outline"
            className={styles.control}
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
          >
            {pending ? "正在核对…" : "重试读取"}
          </Button>
        </div>
      )}
      <div id="preparation-content" hidden={!expanded}>
        <div className={styles.body}>
          <div className={styles.recommendation}>
            <h3>
              {next
                ? `建议先${next.action}`
                : model.unknown
                  ? "先核对当前准备情况"
                  : facts.role === "viewer"
                    ? "查看进度，与团队一起准备"
                    : model.hasCampaigns
                      ? "继续核对活动内容与名单"
                      : model.foundationReady
                        ? "基础准备已齐，创建第一场活动"
                        : "从你有权限的任务开始"}
            </h3>
            <p>
              {next
                ? next.detail
                : model.unknown
                  ? "无法确认的项目不会计为完成。重试后会按最新数据更新清单。"
                  : facts.role === "viewer"
                    ? "你可以查看客户、模板和活动；需要修改时，请联系管理员或运营。"
                    : model.foundationReady
                      ? "接下来到活动页预览邮件并确认名单。基础准备完成不代表某场活动必然可发送。"
                      : "店铺信息和发信通道由管理员处理。你仍可查看内容，或按已有权限准备草稿。"}
            </p>
            {next ? (
              <Button asChild className={styles.control}>
                <Link
                  href={preparationHref(
                    next.key,
                    Boolean(facts.contacts?.active),
                  )}
                >
                  {next.action}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className={styles.control}>
                <Link href={preparationHref("campaigns")}>
                  {model.hasCampaigns
                    ? "前往活动核对"
                    : canCreate
                      ? "前往创建活动"
                      : "查看发信活动"}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            )}
            {next && canCreate && (
              <Link
                className={styles.textLink}
                href={preparationHref("campaigns")}
              >
                也可以先创建活动草稿
              </Link>
            )}
            <p className={styles.note}>
              顺序可自由调整。创建草稿、编辑模板和浏览功能无需先完成全部准备；正式发送仍需管理员明确确认。
            </p>
            <Link href="/help#help-onboarding" className={styles.textLink}>
              <CircleHelp size={16} aria-hidden />
              首次使用说明
            </Link>
          </div>
          <ol className={styles.tasks} aria-label="基础准备项目">
            {model.items.map((item) => (
              <li key={item.key} data-preparation={item.key}>
                <div className={styles.taskHeading}>
                  {item.canAct && item.status !== "unknown" ? (
                    <Link
                      href={preparationHref(
                        item.key,
                        Boolean(facts.contacts?.active),
                      )}
                      className={styles.taskLink}
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <strong>{item.title}</strong>
                  )}
                  <span
                    className={
                      item.status === "done" ? styles.done : styles.state
                    }
                  >
                    {item.status === "done" && <Check size={14} aria-hidden />}
                    {item.status === "done"
                      ? "已完成"
                      : item.status === "unknown"
                        ? "待核对"
                        : "待完成"}
                  </span>
                </div>
                <p>{item.detail}</p>
                {!item.canAct && item.status !== "done" && (
                  <p className={styles.permission}>{item.restriction}</p>
                )}
              </li>
            ))}
          </ol>
        </div>
        <div className={styles.nextStage}>
          <div>
            <h3>
              {model.hasCampaigns
                ? "活动已创建，继续预览与确认名单"
                : "接下来：创建、预览并确认活动名单"}
            </h3>
            <p>
              在活动页选择草稿的“预览”，核对邮件内容、变量与收件人，再确认活动名单。确认名单会锁定快照，不会立即正式发送。
            </p>
          </div>
          <Button asChild variant="outline" className={styles.control}>
            <Link
              href={
                canCreate || model.hasCampaigns || facts.canWrite !== true
                  ? preparationHref("campaigns")
                  : preparationHref("templates")
              }
            >
              {model.hasCampaigns
                ? "前往活动核对"
                : canCreate
                  ? "前往创建活动"
                  : facts.canWrite === true
                    ? facts.templates === null
                      ? "查看模板状态"
                      : "先准备可用模板"
                    : "查看活动"}
            </Link>
          </Button>
        </div>
        {!facts.signatureReady && (
          <div className={styles.signature}>
            <Link
              href={settingsSectionHref("profile")}
              className={styles.textLink}
            >
              建议：完善我的署名
            </Link>
            <span>用于邮件落款，不计入基础准备。</span>
          </div>
        )}
      </div>
    </section>
  );
}
