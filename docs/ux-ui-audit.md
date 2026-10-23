# 卖家邮局（pixel-edm）UX/UI 审计报告

审计基线：`main` @ `7582b0d`（含 PR #49–#54）。方法：逐文件走查页面、布局、弹窗与 Server Action；对生产库 `content-up` 的 `edm` schema 做了少量**只读聚合查询**核实遗留问题（未改任何数据）。未做真机截图，结论均以代码和数据为据。

## 摘要

产品主干流程（导入 → 模板 → 活动草稿 → 预览 → 锁定名单 → 正式发送 → 统计）在代码上是完整的，防误发、退订合规和导入留痕做得比同类产品扎实。最大的问题不在视觉，而在**“用户以为会发出去的邮件”和“真正发出去的邮件”不一致**：生产中已有正式邮件页脚写着英文占位 `Sender's contact information`，另有 5 封英文营销邮件落款为“店主”。其次是**就绪状态判断失真**：手动添加的客户永远是“未确认”，UI 没有任何确认途径，但总览仍提示“基础配置已完成”。P1 主要集中在发送前置检查后置、预览缺页脚、支付失败路径和确认交互不一致。建议优先修 3 个 P0，再按文末拆分逐个小 PR 推进。

---

## P0 必须改

### P0-1 发件人联系地址仍是英文占位文本，且已进入真实邮件页脚

- **现象**：生产中 1 个团队版工作区的 `mailing_address` 为 `Sender's contact information`，该工作区 2 次正式发送的页脚都是 `Contact address / 联系地址: Sender's contact information`。表单只校验“非空、≤500 字”；字段名“发件人联系地址”容易被理解为“联系方式”，而不是实体邮寄地址。
- **影响**：CAN-SPAM 等法规要求的实体地址缺失，降低收件人信任，也增加被投诉的风险。总览“下一步”会把该工作区判定为“已填写”。
- **位置**：`src/components/settings-form.tsx`（标签与占位）、`src/lib/validation.ts`（`mailing_address`）、`supabase/functions/_shared/unsubscribe-token.ts` → `appendUnsubscribeFooter`、`src/app/(office)/[section]/page.tsx`（`setupItems`）
- **建议**：把字段改名为“邮件页脚实体地址”，并给出一个中英文示例。校验拒绝明显占位（如含 “contact information”、“sender”）、纯邮箱和过短文本，同时在表单下方实时预览页脚。存量数据另行通知该工作区管理员修正（本 PR 不改数据）。

### P0-2 手动添加的客户永远“未确认”，UI 没有确认途径；就绪判断因此误导

- **现象**：添加或编辑客户的弹窗提示“新添加客户初始状态为「未确认」，需经确认订阅后方可发信”，但弹窗和列表都没有任何确认入口。唯一出路是把同一邮箱重新导入并勾选“已明确同意”，界面上没有任何提示。总览的“客户数”和“添加第一批客户”把未确认客户也算进去，于是显示“基础配置已完成，可以创建发信活动”。活动受众又写着“全部客户”，直到预览才看到“可发送 0”。生产中 9 位客户里有 2 位未确认。
- **影响**：“添加客户 → 发活动”这条主路径走不通，用户会反复怀疑系统坏了。
- **位置**：`src/features/contacts/contacts.tsx`（合规提示、编辑弹窗），`src/app/(office)/[section]/page.tsx`（`setupItems`、`dashboard-success`），`src/features/campaigns/campaigns.tsx`（`campaign-audience` 选项“全部客户”），`supabase/migrations/20260910081147_edm_contact_imports.sql`（仅导入可把 `unconfirmed` 升为 `subscribed`）
- **建议**：在添加和编辑弹窗中提供“已获得同意”选项，要求填写来源与说明，复用导入的留痕字段；短期至少在提示中链接到“导入名单并声明同意”。总览改用“可发送（已订阅）客户数”判断是否就绪；受众文案改为“全部已订阅客户”。

### P0-3 `{{sender_name}}` 默认填“店主”，已随英文营销邮件发出；成员无法修改称呼

