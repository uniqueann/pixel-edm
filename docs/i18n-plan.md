# 中英双语（i18n）实施方案 — 详细 Spec

> 状态：**方案定稿（已评审修订），待实现**（本文档只做设计，不含代码改动）
> 决策日期：2026-11-22｜修订日期：2026-11-23
> 调研结论以只读探索为准，涉及的文件行号为该时刻快照，实现前按当前代码为准。

---

## 0. 决策记录

| 决策点 | 结论 |
|---|---|
| 英文用户 | 海外团队成员 **和** 海外客户/公开访客，两者都要 |
| URL 策略 | URL 不变，采用 `next-intl` **无路由模式（Without i18n routing）**，不引入 `app/[locale]` 与 `proxy.ts` rewrite |
| 偏好粒度 | 按用户（`edm.members.locale`），非按工作区 |
| 首期范围 | 登录后界面 + 公开页（登录/注册/邀请）+ 退订页 + 面向前端的 Billing/Discount API 提示 |
| 英文品牌名 | **Pixel EDM**（中文界面继续用「卖家邮局」） |
| 翻译来源 | 机器初翻 + 人工校对 + 自动化守门测试，中文为源语言 |
| 落地 | `docs/i18n-plan.md`（本文件），不写代码 |

---

## 1. 背景与目标

项目是登录后 SaaS（`edm.contentup.cc`），无营销落地页、无 SEO 诉求（`src/app/page.tsx` 仅 `redirect("/dashboard")`）。目标是让英文用户能完整使用工作台、公开认证页与退订页，且**不破坏**：

- 已发出的退订链接（外部收件人手里）
- 共享 Supabase 实例的 Auth 回调白名单（跨项目，见 `AGENTS.md`）
- 现有 22 个依赖中文的 E2E spec 与 41 个纯 Node 单元测试（`node --test tests/*.test.mjs`）

---

## 2. 范围

### 2.1 首期（本 spec 覆盖）

- Shell、导航、账号区、页脚、语言切换
- 全部 `(office)` 页面：dashboard、settings、team、campaigns、contacts/导入、templates、channels、logs、audit
- 全部公开认证页：login、register、forgot-password、reset-password、invite、onboarding、disabled、`/setup`
- 退订页 + one-click API 响应 + 本地化 metadata
- 全部 toast、空态、表单校验、确认对话框、aria-label / placeholder / title
- 面向前端的 API Routes（如 Billing 折扣校验、Creem/Dodo Checkout 错误与提示）结构化错误码与提示本地化
- 预置模板**名称/分类**按 `default_key` 做展示层本地化（仅未自定义改名时覆盖，并处理搜索/筛选对齐，见 §6.4）
- DB 错误的应用层错误码映射（不改历史迁移）

### 2.2 后续（不在首期）

- Help 正文与图文教程（`src/features/help/content.ts` 等 202 行内容型文案；首期只翻译外壳与目录标题）
- 系统测试邮件正文（`supabase/functions/edm-delivery-test`、`_shared/directmail.ts`）
- DB 导入消息/订阅备注的 `code + params` 长期化（首期先做展示层映射）
- 新 RPC 通过 `errcode` / `code,params` 输出机器码
- Supabase Auth 邮件模板（共享 content-up 实例，需跨项目协调，见 §12.3）

### 2.3 永不翻译（用户内容）

- 模板自定义名称/分类/主题/正文、活动名称/变量、客户姓名/邮箱/标签
- 发件人别名/地址、Reply-To、页脚地址、人工核对备注、退订原因
- `campaign_snapshots` / `campaign_recipient_snapshots` 中的已渲染内容
- Creem/Dodo Dashboard 里配置的商品名与描述

---

## 3. 技术选型

- **next-intl 4.15.x**：已声明支持 Next 16（`peerDependencies.next: ^16.0.0`），原生支持 **Without i18n routing（无路由模式）**——仅在 `src/i18n/request.ts` 的 `getRequestConfig` 中解析请求级 locale，无需迁移页面到 `app/[locale]`，也无需在 `src/proxy.ts` 中做 URL rewrite 或依赖 `next/root-params`。
- **不选** 自研字典：约 1300–1500 条 key、40 余处带变量/量词的复合句，自研需自己实现 ICU 复数、类型安全、客户端/服务端共享，不划算。
- **消息格式**：ICU MessageFormat（复数、插值、嵌套）。
- **质量守门**：在 `npm test` 新增翻译完整性单测，自动校验中英文 key 集合、ICU 占位符变量名集合一致性及空串检测（见 §5.5）。

---

## 4. 架构设计

### 4.1 目标目录结构

现有 `src/app/` 路由结构**原地不动**，仅新增 `src/i18n/`、`messages/` 与 `src/lib/errors.ts`：

