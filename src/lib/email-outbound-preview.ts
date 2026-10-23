/** 与真实发信 From 头一致：`别名 <地址>` */
export function formatOutboundFromLine(
  senderAlias: string | null | undefined,
  senderAddress: string | null | undefined,
) {
  const alias = (senderAlias ?? "").trim();
  const address = (senderAddress ?? "").trim();
  if (!alias && !address) return null;
  if (alias && address) return `${alias} <${address}>`;
  return alias || address;
}

/** 纯文本页脚块（不含真实退订 URL），与 appendUnsubscribeFooter 结构一致。 */
export function outboundFooterPlainText(input: {
  body: string;
  workspaceName: string;
  mailingAddress: string;
}) {
  const workspaceName = input.workspaceName.replace(/[\r\n]+/g, " ").trim();
  const mailingAddress = input.mailingAddress.replace(/[\r\n]+/g, " ").trim();
  const nameLine = workspaceName || "（店铺 / 工作区名称）";
  const addressLine = mailingAddress || "（未填写）";
  return `${input.body.trimEnd()}\n\n—\n${nameLine}\nContact address / 联系地址: ${addressLine}\nUnsubscribe / 退订: （发送时自动生成退订链接）`;
}