- **现象**：`members.display_name` 的默认值是“店主”，界面上没有任何编辑入口；生产中 3 位成员全部是“店主”。4 套起步模板（英文正文）均以 `{{sender_name}}` 落款，新建活动时它默认取成员称呼。生产中 11 个已完成的活动里，有 5 个的落款是“店主”。
- **影响**：海外客户收到 “Best, 店主”，显得不专业。团队成员列表、操作日志、头像也都显示“店主”，管理员无法分辨是谁做的操作。
- **位置**：`supabase/migrations/20260909072930_edm_foundation.sql`（`display_name` 默认值），`src/features/campaigns/campaigns.tsx` → `variablesFor`（`sender_name` 默认取 `memberName`），`src/features/templates/template-preview.tsx`，`src/components/app-shell.tsx`（身份栏）
- **建议**：在设置页或首次引导中提供“你的称呼 / 对外署名”。当署名仍为默认值时，不要自动预填 `sender_name`，并在活动预览中给出警告。数据库已授权 `update(display_name)`，只需补 UI。

---

## P1 强烈建议

### P1-1 正式发送的前置条件要在输入活动全名之后才报错；今日额度在活动页不可见

- **现象**：“正式发送”按钮只检查收件人上限。缺少联系地址、主通道未验证、今日额度不足时，要等用户在确认弹窗里输入完整活动名称并提交后，才由数据库报错。活动页也只展示单活动上限，看不到“今日已用 / 上限”。
- **位置**：`src/features/campaigns/campaigns.tsx`（“正式发送”按钮与确认弹窗），`supabase/migrations/20260920103000_p10_delivery_plan_limits.sql`（`edm_private.start_campaign_delivery` 中的额度、地址、通道检查）
- **建议**：确认弹窗顶部放一个只读检查清单（主通道 / 发件地址 / 页脚地址 / 今日剩余额度 / 收件人数），未通过的项直接禁用提交，并附上跳转链接。

### P1-2 预览不等于收件人实际看到的邮件；无法给自己发一封活动测试邮件

- **现象**：模板预览和活动预览都只渲染主题与正文，不包含系统追加的页脚（店铺名、联系地址、退订链接），也不显示发件人名称和发件地址。开启追踪后发出的是 HTML 版本，同样看不到。设置页的“发送测试邮件”是固定的连通性测试，无法用某个活动的内容测试。
- **位置**：`src/features/templates/template-preview.tsx`，`src/features/campaigns/campaigns.tsx`（预览弹窗样例区），`supabase/functions/_shared/unsubscribe-token.ts`（`appendUnsubscribeFooter` / `renderTrackedHtmlBody`）
- **建议**：先在两处预览中追加只读的页脚块和“发件人：别名 <地址>”，成本低，也能顺带暴露 P0-1 的问题。再单独做“发送此活动测试到我的邮箱”（需要后端支持）。

### P1-3 折扣码只对一种支付方式有效时，没有说明是哪一种；选错按钮会静默丢掉折扣

- **现象**：验证接口返回“……仅适用于其中一种支付方式”，但两个支付按钮外观不变；点击不适用的那个按钮时，隐藏字段里的折扣码为空，用户以原价进入结账页。
- **位置**：`src/features/workspace/billing-checkout-dialog.tsx`（`BillingProviderForm` 的 `discountCode`），`src/lib/billing/discount-availability.ts`（`summarizeDiscountChannels`）
- **建议**：在适用的按钮上标注“已应用折扣”，不适用的按钮注明“此方式不含折扣”，或在折扣有效时把它降为次要按钮。不涉及计费逻辑。

### P1-4 结账与取消续费的部分失败路径返回裸 JSON；toast 原样回显 URL 中的 `msg`

- **现象**：会话过期、非管理员、套餐已变化（例如两个标签页重复购买专业版）时，表单 POST 直接返回 `{"ok":false,"error":"…"}` 整页 JSON，用户进入死胡同。取消续费失败时，会把支付 SDK 的英文异常原文写进 `msg`。设置页 toast 直接渲染 `?msg=` 的内容，任何人都能构造一个在官方域名上显示任意文案的链接。
- **位置**：`src/app/api/creem/checkout/route.ts`、`src/app/api/dodo/checkout/route.ts`、`src/app/api/billing/cancel/route.ts`（`NextResponse.json` 分支与 catch），`src/features/workspace/checkout-toast.tsx`
- **建议**：所有失败路径统一用 `redirectCheckoutError`。toast 只根据 `reason` 映射内置中文文案，不再渲染 `msg`；展示后用 `router.replace` 清掉查询参数，避免刷新时重复弹出。