```
src/
├── app/
│   ├── layout.tsx                      ← 动态 <html lang>、generateMetadata、根级 NextIntlClientProvider（仅公共包）
│   ├── (office)/…                      ← 登录后工作台（原地不动，路由级按需注入业务 namespace）
│   ├── (auth)/…                        ← 登录/注册/邀请等（原地不动）
│   ├── unsubscribe/[token]/page.tsx    ← 退订页（独立解析 ?lang / Accept-Language / 双语兜底）
│   ├── setup/page.tsx                  ← 原地不动
│   ├── not-found.tsx / error.tsx       ← 原地不动，无 [locale] 全局兜底边界问题
│   ├── page.tsx                        ← redirect("/dashboard") 不变
│   ├── api/…                           ← 路径不变
│   └── auth/callback/route.ts          ← 路径不变，复用登录后 locale 同步逻辑
├── i18n/
│   ├── config.ts                       ← LOCALES = ['zh-CN', 'en']、DEFAULT_LOCALE、LOCALE_COOKIE
│   ├── locale.ts                       ← 请求级 locale 解析（含 React.cache 复用 member.locale）与同步逻辑
│   ├── request.ts                      ← next-intl getRequestConfig（无路由模式）
│   ├── messages.ts                     ← 按 namespace 加载与裁剪工具（pickMessages）
│   └── format.ts                       ← formatDate / formatNumber / formatCurrency（区分业务时区与事件时间）
├── components/
│   ├── local-date.tsx                  ← 客户端事件时间渲染组件（浏览器本地时区，防 Hydration Mismatch）
│   └── locale-switcher.tsx             ← 语言切换控件（登录后写 DB+cookie，未登录写 cookie）
├── lib/errors.ts                       ← 错误码体系（§6.1）
└── proxy.ts                            ← 保持原样，仅做 Supabase 会话刷新（不做 intl rewrite）
messages/
├── zh-CN/{common,shell,auth,dashboard,settings,team,campaigns,contacts,templates,channels,billing,audit,help,unsubscribe,errors,validation}.json
└── en/   (同上 16 个文件，机器初翻 + 人工校对 + 单测守门)
```

### 4.2 为什么采用无路由模式（Without i18n routing）

放弃 `app/[locale]` + `localePrefix: 'never'` rewrite，直接采用无路由模式的原因：

1. **避免与 `src/proxy.ts` 冲突**：现有 `src/proxy.ts` 在 Supabase token 刷新时会执行 `response = NextResponse.next({ request })` 重建响应对象；若合并 next-intl middleware rewrite，刷新 token 极易冲掉 rewrite 目标或丢失 `NEXT_LOCALE` cookie。
2. **避免退订页规则打架**：退订页需要 `?lang=zh|en` → `Accept-Language` →「中英双语兜底」三态，next-intl 路由层既不识别 `?lang=` 也不支持第三态，且 `NEXT_LOCALE` cookie 会误劫持已登录用户预览退订页。
3. **改动面最小且保留 git 历史**：无需搬迁 20+ 页面文件，不影响 `not-found.tsx` / `error.tsx` 边界，也不影响 `/auth/callback` 与 `/unsubscribe/*` 形态。
4. **未来可平滑升级**：项目本身全部动态渲染；若未来要做营销落地页 / SEO 切换 `as-needed`，届时本身就要改造 `Link`、`redirect`、Auth 回调白名单和 E2E URL 断言，无需在首期提前承担 rewrite 复杂度。

### 4.3 语言协商优先级

| 场景 | 优先级（高 → 低） | 说明 |
|---|---|---|
| 登录后工作台 | `members.locale` → `NEXT_LOCALE` cookie → `Accept-Language` → `zh-CN` | `members.locale` 为权威偏好，避免换设备后首屏闪回中文 |
| 未登录公开页（认证/邀请/setup） | `NEXT_LOCALE` cookie → `Accept-Language` → `zh-CN` | 支持在登录/注册前先切换语言，登录后自动延续 |
| 退订页（外部收件人） | `?lang=zh\|en` → `Accept-Language` → 中英双语兜底 | **完全不读也不写 `NEXT_LOCALE` cookie**，不与登录态互相污染 |

### 4.4 locale 存储、读取与同步（按用户）

- **数据层**：新增迁移给 `edm.members`（已核实为按 `user_id` 一人一行，工作区关联在 `edm.workspace_members`）增加 `locale text` 列，`NULL` 表示未设置，加约束 `CHECK (locale IN ('zh-CN', 'en'))`。
- **保存 RPC**：新增 authenticated-only RPC（如 `edm.set_member_locale(p_locale text)`）幂等更新当前用户自身行，沿用现有 `edm.*` 权限风格。
- **读取与性能**：
  - `src/proxy.ts` **不查数据库、不调用 `getContext()`**，避免每次页面请求多出额外 DB RTT。
  - 服务端渲染通过 `React.cache` 封装当前用户 `member` 查询（与 `src/lib/workspace.ts` 中的 `getContext()` 复用同一次请求级缓存），供 `getRequestConfig` 在检测到已登录会话时优先读取 `member.locale`，零重复查库且避免换设备首屏闪中文。
