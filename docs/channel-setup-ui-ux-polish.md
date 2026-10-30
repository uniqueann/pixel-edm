# 发信通道配置与首次测试邮件：UI/UX 打磨验收

日期：2026-10-30。基线：`origin/main` 的 `f9ed26f55ff7c135f2a108afc04900ca5c732f02`。分支：`design/channel-setup-polish`。

范围为“总览准备清单 → `/settings#settings-channels` → 准备身份、区域与凭据 → 保存 → 首次测试 → 核对结果与恢复 → 继续准备或进入活动”。保持现有暖灰、深蓝、Fraunces / IBM Plex、主题变量及共享组件。按 critique → harden → clarify → layout/adapt → polish 推进；按本次明确授权直接处理常规取舍，未另设阶段确认。

## 一、评审依据与优先级

方法：双独立评审，A 为 `/root/assessment_a` 的设计与布局评审，B 为 `/root/assessment_b` 的检测与浏览器能力核对。A 完成后才读取 B 的发现。A 读取源码并目检基线截图；B 的默认与 layout 检测均返回 `[]`。检测器空结果不能证明流程、请求恢复或视觉质量已正确。

项目没有 PRODUCT.md / DESIGN.md，Impeccable context 明确允许基于现有实现做局部打磨；未额外创建产品、品牌文档或修改已有评审记录。目标 slug 为 `src-features-channels-channel-settings-tsx`，无忽略清单。基线评审归档在本地 `.impeccable/critique/`；本文件保留供 PR 审阅的问题与处理依据。

基线 Nielsen 评分 **24/40**，全部十项适用。没有把改后主观评分包装成测试结果。

| 维度 | 基线分数（0–4） | 主要依据 |
| --- | ---: | --- |
| 系统状态可见 | 2 | 测试与结果在长详情末尾；保存后的接续不明确 |
| 符合真实任务 | 2 | 区域、身份、凭据与回执术语缺少任务层级 |
| 用户控制 | 3 | 有关闭出口，但长表单没有未保存保护 |
| 一致性 | 3 | 共享组件一致，“已连接”与“待验证”容易混淆 |
| 错误预防 | 3 | 有既有字段、版本校验，缺少前置准备与完整互斥 |
| 识别优于回忆 | 2 | 需要在外部控制台、表单和详情间自行记住下一步 |
| 效率 | 2 | 低频设置占用首次验证路径 |
| 精简与层级 | 2 | 能力、身份、回执、追踪和首次测试同等展开 |
| 错误恢复 | 3 | 已有中文服务商指引，但就近反馈与错误关联不完整 |
| 帮助 | 2 | 有 DirectMail 教程，字段就近解释不足 |

独立评审的认知负担清单有 6/8 项缺口，主要是首次任务被维护内容打断、需要记忆跨页面步骤、缺少渐进展开。保留了明确状态、真实默认值、凭据留空保留及中文服务商错误指引等优势。首次使用者容易把“保存”当作验证完成；手机用户容易因关闭或切换上下文丢失输入；键盘用户需要错误关联与明确焦点恢复。这些比新增装饰或品牌重设计更影响任务完成。

| 优先级 | 问题与依据 | 处理结果 |
| --- | --- | --- |
| P1 | `channel-detail.tsx` 先展示能力、身份、Webhook 与追踪，最后才是次级测试按钮；390px 基线首屏看不到测试 | 当前状态、主要操作和最近结果提前；待验证时测试为主动作；维护内容按需展开 |
| P1 | `channel-form-dialog.tsx` 直接关闭；不同请求各自维护 loading，缺少共同互斥与迟到响应保护 | 复用未保存确认；关闭、Esc、主动跳转、刷新保护；同列表编辑与请求共用前端互斥锁，卸载后忽略回调 |
| P1 | 空通道时权限与加密不可用提示只存在于不会渲染的详情组件中 | 列表级显示只读原因、部署管理员恢复提示与禁用入口 |
| P2 | 表单职责混杂；服务商能力对 requires 字段也写“支持/不支持” | 身份、区域、凭据分组；回执字段标明后续用途；区分正文署名、邮箱发件人及页脚地址；requires 使用“需要/无需” |
| P2 | 验证成功后停留在维护页，缺少与原准备清单的连接 | 主通道验证后就近给出地址、署名、返回总览与创建活动入口；未宣称所有准备均已完成 |