### P1-5 不可逆或高影响操作的确认方式不一致，有的过轻，有的反而被削弱

- **现象**：
  - “确认活动名单”不可撤回，在免费版还会占用每月 3 次额度，却只用 `window.confirm`，也没有提到额度。
  - “转移所有权”同样是 `window.confirm`，没有说明转移后自己的权限和账单归属。
  - 成员角色下拉选择后立即生效，可以一步把管理员降为查看者。
  - “放弃剩余任务”是破坏性操作，却提供“一键填入”活动名；更安全的“正式发送”反而没有这个按钮。
  - 全站共有 10 处 `window.confirm`。
- **位置**：`src/features/campaigns/campaigns.tsx`（`confirmPreview`、`delivery-confirmation-name` 旁的“一键填入”），`src/features/team/team-manager.tsx`（`MemberRow` 的 `changeRole` / `transfer`）
- **建议**：抽一个共用的 `ConfirmDialog`，标明后果并区分危险样式。确认名单时写明“将占用本月第 N/3 次”；角色降级需要二次确认；去掉放弃操作的“一键填入”。

### P1-6 编辑弹窗关闭即丢稿

- **现象**：模板（正文上限 2 万字）、活动、客户的编辑弹窗按 Esc、点遮罩或在移动端底部弹层误触都会直接关闭，没有“未保存更改”提示。
- **位置**：`src/components/ui/dialog.tsx`，`src/features/templates/templates.tsx`、`src/features/campaigns/campaigns.tsx`、`src/features/contacts/contacts.tsx` 的 `onOpenChange`
- **建议**：表单有改动时拦截 `onInteractOutside` 和 `onEscapeKeyDown`，并弹出确认；编辑类弹窗默认禁止点遮罩关闭。

### P1-7 角色说明和帮助文档与实际行为不符

- **现象**：
  - 邀请弹窗写“查看者：仅可查看业务数据、投递统计与操作记录”，但操作记录实际仅管理员可见。
  - 运营的描述漏掉了“确认活动名单 / 导出 CSV”。
  - 帮助文档写“活动详情中由管理员开始正式发送”，但产品没有活动详情页。
  - 帮助文档写“个人工作区可邀请同事转为团队工作区”，实际需要团队版。
- **位置**：`src/features/team/team-manager.tsx`（`team-invite-role` 下方说明），`src/app/(office)/logs/page.tsx`（`role !== "admin"` → 404），`src/components/app-shell.tsx`（日志导航仅管理员可见），`src/features/help/content.ts`（`roles` 与 `onboarding`）
- **建议**：把角色说明收敛成一份 `roleDescriptions` 常量，供邀请弹窗、帮助页和团队页共用，并按实际权限改写。

### P1-8 公开退订成功后，页面仍显示“停止接收营销邮件？”

- **现象**：提交后只有表单区域换成“退订完成”，上方的“停止接收营销邮件？ / 即将为 … 退订”还在，同一张卡片里出现两个 `h1`，问句和结果同时显示。
- **位置**：`src/app/unsubscribe/[token]/page.tsx`，`src/features/unsubscribe/unsubscribe-form.tsx`
- **建议**：把成功状态提升到卡片级，整卡替换为结果视图，只保留一个 `h1`。

### P1-9 深色模式下原生控件没有适配