- **登录态同步（明确单一落点）**：
  - 由于邮箱密码登录在客户端 `src/components/auth-form.tsx` 直连 `supabase.auth.signInWithPassword`，而 OAuth / 邮件链接回调走 `src/app/auth/callback/route.ts`，且 Next.js Server Component 渲染期不允许写 `cookies().set()`，因此需要统一同步入口：
  - 新增 `syncMemberLocale()`（Server Action，同时抽出纯服务端 helper 供 `/auth/callback` 复用）：
    - 若 DB `members.locale` 有值 → 将其写入 `NEXT_LOCALE` cookie（`maxAge: 1 年`，`sameSite: "lax"`，`path: "/"`）；
    - 若 DB `members.locale` 为 `NULL` → 用当前 `NEXT_LOCALE` cookie 或 `Accept-Language` 协商结果回写 DB，并同步写入 cookie（避免后续每次重新猜）。
  - 触发时机：密码登录/注册直登成功后在 `router.replace` 前调用一次；OAuth / 邮件验证在 `/auth/callback` 中完成会话建立后同步；若新用户先进入 `/onboarding` 初始化 member，则在 `initialize()` 创建 member 后一并写入当前协商 locale。
- **主动语言切换**：
  - 已登录：调用 Server Action 写 DB（`set_member_locale` RPC）+ 写 `NEXT_LOCALE` cookie + `router.refresh()`。
  - 未登录：写 `NEXT_LOCALE` cookie（通过轻量 Server Action 或 `document.cookie` 工具）+ `router.refresh()`。
- **退出登录**：`src/app/actions.ts` 的 `signOut` 只删 `workspaceCookie`，**保留 `NEXT_LOCALE` cookie**，避免英文用户退出后登录页突然跳回中文。
- **类型更新**：迁移后执行 `npm run db:types` 更新 `src/lib/supabase/database.types.ts`。

### 4.5 `src/proxy.ts` 保持精简

- `src/proxy.ts` 保持现有单一职责（Supabase 会话刷新 + `Cache-Control: private, no-store`），不混入 next-intl middleware。
- 不改变 `/auth/callback`、`/unsubscribe/*`、`/api/*` 的任何路径与响应构建逻辑。

---

## 5. 文案工程

### 5.1 namespace 划分（共 16 个，与 §4.1 文件一一对应）

按 feature 对齐 `src/features/*`，`errors` 与 `validation` 集中管理：

| namespace | 覆盖 | 对应来源 |
|---|---|---|
| `common` | 通用按钮、确认/取消、空态、分页 | `src/components/ui/*`、`confirm-dialog.tsx`、`list-pagination.tsx` |
| `shell` | 导航、品牌、页脚、账号区、工作区切换 | `src/components/app-shell.tsx`、`brand.tsx` |
| `auth` | 登录/注册/找回/重置/邀请/onboarding/disabled/setup | `src/components/auth-form.tsx`、`(auth)/*`、`/setup` |
| `dashboard` | 总览、准备清单、店铺信息、我的署名 | `(office)/[section]/page.tsx`、`src/features/onboarding/*` |
| `settings` | 设置页、界面外观、发信通道、套餐展示 | `(office)/[section]/page.tsx` settings 段 |
| `team` | 成员/角色/邀请 | `src/features/team/*` |
| `campaigns` | 活动状态/确认/发送/额度 | `src/features/campaigns/*` |
| `contacts` | 客户/标签/导入 | `src/features/contacts/*` |
| `templates` | 模板编辑器/变量/预览 | `src/features/templates/*` |
| `channels` | 通道/供应商/凭据/测试结果 | `src/features/channels/*` |
| `billing` | 套餐/结账/折扣/订阅状态 | `src/features/workspace/*`、`src/lib/billing/*`、`src/app/api/billing/*` |
| `audit` | 操作日志标签 | `src/features/audit/*` |
| `help` | 帮助外壳与目录标题（首期） | `src/features/help/*` |
| `unsubscribe` | 退订页与 API 响应 | `src/app/unsubscribe/*`、`src/features/unsubscribe/*` |
| `errors` | 错误码文案 | `src/lib/*-error*.ts`、DB 错误映射、API 错误码 |
| `validation` | zod 校验消息 | `src/lib/validation.ts`、`src/lib/sender-name.ts` 及各 `model.ts` |

