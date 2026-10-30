import type {
  DeliveryChannel,
  DeliveryTestStatus,
  DeliveryTestAttempt,
} from "./model";

/** 只解释接口已有状态，不建立独立的通道业务状态。 */
export function channelSetupCopy(
  channel: Pick<DeliveryChannel, "status" | "credential_configured"> | null,
  testStatus?: DeliveryTestStatus,
) {
  if (!channel)
    return {
      title: "尚未连接",
      detail: "准备发件身份、服务区域与访问凭据后连接通道。",
    };
  if (channel.status === "disconnected")
    return {
      title: "通道已断开",
      detail: "已保存的发信凭据已删除。重新连接并测试后，才能继续使用此通道。",
    };
  if (channel.status === "incomplete" || !channel.credential_configured)
    return {
      title: "配置尚未完成",
      detail: "请更新发件身份与完整凭据，再发送测试邮件验证。",
    };
  if (isTestPending(testStatus))
    return {
      title: "本次测试尚未完成",
      detail:
        "请刷新本次测试结果；完成后再更新配置或进行其他操作，避免重复提交。",
    };
  if (testStatus === "unknown")
    return {
      title: "先核对本次测试结果",
      detail:
        "上次测试的发送结果未知，邮件可能已发出。请先核对邮箱与服务商控制台，再决定是否重新测试。",
    };
  if (channel.status === "verified")
    return {
      title: "通道已通过测试验证",
      detail:
        "服务商已接收测试邮件。请到管理员邮箱核对，必要时检查垃圾邮件与服务商日志。",
    };
  if (channel.status === "error")
    return {
      title: "通道需要检查",
      detail: "请查看最近测试的原因与恢复建议，修正配置后再测试。",
    };
  return {
    title: "配置已保存，下一步发送测试",
    detail:
      "保存配置尚未验证连通性。发送一封测试邮件，核对凭据、区域与发件身份。",
  };
}

export const testResultCopy: Record<
  DeliveryTestStatus,
  { title: string; detail: string }
> = {
  pending: {
    title: "等待发送",
    detail:
      "系统已记录本次测试，尚未返回服务商结果。可手动刷新结果，请勿重复发起。",
  },
  processing: {
    title: "正在处理",
    detail: "本次测试正在处理。可手动刷新结果；关闭页面不会撤回已提交的请求。",
  },
  accepted: {
    title: "服务商已接收",
    detail:
      "已接收仅表示服务商接受发送请求，不代表收件人已收到、进入收件箱或已阅读。",
  },
  failed: {
    title: "发送失败",
    detail: "请按下方建议核对配置，处理原因后再发送测试。",
  },
  unknown: {
    title: "发送结果未知",
    detail:
      "邮件可能已发出。请先核对管理员邮箱与服务商控制台，再决定是否重新测试，以免重复发送。",
  },
};

export function isTestPending(status: DeliveryTestStatus | undefined) {
  return status === "pending" || status === "processing";
}

/** 旧刷新不能覆盖新一轮测试，也不能把同一请求的终态退回处理中。 */
export function latestTestSnapshot(
  current: DeliveryTestAttempt | null,
  incoming: DeliveryTestAttempt | null,
) {
  if (!incoming) return current;
  if (!current) return incoming;
  if (
    new Date(current.created_at).getTime() >
    new Date(incoming.created_at).getTime()
  )
    return current;
  if (
    current.id === incoming.id &&
    ((!isTestPending(current.status) && isTestPending(incoming.status)) ||
      (current.status === "processing" && incoming.status === "pending"))
  )
    return current;
  return incoming;
}