- **现象**：全站没有声明 `color-scheme`。16 个原生 `<select>`，以及 checkbox、`datetime-local`（导入同意时间）和文件选择框，在深色模式下仍是浅色系统控件。Windows Chrome 的下拉选项会继承 `select` 的浅色前景色，可能出现浅底浅字。顶栏工作区切换器用的是 Radix `Select`，列表筛选和弹窗用的是原生 `select`，两者外观不一致。
- **位置**：`src/app/globals.css`（`:root` 与 `.dark`），`src/features/contacts/contacts.tsx`、`src/features/campaigns/campaigns.tsx`、`src/features/templates/templates.tsx`、`src/features/audit/activity-logs.tsx`、`src/features/team/team-manager.tsx`、`src/features/contacts/contact-importer.tsx`
- **建议**：先加 `:root{color-scheme:light}`、`.dark{color-scheme:dark}`（一行修复）。再把弹窗内的 `select` 统一成 `ui/select`，或者至少统一使用 `.list-filter` 样式。

### P1-10 登录 / 注册错误一律提示同一句；邮箱未验证时无法重发验证邮件

- **现象**：密码错误、邮箱未验证、请求过频都显示“操作未完成，请检查输入、邮箱验证状态或稍后重试”。注册后要求“在当前浏览器完成验证”，但页面上没有“重新发送验证邮件”的入口。回调失败时的提示 `<p role="alert">` 放在卡片外，没有样式。
- **位置**：`src/components/auth-form.tsx`（`catch` 分支），`src/app/(auth)/login/page.tsx`
- **建议**：按 Supabase 的错误码（`invalid_credentials`、`email_not_confirmed`、`over_request_rate_limit`）分别给出文案。邮箱未验证时提供 `auth.resend`，并把回调错误放进卡片内显示。

### P1-11 邀请页缺少统一布局；未登录时只给“登录”；登错账号后无法切换

- **现象**：`/invite/[token]` 不在 `(auth)` 布局里，没有品牌和主题切换，卡片直接贴在页面顶部。新受邀者多半还没有账号，页面却只有“登录并继续”。用其他账号登录后点接受，只会看到“请使用邀请邮箱的已验证账号登录”，页面上没有退出或切换账号的按钮。
- **位置**：`src/app/invite/[token]/page.tsx`，`src/features/team/invite-acceptance.tsx`
- **建议**：复用 `(auth)` 布局。同时提供“注册并接受”和“登录并接受”两个入口，都带上 `next`；出错时附上“退出并切换账号”。

### P1-12 套餐用量要到操作被拒才看得到

- **现象**：免费版限制 3 个自定义模板、每月确认 3 次活动、500 位有效客户，但这些用量只在设置页的一行小字里显示。用户写完模板或确认名单后，才由数据库报错（错误文案是中文，可读）。
- **位置**：`src/features/templates/templates.tsx`（“新建模板”“复制模板”），`src/features/campaigns/campaigns.tsx`（目前只显示单活动收件人上限），`src/features/workspace/billing-upgrade.tsx`
- **建议**：在“新建模板”“确认活动名单”“添加客户”附近显示“已用 2/3”；达到上限时禁用按钮，并附“查看套餐”链接。

### P1-13 服务商错误码原样展示给用户

- **现象**：测试发信失败时 toast 显示“测试发送失败：{error_code ?? "UNKNOWN"}”，最近测试和发送明细里也直接显示 `error_category / error_code` 的英文原值。
- **位置**：`src/features/channels/channel-detail.tsx`（`sendTest` 和最近测试块），`src/features/campaigns/campaigns.tsx`（发送明细中的 `task.error_category`）
- **建议**：为常见错误码（鉴权失败、发件地址未验证、配额不足、区域不符）建一张中文映射表，配上下一步操作；原始错误码折叠显示，供排障使用。

---

## P2 可改进

### P2-1 设置页信息层级

- **现象**：顺序是套餐 → 店铺信息 → 界面外观 → 发信通道。开通必需的“发信通道”排在最底，“界面外观”插在中间；页面没有锚点导航。总览“下一步”里的两项都跳到 `/settings` 顶部。
- **位置**：`src/app/(office)/[section]/page.tsx`（`section === "settings"`）
- **建议**：调整为店铺信息 → 发信通道 → 套餐 → 外观，加分段锚点；总览清单直接链接到对应锚点。

### P2-2 总览“最近活动”与 CTA

