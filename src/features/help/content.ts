/** 邮局内帮助文档：与 UI 同步维护，面向管理员与运营。 */

export type HelpSection = {
  id: string;
  title: string;
  intro?: string;
  steps?: string[];
  bullets?: string[];
  note?: string;
  warning?: string;
};

export const helpSections: HelpSection[] = [
  {
    id: "overview",
    title: "产品能做什么",
    intro:
      "卖家邮局（EDM）以工作区为单位管理订阅客户、邮件模板和发信活动。正式邮件通过你自有的发信服务商账号发出；当前生产环境默认使用阿里云邮件推送（DirectMail）。界面中的「Amazon SES（尚未开放）」表示第二家 ESP 已登记但尚未对管理员开放创建通道。",
    bullets: [
      "每个工作区同时只有一个主发信通道；在途活动会冻结创建时的通道，切换主通道不影响已在发送中的任务。",
      "退订与抑制以工作区为准；厂商侧的「重新订阅」不会自动恢复本系统的订阅状态。",
      "单次正式活动最多 500 位收件人；须先填写工作区联系地址才能开始正式发送。",
    ],
  },
  {
    id: "roles",
    title: "角色与权限",
    bullets: [
      "管理员：工作区设置、发信通道、团队成员、正式发送、行为追踪与 Webhook、操作日志。",
      "运营：客户、模板、活动草稿、预览、确认、导出 CSV；不能改通道或开始正式发送。",
      "查看者：只读客户/模板/活动摘要；不能改设置、通道或发送。",
    ],
  },
  {
    id: "onboarding",
    title: "首次使用（建议顺序）",
    steps: [
      "登录后完成工作区初始化（个人工作区可邀请同事转为团队工作区）。",
      "设置 → 填写店铺/工作区名称与发件人联系地址 → 保存设置。",
      "设置 → 发信通道 → 添加「阿里云邮件推送」→ 填写发件域名/地址与 AccessKey → 安全保存。",
      "在同一通道卡片上发送测试邮件，直至状态变为「已验证」。",
      "（可选）配置打开/点击追踪与 DirectMail 回执 Webhook，便于活动统计。",
      "客户 → 导入或新增订阅客户；模板 → 编辑模板；活动 → 创建草稿 → 预览 → 确认。",
      "活动详情中由管理员开始正式发送，并在活动统计中查看送达与反馈。",
    ],
  },
  {
    id: "directmail-channel",
    title: "DirectMail 通道注意事项",
    bullets: [
      "发件地址须属于已验证的发件域名；发件人名称长度上限 14 个字符（DirectMail 限制）。",
      "测试信只发往当前登录且已验证邮箱的管理员账号，用于确认凭据与区域正确。",
      "开启行为追踪前须在阿里云控制台创建 DirectMail 标签，并在本系统填写相同标签名。",
      "Webhook 令牌只显示一次；轮换后须在 EventBridge 规则中更新。断开通道会删除凭据密文。",
      "进行中的正式发送不能更换发件身份；需先暂停发送再轮换凭据并重新验证。",
    ],
    warning:
      "请勿在聊天或邮件中分享 AccessKey、Webhook 明文令牌或完整客户名单导出文件。",
  },
  {
    id: "contacts",
    title: "客户、订阅与抑制",
    bullets: [
      "仅「已订阅」且未被抑制的客户会进入活动受众；归档客户不会收到新活动。",
      "导入时勾选同意会留下订阅证据；已退订或投诉的地址不会因再次导入而自动恢复订阅。",
      "公开退订页与邮件 List-Unsubscribe 由本系统签发；收件人确认后写入工作区抑制。",
    ],
  },
  {
    id: "campaigns",
    title: "活动与正式发送",
    bullets: [
      "确认活动会冻结当时模板与受众快照；之后模板或名单变化不会影响已确认活动。",
      "开始正式发送须输入完整活动名称确认，且使用当前主通道与当时通道版本。",
      "发送中可暂停、继续或放弃剩余任务；结果未知的任务需管理员人工核对，不会自动重发。",
      "硬退信、投诉与退订会写入抑制；软退信不会进入永久抑制列表。",
    ],
  },
  {
    id: "go-live",
    title: "仅 DirectMail 上线前核对（约 30 分钟）",
    intro:
      "在对外大规模使用前，建议由管理员在生产站点 https://edm.contentup.cc 逐项勾选（SES 相关步骤可跳过）。",
    steps: [
      "设置 → 确认联系地址非空；主通道为 DirectMail 且状态「已验证」。",
      "设置 → 发送测试邮件 → 在邮箱中收到测试信。",
      "（若已开追踪）设置 → 保存追踪设置 → 创建小活动（≤10 人）→ 管理员开始正式发送 → 活动统计中出现打开/点击或送达回执。",
      "（若已配 Webhook）在阿里云投递一封会触发回执的邮件 → 活动任务状态与统计更新。",
      "用活动邮件中的退订链接完成一次公开退订 → 该客户不再出现在新活动受众中。",
      "团队 → 邀请一名运营/查看者 → 确认其无法修改通道或开始正式发送。",
      "设置 → 确认仍显示「Amazon SES / SendGrid（尚未开放）」且无法添加对应通道（符合当前单 ESP 策略）。",
    ],
    note: "更完整的运维记录见仓库内 docs/edm-directmail-go-live-checklist.md 与 supabase/verification.md。",
  },
  {
    id: "sendgrid-future",
    title: "关于 SendGrid",
    bullets: [
      "SendGrid 已在注册表登记并完成适配器与 edm-sendgrid-events 部署；设置页可见「SendGrid（尚未开放）」，与 SES 相同，待 P9-4 人工验收通过后再启用注册表。",
      "开放后通道配置包括：API Key（加密存储）、数据中心 global/eu、Domain Authentication 发件域、Event Webhook 验签公钥（Signed Event Webhook）。",
      "Webhook 地址形如 …/functions/v1/edm-sendgrid-events?channel_id=…&token=…；须与 SendGrid 控制台 Signed Webhook 公钥一致。",
      "契约与事件映射见 docs/sendgrid-p9-0-contract.md。",
    ],
  },
  {
    id: "ses-future",
    title: "关于 Amazon SES",
    bullets: [
      "SES 适配器与回执函数已部署，但注册表默认关闭，避免未完成 AWS 配置时误创建通道。",
      "未来开放前需完成：域名/DKIM、Configuration Set、SNS 订阅 edm-ses-events、IAM 凭据及沙箱/生产额度申请。",
      "开放后可在设置中添加 SES 通道并切换主通道；新活动走新主通道，在途活动仍走原通道。",
    ],
  },
];

export const helpNav = helpSections.map(({ id, title }) => ({ id, title }));