### 5.2 key 命名

- 嵌套对象，key 用 `camelCase`，语义化路径，禁止拼音缩写。
- 例：`shell.nav.dashboard`、`campaigns.toast.paused`、`errors.db.uniqueViolation`、`validation.senderNameRequired`。
- 带变量的用 ICU 占位符，不用字符串拼接。

### 5.3 ICU 消息格式

现有 40 余处复合句必须改为 ICU，典型改造：

| 现状（拼接） | 目标 ICU |
|---|---|
| `` `今日已用 ${used} / ${limit} 封，剩余 ${remaining} 封` `` | `quotaUsed: "今日已用 {used} / {limit} 封，剩余 {remaining} 封"` |
| `` `${total} 位` `` | `recipientCount: "{total, plural, one {# 位} other {# 位}}"`（英文用 `{total, plural, one {# recipient} other {# recipients}}`） |
| `` `${opened} / ${delivered}，共 ${tracked} 个活动` `` | `openRateNote: "打开率按近 30 天启用追踪活动的已送达收件人加权计算（{opened} / {delivered}，共 {tracked} 个活动）。"` |

规则：
- 中文量词「位/封/个/条/人」在英文侧用复数形式区分，靠 ICU `plural` 而非 if/else。
- 用户输入内容嵌进标点时（`` `变量“${raw}”语法无效` ``）用占位符包住，避免英文标点错位。

### 5.4 服务端/客户端用法与按需下发边界

- **Async Server Component（绝大多数 page/layout）**：统一使用 `await getTranslations("namespace")`。
- **同步 Server Component**：可使用 `useTranslations("namespace")`。
- **Server Action / Route Handler**：显式调用 `await getTranslations({ locale, namespace })`（或优先返回结构化 `{ code, params }` 交由展示层翻译）。
- **Client Component**：使用 `useTranslations("namespace")`。
- **按需下发 messages（防首屏全量打包，同时防子组件缺 key）**：
  - 根布局 `src/app/layout.tsx` 的 `NextIntlClientProvider` **仅下发公共小包**：`pickMessages(messages, ["common", "shell", "errors", "validation"])`。
  - 各业务页面或布局（如 `(auth)/layout.tsx`、`campaigns/page.tsx`、`contacts/page.tsx`、`templates/page.tsx`、`logs/page.tsx`、`[section]/page.tsx`）按需嵌套局部 `NextIntlClientProvider`，使用 `pickMessages` 追加本路由所需的 1–3 个业务 namespace（`next-intl` v4 支持嵌套合并或显式合并公共包）。

### 5.5 翻译完整性自动化守门

在 `tests/` 新增纯 Node 单测 `tests/i18n-messages.test.mjs`（随 `npm test` 和 `npm run ci:push` 自动执行），强校验：

1. `messages/zh-CN/` 与 `messages/en/` 的文件列表完全一致；
2. 每个 namespace 内嵌套 key 集合 100% 对称（禁止缺翻或残留孤立 key）；
3. 同一 key 对应的 ICU 占位符变量名集合 100% 一致（防手滑改坏 `{count}` / `{name}` 导致运行时崩溃）；
4. 所有叶子文案非空串。

---

## 6. 底座重构（P0，与翻译解耦，先行）

### 6.1 错误码体系（覆盖 Server Actions、DB 与 API Routes）

**目标**：让错误以 `{ code, params? }` 跨客户端/服务端/API/DB 边界传递，文案只在展示层按 locale 解析。

**设计**（`src/lib/errors.ts`）：

```ts
export type AppErrorPayload = {
  code: string;
  params?: Record<string, string | number>;
};
```

**改造点（现状清单）**：

| 现状 | 文件 | 改造 |
|---|---|---|
| 15 个中文前缀白名单过滤 DB 错误 | `src/features/team/actions.ts:44-67` | 前缀 → 错误码映射 |
| 15 个中文前缀白名单 | `src/features/channels/actions.ts:36-61` | 同上 |
| `/[一-鿿]/.test(error.message)` 判断可展示 | `src/features/contacts/use-contact-import.ts:35` | 改为判断 `code` |
| `error.includes("重新加载")` | `src/features/contacts/contacts.tsx:845` | 改为判断 `code` |
| `detail.includes("未配置")` | `src/lib/billing/discount-availability.ts:31` | 改为判断 `code` |
| 按中文分号 `；` 切分导入消息 | `src/features/contacts/import-model.ts:143-156` | 改为结构化 `{ code, params }[]` |
| `label.replace("模板","")` 切除中文前缀 | `src/features/audit/activity-logs.tsx:23-32` | 标签改为结构化 `{ type, labelKey }` |
| 78 处 `throw new Error(中文)` / `{ error: 中文 }` | 各 `actions.ts`、`src/app/actions.ts` | 改为返回 `{ error: { code, params } }` 或抛出带 `code` 的 `AppError` |
| P0001 原样透传 `error.message` | `src/features/contacts/actions.ts:69-72,105` 等 | 映射 SQLSTATE + 前缀 → code |
| **API Routes 直接返回中文 `error` / `message`** | `src/app/api/billing/discount/route.ts`、`src/lib/billing/discount-availability.ts`、`src/app/api/creem/checkout/route.ts`、`src/app/api/dodo/checkout/route.ts` | 改为返回结构化 `{ code, params }`（兼容旧字段或在展示层统一解析） |

