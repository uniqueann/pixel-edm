import Link from "next/link";
import { formatOutboundFromLine } from "@/lib/email-outbound-preview";
import { mailingAddressProblem } from "@/lib/mailing-address";
import { cn } from "@/lib/utils";

export {
  formatOutboundFromLine,
  outboundFooterPlainText,
} from "@/lib/email-outbound-preview";

export function EmailOutboundFromPreview({
  senderAlias,
  senderAddress,
  className,
}: {
  senderAlias: string | null | undefined;
  senderAddress: string | null | undefined;
  className?: string;
}) {
  const fromLine = formatOutboundFromLine(senderAlias, senderAddress);
  const missingAlias = !(senderAlias ?? "").trim();
  const missingAddress = !(senderAddress ?? "").trim();

  return (
    <div className={cn("text-sm", className)}>
      <p className="mb-1 text-xs text-muted-foreground">
        发件人（收件人邮箱客户端显示的 From）
      </p>
      {fromLine ? (
        <p className="break-all font-medium">{fromLine}</p>
      ) : (
        <p className="text-destructive" role="note">
          {missingAlias && missingAddress
            ? "尚未配置主发信通道的发件人名称与发件地址。"
            : missingAddress
              ? "主通道尚未填写发件地址。"
              : "主通道尚未填写发件人显示名称。"}
          <Link href="/settings" className="ml-1 underline underline-offset-2">
            前往发信通道
          </Link>
        </p>
      )}
    </div>
  );
}

export function EmailOutboundFooterPreview({
  workspaceName,
  mailingAddress,
  className,
}: {
  workspaceName: string;
  mailingAddress: string;
  className?: string;
}) {
  const name = workspaceName.trim() || "（店铺 / 工作区名称）";
  const address = mailingAddress.trim();
  const addressProblem = mailingAddressProblem(mailingAddress);
  const addressDisplay = address || "（未填写）";

  return (
    <div
      className={cn(
        "mt-4 border-t pt-4 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
      data-testid="email-outbound-footer-preview"
    >
      <p className="mb-2 text-xs font-medium text-foreground">
        系统追加的邮件页脚
      </p>
      <div className="space-y-1">
        <p className="break-words">{name}</p>
        <p className="break-words">
          Contact address / 联系地址:{" "}
          <span className={addressProblem ? "text-destructive" : ""}>
            {addressDisplay}
          </span>
        </p>
        {addressProblem && (
          <p className="text-destructive" role="note">
            {addressProblem}
            <Link
              href="/settings"
              className="ml-1 underline underline-offset-2"
            >
              前往店铺信息
            </Link>
          </p>
        )}
        <p>
          <span
            className="cursor-default text-primary underline underline-offset-2"
            aria-disabled="true"
            title="预览占位，发送时会替换为真实退订链接"
          >
            Unsubscribe / 退订
          </span>
        </p>
      </div>
    </div>
  );
}