独立收尾复核另外发现并处理：等待、处理中、未知结果的顶部文案仍催促发送；旧刷新可能覆盖较新快照；固定操作栏遮住输入；部分边界截图尚未稳定或未呈现目标数据。均在最终验证前修正。长内容夹具改用合法域名，场景控制请求必须成功，截图前确认数据、主题、状态和目标位置。

## 二、最终交互与兼容边界

### 配置与离开保护

- 空态列出发件身份、所在区域、专用凭据三类准备，继续复用已有 DirectMail 图文教程。
- 单个表单按发件身份、区域、访问凭据分组。区域默认值明确要求与控制台核对；回执公钥和 SNS ARN 仍为后续回执配置项，保留原字段与多行公钥输入能力。
- 更新时凭据留空保持现有凭据。断开或缺少凭据后重新连接，前端要求重新填写完整凭据，服务端既有校验仍是最终约束。
- 取消、关闭、Esc 会确认放弃；遮罩不关闭；“继续编辑”返回原字段。跳往正文署名使用同一离开确认。刷新及整页离开使用浏览器原生 beforeunload 提示；未将凭据写入 localStorage、sessionStorage、URL 或新增日志。
- 保存失败在弹窗内持久展示、播报并聚焦错误，当前输入留在页面内存中，可核对后重试。放弃或成功关闭后清除该轮表单；未新增浏览器草稿存储。
- 保存期间禁用字段、取消与重复提交，Esc 不关闭。列表内保存、测试、主通道切换、断开、回执和追踪写入互斥；进入编辑也占用同一个锁。

### 测试与结果

| 接口事实 | 页面解释与操作 |
| --- | --- |
| 保存成功 / configured | 配置已保存，仍需测试，不称为已验证 |
| pending | 等待发送；刷新本次结果，禁止重复测试与冲突写入 |
| processing | 正在处理；手动只读刷新，不显示发送失败 toast |
| accepted | 服务商已接收；不表示收件人已收到、进入收件箱或已阅读 |
| failed | 复用现有中文服务商原因、恢复建议与折叠技术详情 |
| unknown | 先核对邮箱与控制台；只读刷新可用；重新测试需再次明确确认可能重复发送 |
| 请求响应中断 | 当前页保留同一幂等键，用户手动恢复；说明上次若未提交，服务端仍可能发送一封 |
| verified 但凭据缺失 | 展示配置未完成，不显示可用的“已验证”状态；总览仍保留连接验证任务 |
| disconnected | 说明凭据已删除，保留重新连接入口；历史测试不替代当前验证 |

当前页恢复使用现有 `sendDeliveryChannelTest` 与原幂等键；刷新结果复用 `getDeliveryTestSummary`、`getDeliveryChannel`，不触发发信。重新打开页面通过已有测试摘要查看记录，不新增自动重试或另一套恢复状态机。仅存在于内存的未完成请求标识不会跨刷新持久化；已落库记录仍可读取。

页面内存按账号、工作区与角色隔离。互斥令牌在请求前同步取得；组件卸载后，迟到响应不能写入新工作区或发出旧工作区 toast。通道快照比较现有 `version`；测试快照依据创建时间和既有不可逆结果避免旧刷新覆盖新结果。编辑期间不因刷新重置当前输入。

### 下一步与业务边界

主通道的可用展示统一依据 `is_primary + status=verified + credential_configured`，与既有正式发送准备检查保持一致。地址、署名提示复用原有判断及设置锚点；继续前往总览核对客户、模板与其他准备，或进入活动页。没有因单通道通过测试而新增正式发送权限。