**DB 错误映射**（不改历史迁移，应用层建表）：

- 通用 SQLSTATE → code：`23505` → `errors.db.uniqueViolation`、`23503` → `errors.db.foreignKeyViolation`、`22001` → `errors.db.valueTooLong`、`42501` → `errors.db.permissionDenied`、`P0001` → 按 message 前缀细分。
- 已结构化的模块直接复用：`src/lib/delivery-provider-error.ts`（英文 machine code 已存在，补英文文案表即可）、`src/lib/auth-errors.ts`、`src/lib/billing/checkout-toast-copy.ts`、`src/lib/billing/checkout-provider-error.ts`。

**兼容过渡**：action 返回类型统一支持 `{ error?: AppErrorPayload | string }`；客户端统一走 `resolveErrorText(error, t)` 解析——对象按 `t(error.code, error.params)` 渲染，存量 `string` 若匹配错误码前缀则翻译、否则兜底原样展示，支持渐进迁移。

### 6.2 zod 校验国际化（错误码 key 模式，兼容纯 Node 单测）

**问题**：
1. 6 组 schema 被客户端表单和服务端 action 同时 import（`src/lib/validation.ts`、`src/lib/sender-name.ts`、`campaigns/model.ts`、`templates/model.ts`、`channels/model.ts`、`contacts/model.ts`、`contacts/import-model.ts`、`team/*`）；
2. 41 个纯 Node 单元测试（如 `tests/sender-name.test.mjs`、`tests/campaigns.test.mjs`）直接通过 `node --test` 导入这些静态 schema，不经过 Next.js 打包环境，也不能耦合 `next-intl` 运行时。

**方案（轻量错误码 key 模式，替代重型工厂函数）**：

- **保留静态 schema 导出**，不强行改成 `createXSchema(t)` 工厂，避免全站到处透传 `t` 以及切换语言时反复重建 `useForm({ resolver: zodResolver(schema) })`。
- schema 内部消息直接填写稳定的 `validation.*` 错误码 key（例如 `z.string().min(1, "validation.senderNameRequired")`）；带动态参数的自定义校验（如「活动包含未知变量」）统一编码或通过 `resolveValidationError(issue, t)` 映射。
- 表单展示层和服务端 action 返回层统一通过 `resolveValidationError(message, t)` 解析为当前 locale 文案；纯 Node 单测依然可以直接调用静态 schema 的 `.safeParse()`，断言 `success` 或稳定错误码即可，完全不依赖 `next-intl`。

### 6.3 日期 / 数字 / 货币格式化（区分业务规则时区与事件时间戳）

新增 `src/i18n/format.ts` 与 `src/components/local-date.tsx`，区分两类时间：

1. **业务规则时间（固定北京时间）**：
   - 每日发信额度重置「北京时间 00:00」属于服务端业务规则，不随 UI locale 改变。中文显示「北京时间 00:00」，英文明确显示 `00:00 Beijing time (UTC+8)`。
2. **事件时间戳（随用户本地时区）**：
   - 操作日志 `created_at`、活动发送时间、客户导入时间、通道测试时间、订阅到期日 `current_period_end` 等，若对海外英文用户强行固定 `Asia/Shanghai` 会造成明显困惑。
   - 统一通过轻量客户端组件 `<LocalDate value={iso} format="dateTime" />` 使用 `Intl.DateTimeFormat(locale, { ... })` 按用户浏览器本地时区格式化（SSR 阶段输出稳定占位或带 `suppressHydrationWarning` 的 ISO/UTC 基准，挂载后切换本地时区，避免 Hydration Mismatch）。
3. **数字与货币**：
   - `formatNumber(n, locale)` 替代所有 `toLocaleString("zh-CN")`。
   - `formatCurrency(usd, locale)` 货币固定 USD，数字与符号格式随 locale。

**现状硬编码点（需替换）**：8+ 处 `zh-CN` 日期（`(office)/[section]/page.tsx:524`、`contacts.tsx:50`、`activity-logs.tsx:166`、`team-manager.tsx:45`、`campaigns.tsx:104`、`import-presentation.ts:39`、`billing-upgrade.tsx:34`、`channel-detail.tsx:708`、`channel-test-result.tsx:34`）及多处 `toLocaleString("zh-CN")`。