- **现象**：每一行都链接到 `/campaigns`，不会定位到具体活动；状态同时以文字和徽标重复显示。主按钮是“查看活动”，而不是“新建活动”。
- **位置**：`src/app/(office)/[section]/page.tsx`（`dashboard-campaign-row`、`dashboard-checklist` 下的按钮）
- **建议**：链接带上 `?q=` 或锚点定位到具体活动；去掉重复的状态文字。配置完成后，主 CTA 改为“新建活动”。

### P2-3 “个人工作区”徽标与“团队版”套餐并存

- **现象**：团队版工作区在发出第一条邀请之前，顶栏一直显示“个人工作区”。
- **位置**：`src/components/app-shell.tsx`（顶栏徽标）
- **建议**：顶栏改为展示套餐名，或用“团队版 · 1 人”这类组合文案。

### P2-4 移动端导航横向滚动没有提示

- **现象**：导航最多 8 个标签页，滚动条被隐藏，边缘也没有渐隐。375px 宽度下，“设置 / 帮助”被挤出屏幕。
- **位置**：`src/app/globals.css`（`.tabs`）
- **建议**：增加右侧渐隐遮罩，或在窄屏把低频项（日志 / 帮助）收进“更多”菜单。

### P2-5 空状态和提示的样式不统一

- **现象**：
  - 客户、模板、活动列表的空状态只是一行居中的 `<p>`，没有“导入名单 / 新建”按钮。
  - 日志页的套餐门控 `EmptyState` 没有升级按钮，总览上的同类提示却有。
  - “新建活动前，需要至少一套使用中的模板”这类引导文案套用了红色的 `.field-error`。
- **位置**：`src/features/contacts/contacts.tsx`、`src/features/templates/templates.tsx`、`src/features/campaigns/campaigns.tsx`（`!items.length` 分支），`src/app/(office)/logs/page.tsx`
- **建议**：统一使用 `EmptyState` 并带上主操作按钮；为引导性提示另设一个中性样式。

### P2-6 导入流程细节

- **现象**：
  - 结构校验失败时会把 Zod v3 的 `ZodError.message`（整段 JSON）显示在 toast 里。
  - 历史记录把 `failed` 状态显示为“处理中”。
  - 结果表的“说明”列一律红色，信息性说明也显示为红色。
  - 历史记录不显示时间。
- **位置**：`src/features/contacts/import-actions.ts`（`actionError`），`src/features/contacts/contact-importer.tsx`（历史状态三元表达式、结果表说明列）
- **建议**：遇到 `ZodError` 时取 `issues[0].message`；补上“失败”状态；只在 `result === "error"` 时使用红色；历史记录增加时间列。

### P2-7 手动退订弹窗与客户编辑弹窗

- **现象**：
  - 退订弹窗没有“取消”按钮，提交时也没有 try/catch，网络异常后 `busy` 一直为真，弹窗关不掉。
  - 编辑弹窗不显示订阅状态、同意来源和时间，运营看不出客户为什么无法发送。
- **位置**：`src/features/contacts/contacts.tsx`（退订表单 `onSubmit`、编辑弹窗）
- **建议**：补上取消按钮和 try/finally；在编辑弹窗顶部只读显示订阅状态和同意留痕（与 P0-2 一起做）。

### P2-8 关键信息字号过小，套餐摘要是一整句连写

- **现象**：大量关键信息用 12px 的 `.hint` 显示，包括额度、取消续费说明和席位超限警告（超限警告还是灰色）。角色标签只有 10px。套餐摘要把 5 项指标拼成一句话。
- **位置**：`src/app/globals.css`（`.hint`、`.role-pill`），`src/features/workspace/billing-upgrade.tsx`，`src/app/(office)/[section]/page.tsx`（`memberCapNote`）
- **建议**：用量改为“标签 + 进度条”的列表；警告类信息使用醒目的提示样式，正文不小于 13px。

### P2-9 零散的可访问性与表达问题

- **现象**：
  - 设置页主题切换的三个按钮缺少 `aria-pressed` 或 `radiogroup` 语义。
  - “下载 CSV”没有说明导出的是“收件人与个性化正文”；导出出错时会跳到一个纯文本错误页。
  - 结账弹窗的“订阅结账 / 其他支付方式”没有说明各自支持哪些支付方式（卡、PayPal、支付宝等）。