未修改通道保存、轮换、断开、主通道切换、测试 action / RPC、服务商适配器、数据库结构或迁移；未修改权限、版本锁、加密和脱敏、测试幂等、套餐、额度、正式发送前置条件及服务商开放状态。Supabase 生产资源与共享配置未变更。

共享改动保持默认行为：ConfirmDialog 与未保存 hook 只增加可选的焦点返回、取消文案和样式参数；Dialog 只对显式标记的固定操作栏增加焦点避让，其余弹窗沿用原边界。完整 E2E 同时覆盖其他编辑、套餐与设置弹窗。

## 三、视觉对照与可访问性

所有图片均由本地仓库 Playwright、Chrome 通道、隔离认证及 PGlite 测试数据生成。基线在首次产品 UI 修改前采集：空态、连接表单、已保存待验证、服务商接收，分别为 320 / 390 / 820 / 1440px、明暗主题，共 32 张；修改后使用相同账号、数据及场景重拍 32 张。PR 纳入以下代表性原始 PNG，完整测量及图片哈希见 [证据清单](images/channel-setup/evidence.json)。

| 场景 | 修改前 | 修改后 | 核对重点 |
| --- | --- | --- | --- |
| 空态，1440px 浅色 | [改前](images/channel-setup/before-empty-1440-light.png) | [改后](images/channel-setup/after-empty-1440-light.png) | 需要准备什么、职责区分 |
| 连接表单，390px 浅色 | [改前](images/channel-setup/before-form-390-light.png) | [改后](images/channel-setup/after-form-390-light.png) | 任务分组、帮助、固定操作栏 |
| 待验证，390px 浅色 | [改前](images/channel-setup/before-configured-390-light.png) | [改后](images/channel-setup/after-configured-390-light.png) | 首次测试从长维护内容后移到前方 |
| 待验证，820px 深色 | [改前](images/channel-setup/before-configured-820-dark.png) | [改后](images/channel-setup/after-configured-820-dark.png) | 中间宽度与明暗 token |
| 已接收，1440px 深色 | [改前](images/channel-setup/before-accepted-1440-dark.png) | [改后](images/channel-setup/after-accepted-1440-dark.png) | 持久结果、准确含义、下一步 |
| 已接收，320px 深色 | [改前](images/channel-setup/before-accepted-320-dark.png) | [改后](images/channel-setup/after-accepted-320-dark.png) | 最窄视口的阅读与操作顺序 |

额外证据：[长发件身份](images/channel-setup/after-long-320-dark.png)、[结果未知](images/channel-setup/after-unknown-390-dark.png)、[已断开](images/channel-setup/after-disconnected-390-dark.png)、[模拟键盘](images/channel-setup/after-keyboard-390-light.png)、[820×360 小高度](images/channel-setup/after-short-height-820-light.png)、[CSS 200% 缩放](images/channel-setup/after-zoom-1440-dark.png)。

检查项包含：可见控件至少 44×44px、字段与错误的 aria 关联、首个无效字段聚焦、保存错误聚焦、关闭后的触发器焦点、动态结果播报、长域名与邮箱换行、主要操作可见性、软键盘收缩时字段与操作栏不重叠。字体、颜色、字号层级和焦点样式沿用原系统。

最终 32 个常规场景与 8 个长内容场景均无横向溢出；常规可见控件最小 44×44px；抽样正文、说明与占位文本的最小计算对比度为 5.14:1；浏览器 pageerror 为 0。已人工目检桌面、手机、明暗、长内容、未知、断开、模拟键盘与缩放代表图；原始矩阵随证据清单提交。

## 四、回归命令与验收

常规回归复用并扩展 `channels.spec.ts`、`dialog-keyboard.spec.ts`，同时运行 `office.spec.ts`。新增 `channel-setup.spec.ts` 覆盖失败、互斥、恢复、只读及准备清单衔接；`channel-setup-visual.spec.ts` 做场景与视觉矩阵；单测验证展示事实和旧快照保护。

