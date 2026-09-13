import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { inspectUnsubscribe } from "@/features/unsubscribe/service";
import { UnsubscribeForm } from "@/features/unsubscribe/unsubscribe-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "邮件退订",
  robots: { index: false, follow: false, noarchive: true },
};

function Message({ reason }: { reason: "invalid" | "unavailable" }) {
  return reason === "invalid" ? (
    <>
      <h1>链接无效</h1>
      <p>这条退订链接无效或已被停用，请直接联系邮件发件人。</p>
      <p>
        This unsubscribe link is invalid or has been disabled. Please contact
        the sender.
      </p>
    </>
  ) : (
    <>
      <h1>暂时无法处理</h1>
      <p>服务暂时不可用，请稍后重新打开此页面。</p>
      <p>The service is temporarily unavailable. Please try again later.</p>
    </>
  );
}

export default async function Page({
  params,
}: PageProps<"/unsubscribe/[token]">) {
  const { token } = await params;
  const result = await inspectUnsubscribe(token);
  return (
    <main className="unsubscribe-wrap">
      <Brand />
      <section className="unsubscribe-card">
        {!result.ok ? (
          <Message reason={result.reason} />
        ) : result.data.status === "already_suppressed" ? (
          <div className="unsubscribe-result" role="status">
            <h1>已经退订</h1>
            <p>
              {result.data.masked_email} 已不会再收到来自{" "}
              {result.data.workspace_name} 的营销邮件。
            </p>
            <p>
              This address is already unsubscribed from marketing emails from{" "}
              {result.data.workspace_name}.
            </p>
          </div>
        ) : (
          <>
            <p className="eyebrow">邮件偏好 / EMAIL PREFERENCES</p>
            <h1>停止接收营销邮件？</h1>
            <p>
              即将为 {result.data.masked_email} 退订{" "}
              {result.data.workspace_name} 的后续营销邮件。
            </p>
            <p>
              Unsubscribe {result.data.masked_email} from future marketing
              emails from {result.data.workspace_name}?
            </p>
            <UnsubscribeForm token={token} />
          </>
        )}
      </section>
      <p className="auth-foot">
        卖家邮局 · Respecting every customer relationship
      </p>
    </main>
  );
}
