# 卖家邮局 · 从原型到产品:技术设计草案

**版本 v1.3** · 更新于 2026-09-09
> v1.3 变更:新增第 6 节前端技术栈(Next.js + shadcn/ui + Supabase 等)。v1.2 变更:第 5 节补充 ESP 账号归属的设计理由(用户自接 vs 平台统一)。v1.1 变更:为 `contacts` 表补充订阅合规字段(退订状态、同意来源、退信状态),`workspaces` 表补充发件人合规地址字段。变更记录见文末。

整体思路是把原型里 `contacts` / `templates` / `campaigns` / `members` / `logs` 这几个数组,变成挂在同一个 `workspace`(工作区)下的数据表。个人版和团队版共用一套表结构 —— 区别只是这个工作区里有 1 个成员还是多个成员,权限逻辑完全一致,不用为个人版单独写一套代码。

---

## 1. 账号系统(Supabase Auth)

- 登录方式:邮箱+密码,加 Google OAuth(个人跨境卖家很多本来就用 Gmail,能减少注册摩擦)
- Supabase 自带 `auth.users` 表管理身份和会话,不用自己写密码加密、token 校验这些

**注册后自动初始化(用一个数据库触发器,而不是前端代码去做,防止漏掉):**

```
用户完成注册
  → 触发器在 profiles 表插入一行(id = auth.users.id)
  → 自动创建一个 workspace(type='personal', owner_id=该用户)
  → 自动在 workspace_members 插入一行(role='admin')
```

这样每个用户从注册那一刻起就有一个"个人工作区",以后要不要升级成团队版,只是把 `workspace.type` 改成 `'team'`、允许邀请更多成员而已,数据结构不用迁移。

---

## 2. 数据结构(以 workspace 为中心)

```
workspaces
├── workspace_members  (谁在这个工作区,什么角色)
├── contacts           (对应原型 state.contacts)
├── templates          (对应原型 state.templates)
├── campaigns           (对应原型 state.campaigns)
├── campaign_recipients (新增:每个收件人的真实发送状态,原型里没有,靠这个表才能做真实统计)
├── activity_logs       (对应原型 state.logs)
└── esp_connections     (新增:团队自己接的发信通道配置)
```

### 核心表字段(伪 SQL,便于后续直接改成迁移脚本)

```sql
workspaces
  id              uuid primary key
  name            text
  type            text        -- 'personal' | 'team'
  plan            text        -- 'free' | 'pro' | 'team'(为以后计费预留,先不管取值逻辑)
  mailing_address text        -- 邮件页脚展示的真实地址,CAN-SPAM 等法规要求发件人可被追溯
  created_at      timestamptz

workspace_members
  id            uuid primary key
  workspace_id  uuid references workspaces
  user_id       uuid references auth.users
  role          text        -- 'admin' | 'editor' | 'viewer'
  status        text        -- 'active' | 'invited'
  invited_email text        -- 邀请中但还没注册时用
  joined_at     timestamptz

contacts
  id                  uuid primary key
  workspace_id        uuid references workspaces
  email               text
  name                text
  tags                text[]
  subscription_status text        -- 'subscribed' | 'unsubscribed' | 'bounced' | 'complained'(默认 'subscribed')
  consent_source      text        -- 'checkout_optin' | 'popup_form' | 'manual_import' | 'csv_import' 等,记录这个联系人是怎么进来的
  consent_at          timestamptz -- 同意订阅的时间,GDPR 场景下用来自证合规
  unsubscribed_at     timestamptz -- 退订时间,为空代表未退订
  bounced_at          timestamptz -- 最近一次硬退信时间,为空代表正常
  created_by          uuid references auth.users
  created_at          timestamptz

templates
  id            uuid primary key
  workspace_id  uuid references workspaces
  name          text
  category      text
  subject       text
  body          text
  created_by    uuid
  created_at    timestamptz

campaigns
  id               uuid primary key
  workspace_id     uuid references workspaces
  name             text
  template_id      uuid references templates
  tag_filter       text
  variables        jsonb
  status           text      -- 'draft' | 'sending' | 'sent'
  recipient_count  int
  sent_at          timestamptz
  created_by       uuid
  created_at       timestamptz

campaign_recipients
  id            uuid primary key
  campaign_id   uuid references campaigns
  contact_id    uuid references contacts
  status        text        -- 'pending' | 'sent' | 'failed' | 'opened' | 'clicked'
  sent_at       timestamptz
  opened_at     timestamptz
  clicked_at    timestamptz
  error_message text

activity_logs
  id            uuid primary key
  workspace_id  uuid references workspaces
  actor_id      uuid references auth.users
  action        text
  target        text
  created_at    timestamptz

esp_connections
  id              uuid primary key
  workspace_id    uuid references workspaces
  provider        text      -- 'brevo' | 'mailgun' | 'sendgrid' | 'aliyun'
  api_key_encrypted text   -- 用 Supabase Vault 或加密列存,客户端拿不到明文
  sender_email    text
  sender_name     text
  created_by      uuid
  created_at      timestamptz
```