```sh
npx playwright test tests/e2e/channel-setup.spec.ts tests/e2e/channels.spec.ts tests/e2e/office.spec.ts tests/e2e/dialog-keyboard.spec.ts
EDM_CHANNEL_NO_KEY=1 npx playwright test --config tests/channel-no-key.config.ts
EDM_CHANNEL_VISUAL_PHASE=after npm run ci:verify
npm run setup:hooks
```

无密钥用例使用独立配置启动同一本地应用，清空测试进程的 EDM 凭据加密密钥，已单独验证。它在默认 E2E 环境中按条件跳过；不能将默认回归的该项跳过误报为通过。

| 验收项 | 证据 |
| --- | --- |
| 新建与更新字段校验、失败保留、重试成功 | 真实表单与现有 server action；夹具只在本地 RPC 返回一次失败 |
| 取消、关闭、Esc、遮罩、跳转、刷新与焦点恢复 | 实际键盘、鼠标、beforeunload 事件和 DOM 焦点断言 |
| 保存与测试期间冲突操作 | 延迟夹具、跨通道禁用断言、请求数量核对 |
| pending / processing / accepted / failed / unknown | 原有准备、领取、完成 RPC；模拟服务商响应 |
| 中断后手动幂等恢复 | 两次调用相同 key；一条数据库测试记录；模拟服务商只接收一次 |
| 未知结果恢复 | 只读刷新不新增记录；取消重测不新增记录；明确确认后新建请求 |
| 主通道切换、断开、权限受限 | 原有接口及 RLS；已有与空通道只读、凭据尾号不回显 |
| 加密不可用 | 独立无密钥测试环境中的解释与禁用入口 |
| 总览、地址、正文署名和创建活动衔接 | 实际设置保存与路由跳转；保留其他未完成准备项 |
| 手机、长内容、小高度与键盘 | 自动化截图、布局测量、VisualViewport 收缩与 CSS 缩放模拟 |

测试夹具仅运行在 `127.0.0.1`，场景控制只改独立 `channels@example.test` 的工作区。主通道切换场景临时启用测试注册表中的 SES，之后恢复；这不代表生产服务商已开放。测试账号、凭据及响应均为虚构数据。

完整 `EDM_CHANNEL_VISUAL_PHASE=after npm run ci:verify` 通过：lint、typecheck、format:check、214 项单元／数据库测试、生产构建和 41 项 E2E。默认环境另有 1 项无密钥用例按条件跳过，已用独立配置单独执行通过。Lint 仅保留已有帮助页未使用类型警告。推送前遵循 pre-push 的 `npm run ci:push`，不跳过 hook。

## 五、证据限制与交付状态

- **源码判断**：接口、权限、版本、加密、幂等和正式发送边界均根据当前实现核对。
- **本地自动化**：认证协议与服务商响应由隔离夹具模拟，SQL / RLS 在 PGlite 执行；不作为真实外部发信或生产验收。
- **模拟视口**：四种宽度、明暗主题、小高度、CSS 200% 与 VisualViewport 收缩可证明对应布局；没有实体手机、原生软键盘、Safari / Firefox 或 VoiceOver 实测。
- **手动浏览器**：工具库存返回 `browsers=[]` 与 `Local browser use is disabled in Work settings`。未绕过设置、未注入 overlay、未启动 Impeccable live-server；以授权 Playwright 和人工目检其 PNG 继续验证。没有宣称用户浏览器上存在高亮层。
- **真实外部验证**：未使用真实凭据、未给客户发信、未验证真实邮箱收件或服务商控制台，也未修改线上 Supabase / Vercel 配置。
- **离开路径**：覆盖应用提供的跳转与浏览器刷新/整页离开；未声称对所有浏览器的历史导航、强制关闭、进程结束或操作系统回收都能阻止数据丢失。
- **远端检查**：GitHub“工程验证”和 Vercel 在 PR 创建后按实际状态报告；本地通过不等同于远端通过，不自动合并。

交付包括源码、回归、代表性图片和本验收文档。最终 PR、提交与检查状态以任务交付回复为准。
