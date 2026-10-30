export type PreparationTask = "store" | "channels" | "contacts" | "templates";
export type PreparationStatus = "done" | "todo" | "unknown";

/** 只控制引导入口展示，实际写入仍由既有 Server Action 与数据库鉴权。 */
export function preparationWritePermission(
  role: string,
  plan: { active_members: number; max_active_members: number } | null,
): boolean | null {
  if (role === "admin") return true;
  if (role === "viewer") return false;
  return plan === null ? null : plan.active_members <= plan.max_active_members;
}

/** 仅描述当前查询事实；不记录看过、点击过或独立的业务完成状态。 */
export type PreparationFacts = {
  role: string;
  canWrite: boolean | null;
  storeReady: boolean;
  channel: { ready: boolean; detail: string } | null;
  contacts: { active: number; subscribed: number } | null;
  templates: number | null;
  campaigns: number | null;
  signatureReady: boolean;
};

export type PreparationItem = {
  key: PreparationTask;
  title: string;
  status: PreparationStatus;
  detail: string;
  canAct: boolean;
  action: string;
  restriction?: string;
};

export function preparationModel(facts: PreparationFacts) {
  const canAdmin = facts.role === "admin";
  const restriction =
    facts.role === "viewer"
      ? "当前为查看者，请联系管理员或运营完成此项。"
      : facts.canWrite === null
        ? "操作权限待核对，请重试读取套餐信息。"
        : "工作区席位超出套餐，运营操作已暂停，请联系管理员处理。";
  const items: PreparationItem[] = [
    {
      key: "store",
      title: "补充邮件页脚实体地址",
      status: facts.storeReady ? "done" : "todo",
      detail: facts.storeReady
        ? "已保存页脚联系地址，正式邮件会展示此地址。"
        : "填写真实的街道门牌地址，方便收件人识别并联系你的店铺。",
      canAct: canAdmin,
      action: "填写店铺信息",
      restriction: canAdmin
        ? undefined
        : "店铺信息由管理员统一维护，请联系管理员补充。",
    },
    {
      key: "channels",
      title: "连接并验证发信通道",
      status:
        facts.channel === null
          ? "unknown"
          : facts.channel.ready
            ? "done"
            : "todo",
      detail: facts.channel?.detail ?? "暂时无法读取主通道，当前配置待核对。",
      canAct: canAdmin,
      action: "配置主发信通道",
      restriction: canAdmin
        ? undefined
        : "密钥和测试邮件仅管理员可操作，请联系管理员验证主通道。",
    },
    {
      key: "contacts",
      title: "准备已订阅客户",
      status:
        facts.contacts === null
          ? "unknown"
          : facts.contacts.subscribed > 0
            ? "done"
            : "todo",
      detail:
        facts.contacts === null
          ? "暂时无法读取客户与订阅状态，请重试核对。"
          : facts.contacts.subscribed > 0
            ? `已有 ${facts.contacts.subscribed} 位未归档的已订阅客户；活动仍会排除退订与防打扰地址。`
            : facts.contacts.active > 0
              ? `已有 ${facts.contacts.active} 位客户，但没有已订阅客户。请核对授权，添加客户不等于订阅。`
              : "导入或添加获得订阅同意的客户；只有符合活动条件的客户才会进入名单。",
      canAct: facts.canWrite === true,
      action: facts.contacts?.active ? "核对客户订阅" : "导入第一批客户",
      restriction: facts.canWrite === true ? undefined : restriction,
    },
    {
      key: "templates",
      title: "准备可用模板",
      status:
        facts.templates === null
          ? "unknown"
          : facts.templates > 0
            ? "done"
            : "todo",
      detail:
        facts.templates === null
          ? "暂时无法读取模板，当前可用数量待核对。"
          : facts.templates > 0
            ? `已有 ${facts.templates} 套未归档模板，可从预置模板开始。请按本次活动核对内容与变量。`
            : "创建模板或恢复已归档模板，保存后可用于活动草稿。",
      canAct: facts.canWrite === true,
      action: facts.templates ? "查看与编辑模板" : "准备第一套模板",
      restriction: facts.canWrite === true ? undefined : restriction,
    },
  ];
  const completed = items.filter((item) => item.status === "done").length;
  const unknown =
    items.some((item) => item.status === "unknown") ||
    facts.campaigns === null ||
    facts.canWrite === null;
  return {
    items,
    completed,
    unknown,
    foundationReady: completed === items.length,
    hasCampaigns: facts.campaigns === null ? null : facts.campaigns > 0,
    recommended:
      items.find((item) => item.status === "todo" && item.canAct) ?? null,
  };
}

/** 本地仅保存展开偏好；账号、工作区、角色及展示版本分别隔离。 */
export function preparationPreferenceKey(
  userId: string,
  workspaceId: string,
  role: string,
) {
  return `pixel-edm:onboarding:v1:${userId}:${workspaceId}:${role}`;
}