原型里 `state.settings`(店铺名/发件人)可以直接并进 `workspaces` 表当两个字段,不用单独建表。

**`contacts` 里新加的几个字段是干什么的:** 群发前按 `subscription_status = 'subscribed'` 过滤收件人,退订/硬退信的联系人自动被排除,不用人工维护;`consent_source` / `consent_at` 是万一被平台或监管方问起"这份名单哪来的、对方什么时候同意的"时能拿出来的凭证。`unsubscribed_at` / `bounced_at` 会由 Edge Function 在收到 ESP 的退订/退信 webhook 时自动写入,不需要人工操作。

---

## 3. 权限强制(RLS)—— 这是"能演示"和"能商用"的分界线

现在原型的权限检查全在 `can(action)` 这个前端函数里,说白了只是把按钮变灰,只要绕过界面直接改数据(改浏览器请求 / 改前端代码)就没用了。RLS 是把同样的规则写进数据库,不管请求从哪来都拦得住。

**先建一个辅助函数,查某用户在某工作区的角色:**

```sql
create function get_role(ws_id uuid, uid uuid) returns text as $$
  select role from workspace_members
  where workspace_id = ws_id and user_id = uid and status = 'active'
$$ language sql stable;
```

**以 `contacts` 表为例的策略:**

```sql
alter table contacts enable row level security;

-- 谁都能看,只要是这个工作区的成员
create policy "read contacts"
  on contacts for select
  using (get_role(workspace_id, auth.uid()) is not null);

-- 只有 admin / editor 能增删改
create policy "write contacts"
  on contacts for insert, update, delete
  using (get_role(workspace_id, auth.uid()) in ('admin','editor'));
```

`templates`、`campaigns` 的草稿创建同理。`campaign_recipients`、`esp_connections` 只读写给 admin(后者含密钥,更要收紧)。

**"只有管理员能发送"这种状态流转,用 `with check` 卡住:**

```sql
create policy "update campaign"
  on campaigns for update
  using (get_role(workspace_id, auth.uid()) in ('admin','editor'))
  with check (
    -- 非 admin 只能保存草稿字段,不能把 status 改成 'sent'
    status <> 'sent' or get_role(workspace_id, auth.uid()) = 'admin'
  );
```

**操作日志改成数据库触发器自动写,而不是靠前端调用:**

原型里每个操作后手动调用 `logAction()`,如果哪天有人绕过前端界面直接调接口改数据,这条日志就漏记了。更稳的做法是给 `contacts` / `templates` / `campaigns` / `workspace_members` 建 `after insert/update/delete` 触发器,自动写入 `activity_logs`,客户端完全不用管这件事,也没法伪造。

**"团队至少保留一个 admin"这条原型里在 JS 里判断的规则,也建议挪到触发器里**,在 `workspace_members` 的 delete/update 触发器里检查:如果这一操作会让某工作区的 admin 数量变成 0,直接拒绝(`raise exception`)。这样不管从哪个入口改,规则都生效。

---

## 4. 订阅计费

先跳过,等你想聊的时候再展开。

---

## 5. 实际发信(后端发信架构)

**ESP 账号归属:默认用户接自己的账号,而不是平台统一账号。** 原因有三个:一是发信信誉是共享的,如果所有用户共用平台的一个阿里云/Brevo 账号,某个用户的名单质量差、被大量举报,拖累的是这个账号整体的信誉,进而影响所有用户的邮件送达率;各用户用自己的账号,风险互相独立。二是这和第 4 节要定的定价逻辑一致 —— 发信成本不算在平台身上,才能按"管理能力"而不是"发信量"来定价。三是 `esp_connections` 表本来就是按 workspace 存 API Key 的,不用改架构。

