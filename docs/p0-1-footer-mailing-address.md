# P0-1 邮件页脚实体地址：存量数据处理说明

对应 `docs/ux-ui-audit.md` 的 P0-1。本次改动只收紧前端与 Server Action 校验，并在设置页、总览中提示问题，**不修改任何生产数据**。

## 代码行为

- 校验规则在 `src/lib/mailing-address.ts`（`mailingAddressProblem`），设置表单、`saveWorkspace` 和总览“下一步”共用同一份规则。
- 规则会拒绝：空值、明显的占位文字（如 `Sender's contact information`、`contact info`、`your address`、`发件人联系地址`、`联系方式`、`请填写…`、`XX市XX路`、`某某`）、只有邮箱、只有网址、只有电话或数字，以及去掉空白后少于 8 个字符的文本。
- 当前已保存的值如果不满足规则：
  - 设置页地址字段上方会出现黄色警告，管理员修正并保存即可；非管理员会看到“请联系工作区管理员修正”。
  - 总览“下一步”显示“修正邮件页脚实体地址（当前像占位文本）”，不再显示“基础配置已完成”。
- 数据库侧 `edm_private.start_campaign_delivery` 仍只检查地址非空。**已保存的占位值在修正前仍会被发进邮件页脚**，见文末“后续”。

## 找出受影响的工作区（只读）

在 `content-up` 上执行以下只读查询（规则是 `mailingAddressProblem` 的近似版，结果需人工复核）：

```sql
select w.id, w.name, w.mailing_address, w.updated_at
from edm.workspaces w
where btrim(w.mailing_address) = ''
   or w.mailing_address ~* '(contact\s*info|\msenders?\M|your\s+(physical\s+|mailing\s+|postal\s+|street\s+)?address|placeholder|lorem\s+ipsum|\mexample\M|\mtbd\M|\mtodo\M)'
   or w.mailing_address ~ '(联系方式|联系信息|发件人(的)?(联系)?(地址|信息)|(你|您)的(联系|实体|邮寄)?地址|请(填写|输入)|填写真实|待(填写|补充|定)|占位|示例|暂无|某某)'
   or w.mailing_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   or length(regexp_replace(w.mailing_address, '\s', '', 'g')) < 8
order by w.updated_at desc;
```

查找对应管理员的联系邮箱：

```sql
select m.workspace_id, u.email
from edm.workspace_members m
join auth.users u on u.id = m.user_id
where m.workspace_id = any(array['<上一步查到的工作区 id>']::uuid[])
  and m.role = 'admin'
  and m.status = 'active';
```

## 管理员如何修正

1. 以该工作区管理员身份登录，进入 **设置 → 店铺信息**。
2. 在“邮件页脚实体地址”中填写真实的街道门牌地址（可中文或英文，例如 `88 Caoxi North Rd, Xuhui, Shanghai, China`），对照下方“页脚预览”确认。
3. 点击“保存设置”。之后新发出的营销邮件页脚会使用新地址；已发出的邮件无法更改。

运维侧只负责通知，不要直接 `update edm.workspaces`。

## 后续（不在本 PR 范围）

- 在 `start_campaign_delivery` 中加入同等的占位检查（需要 `edm` 迁移），让占位地址在正式发送前就被拦截。可与审计 P1-1 的“发送前检查清单”一起做。
- 活动和模板预览追加页脚块（审计 P1-2）。
