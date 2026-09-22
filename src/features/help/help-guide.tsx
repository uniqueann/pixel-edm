import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { helpNav, helpSections } from "./content";
import { DirectMailSetupGuide } from "./directmail-setup-guide";

export function HelpGuide({ role }: { role: string }) {
  return (
    <div className="help-guide space-y-6">
      <Card className="border-dashed">
        <CardContent className="space-y-2 pt-6">
          <p className="m-0 text-sm">
            本文档说明当前版本的使用步骤与限制，随产品迭代更新。你的角色：
            <Badge variant="secondary" className="ml-1 align-middle">
              {role === "admin"
                ? "管理员"
                : role === "editor"
                  ? "运营"
                  : "查看者"}
            </Badge>
          </p>
          <p className="hint m-0">
            配置发信通道、Webhook
            与正式发送仅管理员可操作；运营与查看者请以对应章节为准。
          </p>
          <p className="hint m-0">
            通道与追踪问题请先查看{" "}
            <Link href="/settings" className="underline underline-offset-2">
              设置 → 发信通道
            </Link>
            。
          </p>
        </CardContent>
      </Card>

      <nav aria-label="帮助目录" className="flex flex-wrap gap-2">
        {helpNav.map((item) => (
          <a
            key={item.id}
            href={`#help-${item.id}`}
            className="rounded-full border bg-card px-3 py-1 text-sm hover:bg-muted"
          >
            {item.title}
          </a>
        ))}
      </nav>

      {helpSections.map((section) =>
        section.id === "directmail-setup" ? (
          <DirectMailSetupGuide key={section.id} />
        ) : (
          <Card
            key={section.id}
            id={`help-${section.id}`}
            className="scroll-mt-24"
          >
            <CardContent className="space-y-3 pt-6">
              <h2 className="m-0">{section.title}</h2>
              {section.intro ? <p className="m-0">{section.intro}</p> : null}
              {section.steps?.length ? (
                <ol className="m-0 list-decimal space-y-2 pl-5">
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
              {section.bullets?.length ? (
                <ul className="m-0 list-disc space-y-2 pl-5">
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {section.note ? (
                <p className="hint m-0 rounded-lg bg-muted px-3 py-2">
                  {section.note}
                </p>
              ) : null}
              {section.warning ? (
                <p
                  role="alert"
                  className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  {section.warning}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ),
      )}
    </div>
  );
}
