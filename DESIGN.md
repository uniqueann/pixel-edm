---
name: 卖家邮局 Pixel EDM
description: 暖灰与深蓝构成的日常邮件运营工作台
colors:
  background: "#f6f6f3"
  foreground: "#1c2b45"
  card: "#ffffff"
  primary: "#1c2b45"
  primary-foreground: "#ffffff"
  muted: "#eeefec"
  muted-foreground: "#5b6478"
  border: "#e5e4de"
  input: "#858c99"
  success: "#2f6e52"
  success-tint: "#edf5ef"
  warning: "#805b17"
  warning-tint: "#fff8eb"
  danger: "#b23a2e"
  danger-tint: "#fbeae7"
  dark-background: "#0d121c"
  dark-foreground: "#e6edf7"
  dark-card: "#151c2a"
  dark-primary: "#f1f5f9"
  dark-primary-foreground: "#0d121c"
  dark-muted-foreground: "#8c9cb6"
  dark-input: "#61718a"
  dark-focus: "#38bdf8"
  dark-success: "#34d399"
  dark-warning: "#f1d28c"
  dark-danger: "#fca5a5"
typography:
  headline:
    fontFamily: 'Fraunces, "PingFang SC", serif'
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: 'Fraunces, "PingFang SC", serif'
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: '"IBM Plex Sans", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  description:
    fontSize: "0.875rem"
    lineHeight: 1.7
  label:
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  metadata:
    fontSize: "0.8125rem"
    lineHeight: 1.6
  dense-metadata:
    fontSize: "0.75rem"
    lineHeight: 1.6
  reading:
    fontSize: "1rem"
    lineHeight: 1.7
  task-title:
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  compact: "9px"
  control: "11px"
  inset: "12px"
  card: "14px"
  editor: "20px"
spacing:
  related: "8px"
  compact: "12px"
  group: "16px"
  surface: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    height: "2.5rem"
  input:
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "2.5rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
  badge-success:
    backgroundColor: "{colors.success-tint}"
    textColor: "{colors.success}"
  notice-warning:
    backgroundColor: "{colors.warning-tint}"
    textColor: "{colors.warning}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
---

# 卖家邮局设计规范

## Overview

**Creative North Star: "安静、可靠的卖家邮局"**

沿用已有的暖灰底、深蓝文字、信封标识和 Fraunces / IBM Plex 字体组合。品牌通过字形、留白和克制的操作层级呈现。工作台以快速识别任务、准确理解状态、放心完成操作为目标；帮助页面以阅读与检索为目标。

本文件由当前实现提取。运行时来源为 `src/app/globals.css`、`src/components/ui/` 和各业务 CSS Module；修改运行时规则时同步更新本文件。前置 YAML 是当前规则的机器可读镜像，不参与运行时计算。具体页面的步骤、权限、完成条件与业务文案仍以原实现为准。

**Key Characteristics:**

- 同类页头、查找区域和反馈采用共同语法。
- 保留客户数据行、模板网格、活动任务卡的不同密度。
- 明暗主题使用语义变量，状态始终附带文字。
- 复杂编辑器保留独立滚动、未保存保护和键盘避让。

## Colors

### Primary

深蓝用于主要操作、正文和选中导航。深色主题的主要操作反转为浅色填充，前景回到深底。主色不代表“已送达”或“可正式发送”。

### Neutral

暖灰承载页面，白色或深蓝灰承载卡片，muted 承载辅助区域。普通卡片边框负责分区；输入边框使用独立的 input 变量，保证字段可识别。次要文字使用 muted-foreground，避免通过任意降低 opacity 表达层级。

### 语义状态

| 语义 | 运行时变量 | 用法 |
| --- | --- | --- |
| 成功 | `--green`、`--success-tint`、`--success-border` | 已订阅、通道已验证、活动已完成；保留各自准确的文字 |
| 注意 | `--warning`、`--warning-tint`、`--warning-border` | 待核对、已锁定但未发送、额度提醒、配置注意事项 |
| 错误 | `--danger-foreground`、`--danger-tint`、`--danger-border` | 错误文字与错误标签；危险按钮继续使用 destructive 填充 |
| 信息与处理中 | foreground、muted、secondary | 说明、草稿、等待和处理中；附带明确状态文字 |
| 身份与分类 | secondary 或 outline | 角色、所有者、模板分类和客户标签；不暗示警告或错误 |

浅色、深色的背景、文字、边框和焦点均由 `:root` / `.dark` 成组切换。深色危险提示的文字与危险按钮填充分离，避免把同一个红色用于所有背景。

