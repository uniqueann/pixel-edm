"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import {
  preparationHref,
  preparationOverviewHref,
  type GuideTask,
} from "./links";
import styles from "./preparation.module.css";

const contexts: Record<
  GuideTask,
  {
    path: string;
    title: string;
    detail: string;
    next: GuideTask;
    nextLabel: string;
  }
> = {
  store: {
    path: "/settings",
    title: "准备发件身份",
    detail:
      "保存店铺信息与真实页脚地址后，继续连接主发信通道。我的署名是建议项。",
    next: "channels",
    nextLabel: "继续配置通道",
  },
  channels: {
    path: "/settings",
    title: "连接并验证主通道",
    detail:
      "先保存配置，再由管理员发送测试邮件。服务商接收不等于送达、进入收件箱或已读。",
    next: "contacts",
    nextLabel: "继续准备客户",
  },
  contacts: {
    path: "/contacts",
    title: "准备已订阅客户",
    detail:
      "核对导入结果与订阅授权。添加或导入成功不代表客户已订阅，也不代表必然进入活动名单。",
    next: "templates",
    nextLabel: "继续准备模板",
  },
  templates: {
    path: "/templates",
    title: "准备邮件内容",
    detail:
      "可编辑预置模板，预览核对后保存；活动中仍需核对本次变量和客户名单。",
    next: "campaigns",
    nextLabel: "继续创建活动",
  },
  campaigns: {
    path: "/campaigns",
    title: "创建并核对第一场活动",
    detail:
      "新建草稿 → 预览邮件与收件人 → 确认活动名单。正式发送仍由管理员按原流程明确确认。",
    next: "campaigns",
    nextLabel: "查看活动",
  },
};

export function GuideContext({
  role,
  canWrite,
}: {
  role: string;
  canWrite: boolean | null;
}) {
  const pathname = usePathname();
  const guide = useSearchParams().get("guide");
  if (!guide || !Object.hasOwn(contexts, guide)) return null;
  const task = guide as GuideTask;
  const context = contexts[task];
  if (pathname !== context.path && !pathname.startsWith(`${context.path}/`))
    return null;
  const requiresAdmin = task === "store" || task === "channels";
  return (
    <aside aria-label="首次使用引导" className={styles.context}>
      <div>
        <strong>{context.title}</strong>
        <p>
          {requiresAdmin && role !== "admin"
            ? "此项需管理员处理。你可以返回清单，查看当前角色可完成的准备。"
            : context.detail}
        </p>
      </div>
      <div className={styles.contextActions}>
        <Link href={preparationOverviewHref} className={styles.textLink}>
          返回准备清单
        </Link>
        {canWrite === true &&
          task !== "campaigns" &&
          (!requiresAdmin || role === "admin") && (
            <Link
              href={preparationHref(context.next)}
              className={styles.textLink}
            >
              {context.nextLabel}
              <ArrowRight size={16} aria-hidden />
            </Link>
          )}
      </div>
    </aside>
  );
}