### 6.4 哨兵与数据层（新增迁移，不破坏现有约束）

| 问题 | 现状 | 改造 |
|---|---|---|
| 默认署名哨兵 | `src/lib/sender-name.ts:4` `DEFAULT_SENDER_NAME = "店主"`，且 `edm.members.display_name` 默认 `'店主'` | **保留 `display_name` 列约束不变**（不破既有 RPC/NOT NULL 假设）；新增 `edm.members.display_name_customized boolean not null default false` 列，迁移时将现有 `trim(display_name) <> '店主' and trim(display_name) <> ''` 的老数据回填为 `true`。前端与 `senderNameDefault` 依据标志位判断，保存署名时置为 `true`，英文界面不再暴露 `"店主"` 字面量 |
| 默认工作区名 | `edm.workspaces.name` 默认 `'我的邮局'` | 用户内容，不翻译已有行；新建时按当前 locale 给默认名（中文「我的邮局」/ 英文 `My Workspace`）或首期沿用通用名 |
| 预置模板名称/分类 | `seed_default_templates` 中 6 套预置模板的 `subject`/`body` 已是英文，仅 `name`/`category` 为中文（带 `default_key`） | 展示层**仅当 `name` / `category` 仍等于该 `default_key` 对应的初始中文值时**才按 `default_key` 本地化显示，防止覆盖用户自己改过的模板名；同时在英文模式下，模板搜索与分类筛选同步匹配 `default_key` 的英文展示名（或在应用层把默认分类筛选映射回存储分类值），避免「看得到英文、搜不到记录」 |
| 系统内置展示名 | `delivery_providers.display_name`（阿里云邮件推送等）、`delivery_plan_limits.display_name`（Free/Pro/Team） | 首期在展示层按稳定 key 本地化，不改 DB 存量值 |
| 客户导入 CSV/粘贴 | `import-model.ts` 状态别名已同时支持中英文（`subscribed` / `已订阅` 等） | 顺带核对 CSV 示例模板、表头映射与 `parse_error`/`validation_error`，确保英文表头与错误提示全链路可用 |

---

## 7. 语言切换 UX

- **登录后**：设置页「界面外观」卡（`(office)/[section]/page.tsx:213-226`）加「语言 / Language」分段单选；顶栏 `ThemeToggle` 旁（`app-shell.tsx:159-161`）加轻量快捷切换。
- **公开页**：`(auth)/layout.tsx:9-12` 的 Brand + ThemeToggle 区域加语言切换。
- **退订页**：右上角（`unsubscribe/[token]/page.tsx:39-41`）加 `中文 / English` 链接，用 `?lang=zh` / `?lang=en` 切换，**不读写 `NEXT_LOCALE` cookie**。
- 切换即时生效：更新 DB（如已登录）与 cookie 后触发 `router.refresh()` 重渲染 Server Components；Client Components 随 Provider 的 `messages` 更新。

---

## 8. 公开页与退订页细节

### 8.1 metadata 与 `<html lang>`

- `src/app/layout.tsx`：改为 `async` 布局，通过 `getLocale()` / `getTranslations()` 动态设置 `<html lang={locale}>` 与 `generateMetadata()`：title 模板 zh `%s · 卖家邮局` / en `%s · Pixel EDM`；description 本地化。
- 退订页 metadata：在 `src/app/unsubscribe/[token]/page.tsx` 的 `generateMetadata()` 中按 `?lang` / `Accept-Language` 返回 zh `邮件退订` / en `Unsubscribe` / 双语 `邮件退订 · Unsubscribe`。

### 8.2 退订页

- 现有页面/表单（`src/app/unsubscribe/[token]/page.tsx`、`src/features/unsubscribe/unsubscribe-form.tsx`）已中英并列；改造为按 `?lang` → `Accept-Language` 单语渲染，当两者均无法识别时保留中英双语兜底，并始终保留右上角 `中文 / English` 切换。
- one-click API（`src/app/api/unsubscribe/[token]/route.ts:24-51`）返回纯文本按 `Accept-Language`（缺省英文或中英双语，符合 RFC 8058 外部邮件客户端预期）。
- 邮件页脚（`supabase/functions/_shared/unsubscribe-token.ts:196-206,245-271`）当前已中英双语，是安全兜底，首期**保持不变**。

---

## 9. E2E 与单元测试策略