- **位置**：`src/components/theme-toggle.tsx`（`ThemeSegmented`），`src/features/campaigns/campaigns.tsx`（“下载 CSV”按钮），`src/app/(office)/campaigns/[id]/export/route.ts`，`src/features/workspace/billing-checkout-dialog.tsx`
- **建议**：补上选中语义；按钮改为“导出收件明细 CSV”，导出错误回到列表并弹 toast；在支付按钮的 hint 中列出支持的支付方式。

---

## 已知背景核对

- **PR #52 深色模式标签**：已修复（`contacts.tsx` 标签已带 `dark:` 变体）。
- **“Sender's contact information”**：代码中的占位已改为中文，但**生产数据仍未修正，且已进入邮件页脚**（见 P0-1）。
- **免费版结账文案**：与 `docs/p12-billing-product-copy.md` 一致，未发现新的错误。剩余问题在折扣提示（P1-3）和失败路径（P1-4）。
- **仅在 SES / Webhook 条件下出现的文案**：生产中 `amazon_ses` 和 `sendgrid` 均为 `enabled=false`，相关文案用户目前看不到，本次没有深审。DirectMail 的 Webhook 和追踪文案已覆盖。

## 做得好的地方

- **正式发送防误发**：需要输入活动全名、带幂等键；支持暂停、继续和放弃剩余任务；“结果未知”要求写 10 字以上的说明后人工核对，不会自动重发。
- **退订合规**：退订页中英双语；邮件带 `List-Unsubscribe` 一键退订头，退订令牌有签名；退订后进入防打扰名单，重新导入也不会恢复。
- **导入流程**：先预检，再确认，然后分批处理，可下载报告；同意来源和证据有留痕，未知列会给出提示。
- **列表交互一致**：筛选状态写在 URL 里，有已筛选标签和“清空筛选”，分页文案统一；版本冲突时给出中文提示。
- **基础可访问性**：有跳转到内容的链接，加载状态用 `aria-live`，弹窗关闭后焦点回到原位；移动端底部弹层会处理软键盘造成的可视区变化。
- **操作日志**：用 `activityLabel` 兜底，不会把内部 key 直接展示给用户。

## 建议的后续拆分

| 顺序 | PR 主题 | 覆盖 | 说明 |
|---|---|---|---|
| 1 | 页脚地址校验与预览，通知存量工作区修正 | P0-1 | 只改前端校验和设置页；数据修正走人工通知 |
| 2 | 客户订阅确认路径与总览就绪判断 | P0-2、P2-7 | 可能需要扩展 `save_contact` 的同意字段（`edm` 迁移） |
| 3 | 成员署名 / 称呼 | P0-3 | 纯 UI 加活动默认值逻辑，已有列级授权 |
| 4 | 发送前检查清单与用量可见 | P1-1、P1-12 | 复用 `get_workspace_delivery_plan` |
| 5 | 预览加页脚与发件人 | P1-2（第一步） | 纯前端；“测试发给自己”另开后端 PR |
| 6 | 结账失败路径与折扣按钮提示 | P1-3、P1-4 | 不改计费逻辑和默认值 |
| 7 | 共用确认弹窗与未保存拦截 | P1-5、P1-6 | 统一替换 `window.confirm` |
| 8 | 文案一致性（角色、帮助、退订成功页） | P1-7、P1-8 | 纯文案和结构 |
| 9 | 深色模式 `color-scheme` 与原生控件 | P1-9 | 一行 CSS 先止血 |
| 10 | 认证错误细分与邀请页 | P1-10、P1-11 | 涉及 `(auth)` 布局复用 |
| 11 | 服务商错误码中文映射 | P1-13 | — |
| 12 | P2 打磨批次 | P2-1 至 P2-6、P2-8、P2-9 | 可合并为 1 到 2 个 PR |

涉及设置、导航、套餐或新增 `edm.*` RPC 的 PR，请同步更新 `tests/auth-fixture.mjs` 和 `tests/e2e/*.spec.ts`（参见 `AGENTS.md`）。
