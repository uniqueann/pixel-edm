/** 邮局内帮助文档：与 UI 同步维护，面向管理员与运营。 */

import { roleHelpBullets } from "@/features/team/role-descriptions";

export type HelpSection = {
  id: string;
  title: string;
  intro?: string;
  steps?: string[];
  bullets?: string[];
  note?: string;
  warning?: string;
  links?: { label: string; href: string }[];
  targetRoleLabel?: string;
  icon?:
    | "sparkles"
    | "shield"
    | "rocket"
    | "mail"
    | "users"
    | "send"
    | "check-circle"
    | "clock";
  keywords?: string[];
};

export const helpSections: HelpSection[] = [
  {
    id: "overview",
    title: "产品能做什么",
    icon: "sparkles",
    targetRoleLabel: "全员通用",
    keywords: ["工作区", "订阅", "配额", "限制", "主通道", "套餐"],
    intro:
      "卖家邮局（EDM）以工作区为单位管理订阅客户、邮件模板和发信活动。正式邮件通过你自有的发信服务商账号发出；当前默认使用阿里云邮件推送（DirectMail）。更多发信通道（如 Amazon SES、SendGrid）正在适配中。",
    bullets: [
      "每个工作区同时只有一个主发信通道；进行中的活动会锁定创建时的通道，切换主通道不影响已在发送中的任务。",
      "退订与防打扰名单以工作区为准；外部平台的重新订阅不会自动恢复本系统的订阅状态。",
      "单次活动收件人上限视套餐档位而定；须先填写工作区联系地址才能开始正式发送。",
    ],
  },
  {
    id: "roles",
    title: "角色与权限",
    icon: "shield",
    targetRoleLabel: "全员通用",
    keywords: ["管理员", "运营", "查看者", "席位", "权限", "邀请"],
    bullets: roleHelpBullets,
  },
  {
    id: "onboarding",
    title: "首次使用（建议顺序）",
    icon: "rocket",
    targetRoleLabel: "管理员与运营",
    keywords: ["快速开始", "步骤", "流程", "初始化", "发信", "向导"],
    steps: [
      "登录后系统自动准备工作区。在总览查看准备清单与当前推荐操作，顺序可自由调整。",
      "管理员在设置中保存店铺信息和真实的邮件页脚实体地址，再连接主发信通道。保存配置不等于已验证；发送测试后应核对本次结果，结果未知时先核对，不要自动重试。",
      "管理员或运营在客户页导入或添加客户，并核对订阅授权。导入成功不等于已订阅，已订阅也不保证进入某场活动名单。",
      "在模板页选择预置模板或编辑自己的模板，预览核对后保存。已归档模板不能用于新活动。我的署名是建议项，不计入总览基础准备。",
      "到活动页新建草稿，再选择“预览”，核对邮件内容、变量与收件人，然后确认活动名单，锁定本次快照。创建草稿、编辑模板和浏览功能无需先完成全部准备。",
      "正式发送仍需管理员按原流程核对通道、发件身份、页脚地址、名单与额度，并输入活动名称确认。名单确认不等于正式发送；服务商接收不等于送达、进入收件箱或已读。",
    ],
    note: "总览状态来自当前工作区的业务数据；读取失败会显示待核对。收起后可从总览或此处重新查看；展开偏好只保存在当前浏览器，不会跨设备同步。查看者以只读进度为准，需要修改时联系管理员或运营。追踪、Webhook 与团队邀请按需要配置，不是首次创建草稿的前提。",
    links: [
      { label: "查看总览准备清单", href: "/dashboard#onboarding" },
      { label: "查看发信活动", href: "/campaigns?guide=campaigns" },
    ],
  },
  {
    id: "directmail-setup",
    title: "图解开通 DirectMail",
    icon: "mail",
    targetRoleLabel: "仅管理员",
    keywords: [
      "阿里云",
      "DNS",
      "域名",
      "SPF",
      "DKIM",
      "DMARC",
      "RAM",
      "AccessKey",
      "测试邮件",
      "Webhook",
      "EventBridge",
      "追踪",
    ],
  },
  {
    id: "directmail-channel",
    title: "DirectMail 通道注意事项",
    icon: "mail",
    targetRoleLabel: "仅管理员",
    keywords: [
      "发件人名称",
      "14个字符",
      "标签",
      "令牌",
      "密钥安全",
      "暂停发送",
    ],
    bullets: [
      "发件地址须属于已验证的发件域名；发件人名称长度上限 14 个字符（DirectMail 平台限制）。",
      "测试邮件只发往当前管理员的已验证登录邮箱，用于确认密钥与区域配置无误。",
      "开启行为追踪前须在阿里云控制台创建 DirectMail 标签，并在本系统填写相同标签名。",
      "Webhook 令牌只显示一次；更换后须在 EventBridge 规则中同步更新。断开通道会删除已保存的密钥。",
      "进行中的正式发送不能更换发件身份；需先暂停发送再更换密钥并重新验证。",
    ],
    warning:
      "请勿在聊天或邮件中分享 AccessKey、Webhook 明文令牌或完整客户名单导出文件。",
  },
  {
    id: "contacts",
    title: "客户、订阅与退订",
    icon: "users",
    targetRoleLabel: "管理员与运营",
    keywords: ["名单导入", "订阅状态", "防打扰", "退订链接", "投诉", "归档"],
    bullets: [
      "仅「已订阅」且未退订的客户会进入活动受众；已归档的客户不会收到新活动邮件。",
      "导入名单时勾选同意会留下授权凭据；已退订或投诉的地址不会因再次导入而自动恢复订阅。",
      "公开退订页与邮件内退订链接由本系统签发；收件人确认退订后将自动加入防打扰名单。",
    ],
  },
  {
    id: "campaigns",
    title: "活动与正式发送",
    icon: "send",
    targetRoleLabel: "管理员与运营",
    keywords: ["锁定名单", "正式发送", "暂停", "核对结果", "黑名单", "快照"],
    bullets: [
      "确认活动会锁定当时的模板与受众名单快照；之后模板或名单变动不会影响已确认的活动。",
      "开始正式发送须输入完整活动名称确认，使用当前主通道进行发送。",
      "发送过程中可随时暂停、继续或放弃剩余任务；结果未知的任务需管理员人工核对，不会自动重发。",
      "硬退信、投诉与退订会自动加入防打扰名单；普通临时投递失败不会计入长期黑名单。",
    ],
  },
  {
    id: "go-live",
    title: "上线前核对清单（约 30 分钟）",
    icon: "check-circle",
    targetRoleLabel: "仅管理员",
    keywords: ["上线检查", "验收", "测试活动", "小名单", "权限确认"],
    intro: "在对外大规模使用前，建议由管理员在工作区内逐项核对完成上线准备。",
    steps: [
      "设置 → 确认联系地址已填写；主通道状态显示为「已验证」。",
      "设置 → 点击「发送测试邮件」→ 在管理员邮箱中收到测试邮件。",
      "（若已开追踪）设置 → 保存追踪设置 → 创建小规模测试活动（≤10 人）→ 管理员正式发送 → 活动统计中正常出现打开/点击回执。",
      "（若已配 Webhook）在发信端投递一封触发回执的邮件 → 确认活动任务状态与统计正常更新。",
      "使用邮件中的退订链接完成一次退订测试 → 确认该客户不再出现在新活动受众中。",
      "团队 → 邀请一名运营或查看者成员 → 确认其权限符合预期（无法修改通道或触发正式发送）。",
    ],
  },
  {
    id: "sendgrid-future",
    title: "关于 SendGrid（即将支持）",
    icon: "clock",
    targetRoleLabel: "全员通用",
    keywords: ["SendGrid", "通道适配", "后续规划"],
    bullets: [
      "SendGrid 发信通道适配正在进行中，将在后续版本面向所有工作区开放。",
      "开放后支持使用自有的 SendGrid 账号与域名认证发件，并支持送达、打开与点击回执追踪。",
    ],
  },
  {
    id: "ses-future",
    title: "关于 Amazon SES（即将支持）",
    icon: "clock",
    targetRoleLabel: "全员通用",
    keywords: ["Amazon SES", "AWS", "SNS", "后续规划"],
    bullets: [
      "Amazon SES 发信通道适配正在进行中，将在后续版本开放创建通道。",
      "开放后支持通过自有 AWS 账号与 SES 发信身份发信，并支持 SNS 投递回执与行为追踪。",
    ],
  },
];

export const helpNav = helpSections.map(({ id, title }) => ({ id, title }));