代价是配置门槛:普通卖家自己开通阿里云邮件推送、验证发信域名(配 DNS)、申请提额度,这套流程不友好。这块建议靠产品体验解决 —— 设置页做带截图的分步引导 + 一个"发测试邮件"按钮,配置对不对一测就知道。也可以给还没配置好自己账号的用户,开放平台账号的小额测试配额(比如每月个位数封,发给自己或团队内部),但正式群发必须切到自己的账号,不承担多租户共用发信信誉的风险。

原型现在是"生成 CSV 让用户自己导入 ESP",做成产品的话流程大致是:

1. **连接通道** — 设置页里,admin 填入 ESP(阿里云邮件推送 / Brevo / Mailgun / SendGrid)的 API Key,存进 `esp_connections`,加密存储,前端存进去之后就读不出明文了,只能改/删
2. **发送触发** — 点"发送"时,前端调用一个 Supabase Edge Function(比如 `send-campaign`),传 `campaign_id`
3. **服务端再校验一次权限**(不能只信前端已经判断过) —— 确认调用者在这个工作区是 admin
4. Edge Function 内部:取活动 + 模板 + 命中标签的收件人列表 + 这个工作区连的 ESP 配置,逐个合并变量、调 ESP 的发送接口,同时在 `campaign_recipients` 里为每个收件人写一行发送状态
5. **回执用 webhook 接住** —— Brevo / Mailgun / SendGrid 这些 ESP 都能配置"邮件被打开/被点击"的回调,另开一个 Edge Function 接收这些事件,更新 `campaign_recipients.opened_at` / `clicked_at`。这样活动详情页显示的打开率/点击率就是真实数据,而不是原型里 `generateStats()` 随机生成的数字
6. **量大了要考虑排队** —— MVP 阶段几百个收件人,同步循环发送问题不大;客户量上来后,Edge Function 有执行时长限制,建议改成写入一张待发队列表,配合 `pg_cron` 定时批量处理,避免超时
7. **CSV 导出保留下来** —— 作为团队还没连 ESP 时的兜底选项,不强制所有人一开始就配置发信通道

---

## 6. 前端技术栈

- **框架:Next.js(App Router)+ TypeScript** —— 部署在 Vercel、官方重点维护和 Supabase 的搭配(SSR session、auth helper 都有现成方案),资料最全,踩坑最少
- **UI 层:shadcn/ui + Tailwind CSS** —— 不是传统意义装个包的组件库,组件源码直接拷进项目里,样式可以自己精调,不会一眼就是"后台管理系统"的长相;图标用 **lucide-react**,标题/正文字体延续原型里已经定好的 Fraunces + IBM Plex Sans,不用重新摸索视觉语言
- **数据请求/缓存:TanStack Query** —— 客户列表、活动状态这类频繁增删改的数据,靠它管理缓存和乐观更新
- **表单与校验:React Hook Form + Zod**
- **类型安全:** Supabase 可根据数据库表结构自动生成 TypeScript 类型,直接对应第 2 节定的表结构

---

## 和原型的主要差异一览

| 原型(现在) | 产品(以上方案) |
|---|---|
| `window.storage`,数据按浏览器存 | Supabase 数据库,按 workspace 存,任何设备登录都能看到 |
| 权限只在前端 `can()` 函数判断 | RLS 在数据库层强制,前端判断只是体验优化 |
| 操作日志靠前端手动调用记录 | 数据库触发器自动记录,无法绕过 |
| "标记为已发送"生成随机统计数字 | Edge Function 真实调用 ESP 发送 + webhook 回收真实打开/点击数据 |
| 身份靠下拉框"假装切换" | Supabase Auth 真实登录 + session |

---

## 变更记录

- **v1.3**(2026-09-09)—— 新增第 6 节前端技术栈:Next.js + TypeScript + Tailwind + shadcn/ui + Supabase + TanStack Query + React Hook Form/Zod。
- **v1.2**(2026-09-09)—— 第 5 节新增 ESP 账号归属说明:默认用户接自己的账号,附信誉风险、定价一致性、配置门槛折中方案三点理由。
- **v1.1**(2026-09-09)—— `contacts` 表新增 `subscription_status` / `consent_source` / `consent_at` / `unsubscribed_at` / `bounced_at`;`workspaces` 表新增 `mailing_address`。均为满足退订处理与合规留痕需要。
- **v1.0**(2026-09-09)—— 初版:账号系统、workspace 数据结构、RLS 权限、实际发信架构。