- **防止 CI 默认英文打红现有 22 个中文 spec（必做）**：
  - 在 `playwright.config.ts` 的 `use` 中显式配置 `locale: "zh-CN"`（`tests/responsive.config.ts` 复用 `base.use` 会自动继承），确保 GitHub Actions Ubuntu runner 上 903 处中文 locator 稳定全绿。
  - 同步检查并更新 `tests/auth-fixture.mjs`：为种子 `members` 补齐 `locale`、`display_name_customized` 字段，并注册新增的 `set_member_locale` RPC mock（符合 `AGENTS.md` 要求）。
- **夹具数据**：夹具中的中文用户数据属于「用户内容」，继续保留，不参与 UI 文案断言。
- **新增自动化测试**：
  - `tests/i18n-messages.test.mjs`（单元测试）：校验中英文 16 个 namespace 的 key 集合、ICU 变量名集合一致性与空串检测。
  - `tests/e2e/i18n-en.spec.ts`：通过 `test.use({ locale: "en-US" })` 与 cookie/DB 切换，验证公开认证页、登录后导航、设置页为英文，退出登录后仍保持英文，切换回中文恢复正常。
  - `tests/e2e/unsubscribe-en.spec.ts`：通过 `?lang=en`、`Accept-Language: en` 以及未知语言兜底请求退订页，断言渲染与 one-click API 响应。
  - 英文导航视觉回归：将 `tests/responsive/office-nav.spec.ts` 在英文 locale 下验证一遍，确认长英文导航词在 PC / 平板 / 移动端不会异常溢出或错误折叠。

---

## 10. 实施阶段与验收

> 每阶段以 `npm run ci:push`（lint → typecheck → format:check → test → build）为门槛；涉及设置页/导航/RPC 时按 `AGENTS.md` 同步检查 E2E 种子与 `tests/e2e/*.spec.ts`，提 PR 前跑完整 `npm run ci:verify`。

### P0-a 底座（不改 UI 语言，行为不变）

- [x] `src/lib/errors.ts` 错误码体系 + 5 处中文控制流 + Billing/Discount API Routes 改结构化 code（§6.1）
- [x] 6 组 zod schema 改为错误码 key 模式 + 展示层解析，41 个纯 Node 单测全绿（§6.2）
- [x] `src/i18n/format.ts` + `<LocalDate />` 客户端时间组件 + 替换 8+ 处日期/数字硬编码（§6.3）
- [x] 数据库迁移：`edm.members.locale`、`edm.members.display_name_customized` + 回填 + `set_member_locale` RPC + `npm run db:types` + 更新 `tests/auth-fixture.mjs`（§4.4、§6.4）
- **验收**：现有 22 个 E2E 与 41 个单测全绿，中文 UI 无肉眼变化

### P0-b 基础设施接线（无路由模式）

- [x] 安装 `next-intl`，配置 `next.config.ts` 插件（`createNextIntlPlugin`）
- [x] 新建 `src/i18n/{config,locale,request,messages}.ts` 与 `messages/zh-CN/*`（16 个 namespace）
- [x] `src/app/layout.tsx` 动态 `<html lang>` + `generateMetadata` + 根级 `NextIntlClientProvider`（仅公共包）
- [x] 登录/回调/初始化的 `syncMemberLocale()` 接线 + `signOut` 保留 `NEXT_LOCALE` cookie（§4.4）
- [x] `playwright.config.ts` 显式设置 `locale: "zh-CN"` + 新增 `tests/i18n-messages.test.mjs` 守门单测
- [x] 语言切换 UI（设置页 + 顶栏 + 公开页 + 退订页 `?lang=`，§7）
- **验收**：URL 与 `src/proxy.ts` 零变动；切换语言后刷新与登出均保持状态；`npm run ci:verify` 通过

### P1-a 首屏英文体验

- [x] `messages/en/*`：机器初翻 + 人工校对（§12.1–12.2）
- [x] Shell / 认证页 / 设置页 / 退订页英文化（含按路由注入业务 namespace）
- [x] 新增 `tests/e2e/i18n-en.spec.ts`、`tests/e2e/unsubscribe-en.spec.ts`
- **验收**：英文冒烟 E2E 与翻译守门单测全绿，核心认证/导航/退订流程可走通

### P1-b 业务页英文

- [x] Dashboard / Campaigns / Contacts（含导入）/ Templates / Channels / Team / Billing / Audit 英文文案
- [x] 预置模板名称/分类按 `default_key`（未自定义时）本地化及搜索/筛选对齐
- **验收**：核心业务流程（建模板 → 建活动 → 导入客户 → 发送 → 结账折扣校验）英文可走通，toast/校验/空态无中文残留

### P1-c 收尾与视觉回归