**The 状态准确 Rule.** “服务商已接收”“通道已验证”“已送达”“已订阅”“已确认名单”分别描述不同事实；共享颜色不能替代文字，更不能合并业务状态。

## Typography

**Display Font:** Fraunces，中文回退到 PingFang SC；用于品牌、页面标题与数字概览。

**Body Font:** IBM Plex Sans，中文回退到 PingFang SC / Microsoft YaHei；加载已实际使用的 400、500、600 字重。

**Label/Mono Font:** IBM Plex Mono 仅用于变量、地址、技术值及邮件纯文本预览。

### 层级

- 页面标题使用 headline；区块与普通弹窗标题使用 title。
- 较长的任务解释和字段帮助采用 description 或原有辅助说明。页面说明限制在约 72ch，按语义自然换行。
- 日常工作台正文保留原有的紧凑 body；列表值和字段标签通常为 14px，计数与说明为 13px，时间、类型和次级元数据可为 12px。
- 列表搜索与筛选的名称通过关联标签保留给辅助技术，视觉上使用搜索提示和当前选项识别用途，不再单独占据一行。普通表单继续显示 label 标签，允许换行，不使用 `leading-none` 压缩中文。
- 页面标题与长名称允许任意断行；密集数据行可截断，完整内容仍可通过编辑或详情查看。数量使用等宽数字，单位跟随数量。
- 总览指标保留 Fraunces（28px / 1.4 / 600），与页头旁 13px 的记录计数区分用途。
- 手机及粗指针场景下，输入与选择控件使用 16px，避免输入时的意外放大。

模板编辑器、导入步骤和准备清单可用 20px 区块标题，区分长任务中的主要阶段；卡片中的活动名采用无衬线的紧凑标题。这些是任务层级，不另建页面标题体系。

现有活动名保留 17px，变量按钮的等宽技术标识保留 11px；前者服务任务卡的紧凑扫描，后者位于已有文字解释旁，均不推广为普通页面标题或字段标签。密集元数据、长表单正文和阶段标题分别使用 dense-metadata、reading、task-title。

## Layout

- 工作台最大宽度为 1180px；内容默认边距为上下 24px、左右 20px。外壳保留现有窄屏顶栏和“更多”导航。
- 页面头部使用 `PageHeader`：标题旁放计数或类型，说明紧随标题，主要操作位于右侧；窄屏自然换到下一行。没有操作时不保留空白操作栏。
- 搜索与筛选使用 `ListToolbar` / `FilterField`：先搜索，再范围和业务筛选。工具栏不加外层卡片、边框或内边距，行间距 8px、列间距 12px，与后续列表相隔 16px；宽屏通常为一行 40px 控件。关联标签使用 `sr-only`，筛选选项与已应用摘要继续呈现当前条件。
- 640px 以下搜索独占一行，常规筛选以 9rem 为换行参考宽度，保持完整点击区；活动页保留 767px 以下搜索加两列筛选的任务布局。手机控件至少 44px 高，不通过缩小文字或点击区压缩搜索区域。
- 关联元素一般相隔 8px，控件或紧凑分组相隔 12px，字段与组之间 16px，表面内边距 20px，页面主要区块之间 24px。
- 分页使用 `ListPagination`，摘要与每页数量居中，前后页操作位于两侧。420px 以下摘要独占一行。
- 桌面紧凑数据行保留较小间距；手机转为可换行的卡片，不强制所有列表采用相同列数。
- 640px 以下或粗指针设备，常规交互目标至少 44×44px。正文中的行内链接按文本链接处理；独立导航、菜单、关闭、搜索清除与页内跳转入口有完整点击区。
- 顶栏始终使用不透明背景；设置锚点继续让出实际测量的顶栏和引导条高度。
- 放大后工作台实际容器不足 300px 时，顶栏压缩装饰并纵向排列账号文字，保留工作区、套餐、角色、主题和退出操作；内容边距收敛到 12px，指标单列、准备清单内边距减少，保持文字与按钮可读。正常 320px 以上手机布局不受此例外影响。
- 测试边界包括 320 / 390 / 820 / 1440px、短视口、长名称、200% 根字号以及模拟键盘收缩。根字号模拟不等同于浏览器原生缩放或真实软键盘。

## Elevation & Depth

普通内容卡片以单层边框建立层级，默认不叠加阴影。指标卡保留轻微悬停反馈；认证容器和弹窗保留原有的柔和阴影，表示独立任务或浮层。焦点环表达键盘位置，与卡片阴影职责不同。减少动态效果时关闭共享控件的过渡、骨架闪动和指标位移，状态文字仍正常更新。

## Shapes

普通控件采用 control 圆角，卡片和普通弹窗采用 card 圆角；认证容器、底部弹窗和复杂编辑器保留 editor 圆角。状态标签、筛选摘要可以采用胶囊形状。输入与选择框使用相同边框语义；不得通过多个局部高度补丁建立新的常规尺寸。

原生列表筛选与专用编辑区的小控件保留 compact 圆角，高度仍遵循常规/紧凑/触控规则；次级内容分组保留 inset。导入进度条的 4px、导入表格结果标签的 6px、通道内嵌表单错误的 8px 属于局部信息几何，继续留在业务模块；不将它们创建为新的全局运行时 token，也不仅因数值不同而判为问题。

## Components

### 按钮与字段

- `Button` 的 default 为常规主操作；outline 为次操作；secondary 为上下文中的常用操作；ghost 用于低强调操作；destructive 仅用于有危险后果的提交。
- 默认按钮与字段高 40px，桌面密集行使用 `size="sm"` 的 32px 变体；图标保持约 16px。手机和粗指针点击区统一扩展至至少 44px，长按钮文字可换行。
- 模板、通道和导入长表单可保持桌面 44px 控件；这是持续编辑任务的密度选择。
- 输入、选择与按钮保留焦点、禁用、加载与错误反馈。加载文案继续来自原操作状态，不新增业务状态机。
- 字段错误就近显示，错误文字为 13px / 1.6；通过 `aria-invalid` 和 `aria-describedby` 关联错误与帮助。空错误节点不占空间。新增必填标记必须与校验要求相符，不改变原校验行为。

### 状态与提示

- `Badge` 的 success、warning、destructive 共享主题语义；普通身份、分类使用 secondary 或 outline。不可交互标签不扩大到按钮尺寸。
- `Notice` 用于持久信息、注意、成功或错误，提供相应图标与文字区域。调用方决定是否需要 `role="alert"` 或 `role="status"`，避免将整页静态说明全部即时播报。
- 字段错误解释本次输入问题；持久结果解释已发生事实及恢复入口；toast 用于短暂确认。不能用 toast 取代未知结果核对或手动恢复入口。
- `EmptyState` 的 empty、search、restricted 分别服务首次空态、无匹配结果、权限受限；布局与文字层级共享，描述和操作仍按真实场景提供。

### 弹窗

普通弹窗统一靠左标题、相邻说明、内容与操作组之间 16px、操作间 8px，关闭按钮为 44px 点击区。桌面取消在前、确认在后；窄屏确认按钮显示在取消上方，保留现有焦点顺序和焦点恢复。

模板编辑器、通道配置、客户导入和活动统计可以使用专用布局。保留 `visualViewport` 修正、独立滚动体、保存操作区、通道显式 8px 间隔、未保存保护、Escape 与遮罩约束，禁止仅为样式整齐而重写这些机制。

### 导航与容器

导航保留文字与 `aria-current`。Radix 菜单同时提供鼠标悬停和 `data-highlighted` 键盘高亮；关闭后恢复触发器焦点。设置分区、帮助目录保持原深链。

`Card` 负责外层纵向内边距，`CardContent` 负责横向内边距；避免在普通卡片内部再次叠加相同的顶部留白。紧凑数据行和专用编辑器可显式覆盖 padding。

## Do's and Don'ts

### Do:

- **Do** 先判断语义是否相同，再共享组件或尺寸；新增同类页面直接复用已有页头、工具栏和反馈组件。
- **Do** 在桌面、手机、明暗主题下同时检查长文本、焦点、空态与失败恢复。
- **Do** 为专用编辑器、数据行、模板网格与系统页保留有任务依据的差异。
- **Do** 把源码检查、计算样式、本地截图、浏览器模拟、实体设备和线上验证分开记录。

### Don't:

- **Don't** 将管理员身份、自定义标签绘成警告或错误状态。
- **Don't** 为统一视觉而改动订阅、去重、名单锁定、发送权限、额度或统计口径。
- **Don't** 将站点样式规则写入实际邮件 HTML、邮件主题或收件人模板。
- **Don't** 覆盖复杂弹窗的滚动、未保存保护、焦点恢复与键盘避让。
- **Don't** 复制局部样式后另造一套常规控件高度，或为一次性排版创建全局 token。