- [ ] 帮助外壳与目录标题英文（正文留待 P2）
- [ ] 全站 metadata、placeholder / aria-label / title 排查
- [ ] 视觉回归：重点巡检英文长词页面（`campaigns.tsx`、表格、按钮）与 `tests/responsive/office-nav.spec.ts` 英文模式导航折叠表现
- **验收**：中英双语言完整巡检通过，`npm run ci:verify` 全绿

---

## 11. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 共享 Supabase Auth 回调被改坏 | 无路由模式，`/auth/callback` 路径零改动 |
| 已发退订链接失效或被登录 cookie 干扰 | URL 不变；退订页独立解析 `?lang=` / `Accept-Language`，完全不读写 `NEXT_LOCALE` |
| `proxy.ts` Supabase token 刷新冲掉 locale rewrite | 采用无路由模式，不碰 `proxy.ts`，从根源消除该风险 |
| CI Ubuntu 浏览器默认英文导致 22 个 E2E 全红 | `playwright.config.ts` 显式锁定默认 `locale: "zh-CN"` |
| 中文控制流在英文下静默失效 | P0-a 先行，全部改 code 后再翻译 |
| 翻译漏翻或改坏 ICU 占位符导致运行时报错 | `tests/i18n-messages.test.mjs` 纳入 `npm test` / CI 强门禁 |
| `Accept-Language` 误判（中国用户用英文浏览器） | 协商优先级：DB 偏好 > cookie > 浏览器；提供设置页 + 顶栏显眼切换入口 |
| 英文文案更长导致布局溢出或顶栏提前折叠 | Fraunces/IBM Plex 已原生适配英文；P1-c 跑 `office-nav.spec.ts` 英文回归与页面视觉巡检 |
| 翻译不一致 | 固定术语表（§12.1），人工校对把关 |

---

## 12. 后续与待确认

### 12.1 术语表（已消除歧义项，待产品终审）

| 中文 | English | 备注 |
|---|---|---|
| 卖家邮局 / 邮局 | Pixel EDM | 英文品牌名 |
| 活动 / 发信活动 | Campaign | |
| 客户 | Contact | |
| 模板 | Template | |
| 工作区 | Workspace | |
| 成员 | Member | |
| 发信通道 | Channel | 首次出现可用 Sending channel |
| 退订 | Unsubscribe | |
| 收件人 | Recipient | |
| 已送达 | Delivered | |
| 打开率 | Open rate | |
| 套餐 | Plan | |
| 订阅 | Subscription | |
| 发件人别名 | From name | 邮件头 From 显示名，区分于对外署名 |
| 对外署名 | Sign-off name | 对应模板变量 `{{sender_name}}`（邮件末尾落款） |

### 12.2 翻译流程

1. 从 `messages/zh-CN/*` 抽取为源语言。
2. 机器初翻生成 `messages/en/*`。
3. 人工校对：术语一致性（对照 §12.1）、语气（产品既有语调偏日常/克制）、占位符与复数不遗漏。
4. 运行 `npm test`（含 `tests/i18n-messages.test.mjs`）确认 key 与占位符 100% 对齐，校对完成后在 PR 标注。

### 12.3 跨项目事项（首期阻塞点提示）

- **Supabase Auth 邮件模板**（注册确认/密码重置）托管在共享 content-up 实例，本仓库无法改。英文用户会收到中文确认邮件，需跨项目协调或在未来改为应用自定义发信——首期不做，但要在发布说明中明示。
- 若未来做 SEO / 可分享英文链接：再引入 `[locale]` 路由与 `as-needed`，并同步更新共享实例的 Redirect URLs 与 E2E URL 断言（届时单独评估兼容性）。

---

## 13. 附：关键文件索引（实现入口）

- 路由/布局：`src/app/layout.tsx`、`src/app/(office)/layout.tsx`、`src/app/(office)/[section]/page.tsx`、`src/app/unsubscribe/[token]/page.tsx`
- 认证与会话：`src/components/auth-form.tsx`、`src/app/auth/callback/route.ts`、`src/app/actions.ts`、`src/proxy.ts`（保持不动）
- 品牌/导航：`src/components/brand.tsx`、`src/components/app-shell.tsx`
- 校验：`src/lib/validation.ts`、`src/lib/sender-name.ts`、各 `src/features/*/model.ts`
- 错误与计费 API：`src/lib/delivery-provider-error.ts`、`src/lib/auth-errors.ts`、`src/lib/billing/checkout-toast-copy.ts`、`src/lib/billing/discount-availability.ts`、`src/app/api/billing/discount/route.ts`
- 数据层：`supabase/migrations/*`（只新增迁移）、`src/lib/supabase/database.types.ts`、`src/lib/workspace.ts`
- 测试：`playwright.config.ts`、`tests/responsive.config.ts`、`tests/auth-fixture.mjs`、`tests/e2e/*.spec.ts`、`tests/responsive/office-nav.spec.ts`
