# Handoff: AriaAI 项目模块(项目列表 + 项目详情)

## Overview
本包是 AriaAI(面向咨询 / 审计行业的项目记忆型 AI 助手)中 **项目模块** 的设计交付,覆盖两大部分:
1. **项目列表页** —— 按「商务阶段(销售管线)」与「交付阶段」两大类组织的项目总览。
2. **项目详情页** —— 进入单个项目后的 9 个深度 Tab。

## About the Design Files
本包内的 `.html` / `.jsx` 文件是 **用 HTML + React(浏览器内 Babel)制作的设计参考稿**,用来表达**最终视觉与交互意图**,不是可直接照搬的生产代码。
任务是:**在目标代码库的既有技术栈中(React / Vue 等)、沿用其组件库与工程规范,把这些设计 1:1 复刻出来**。若尚无前端环境,则选择合适框架实现。JSX 仅用于表达结构与样式,不代表必须使用某种实现方式。

入口文件:`AriaAI 项目模块.html`(用浏览器双击即可预览;内部按 `<script>` 顺序加载各 `.jsx`)。设计画布由 `app-codex-slim.jsx` 的 `CX_ARTBOARDS` 驱动。

## Fidelity
**高保真(hifi)**。颜色、字号、间距、圆角、状态均为最终值,请按 `codex.css` 中的 design tokens 像素级复刻。深浅色双主题,默认浅色。

---

## Design Tokens(全部取自 `codex.css`,`.theme-codex`)

### 颜色 · 浅色
| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#FCFBF7` | 页面底 |
| `--bg-elev` | `#FFFFFF` | 卡片 / 列 |
| `--bg-sunken` | `#F4F1EA` | 凹陷区 |
| `--bg-tint` | `#F3F0E7` | 浅色块 / hover |
| `--ink` | `#1A1815` | 主文字 |
| `--ink-soft` | `#514C44` | 次文字 |
| `--ink-mute` | `#8B8270` | 弱文字 |
| `--ink-faint` | `#B8AE99` | 最弱 / 占位 |
| `--line` | `oklch(0.88 0.012 75)` | 常规描边 |
| `--line-soft` | `oklch(0.92 0.008 75)` | 行分隔 |
| `--line-strong` | `oklch(0.78 0.015 75)` | 强描边 |
| `--accent` | `oklch(0.5 0.07 150)` | 主强调(墨绿) |
| `--accent-ink` | `oklch(0.4 0.08 150)` | 强调文字 |
| `--accent-bg` | `oklch(0.96 0.02 150)` | 强调底 |
| `--good` | `oklch(0.55 0.08 150)` | 成功 / 正常 |
| `--warn` | `oklch(0.6 0.1 65)` | 警示 / 需关注 / 记忆待刷新 |
| `--bad` | `oklch(0.55 0.14 25)` | 风险 / 删除 |
| `--info` | `oklch(0.5 0.07 235)` | 信息 |

### 颜色 · 深色(`.theme-codex.dark`)
`--bg #15130F` · `--bg-elev #1C1916` · `--bg-tint #211D17` · `--ink #E8E2D1` · `--ink-soft #B5AC97` · `--ink-mute #7F7666` · `--ink-faint #524A3D` · `--accent oklch(0.72 0.08 150)`。其余状态色同色相、提亮。

### 字体
- UI:`"Inter", "Noto Sans SC", -apple-system, system-ui, sans-serif`,基准 13.5px
- 等宽(数字 / ID / 金额 / 日期):`"JetBrains Mono", "SF Mono", ui-monospace, monospace`,启用 tabular-nums

### 圆角(默认 soft)
`--r-sm 3px` · `--r-md 6px` · `--r-lg 10px` · `--r-pill 999px`(round 主题:6/10/16)

### 间距(默认 regular)
`--row-h 38px` · `--space-y 10px` · 区块内边距 32px / 帧内边距 40px。

---

## 屏 1 · 项目列表(`direction-codex-projects.jsx` → `CxProjects`)
画布尺寸 1440×920。外层是全局 `CxShell`(左侧导航 + 内容区)。

**结构(自上而下):**
1. **页头**:标题「项目空间」(22px / 500);副行(12.5px / `--ink-mute`):`N 个活跃项目 · 在谈管线 ¥X万 · M 个记忆待刷新`(记忆待刷新用 `--warn` + 圆点)。右侧:`全部客户 ▾`(可搜索的客户筛选下拉)、`搜索项目`、`+ 新建项目`(实色 `--ink` 底白字)。
2. **两个大类 Tab**(底部 1px 描边,选中项 2px 下划线着色 + 计数胶囊):
   - **商务阶段**(销售管线)
   - **交付阶段**(交付中 + 已归档)
3. **类目说明行**:左侧一句引导文字,右侧该类 KPI。
4. **内容区**(随 Tab 切换):

### 商务阶段 —— 5 列管线看板(等宽列,列内可滚)
列(从左到右即漏斗顺序),每列列头两行:**主名称 + 计数胶囊**(上)/ **副标题 + 金额小计**(下)。列头有 7px 阶段色圆点(`--accent`)。
| 阶段 key | 名称 | 副标题 |
|---|---|---|
| lead | 线索发现 | 初步接触 · 需求挖掘 |
| qualify | 商机确认 | 需求明确 · 预算确认 |
| proposal | 方案投标 | 方案设计 · 投标应标 |
| negotiation | 商务谈判 | 价格商议 · 条款确定 |
| contract | 合同签订 | 合同签署 · 正式立项 |

**项目卡(card)**:`--bg` 底 + `--line` 描边 + `--r-md`;内容:① 项目名(13.5px/500,最多 2 行,溢出省略)+ 记忆待刷新时名称右侧一个 `--warn` 小圆点(带 22% 同色光晕);② 客户首字头像(18px 圆)+ `负责人 · 更新时间`;③ 顶部 1px 分隔线后的页脚:左金额(等宽 13.5px,无金额显示「—」用 `--ink-faint`),右「下一步」文字(省略号)。hover:`translateY(-1px)`。

### 交付阶段 —— 单列表,两个子区
**子区标题**:`● 交付中 N ——————— ¥小计` / `● 已归档 N ———————`(圆点分别 `--good` / `--ink-faint`)。
列网格:`项目/客户 | 状态 | 进度 | 健康 | 金额 | 下一里程碑`。
- **交付中行**:36px 方头像 + 项目名(+ 记忆点)+ `客户 · 负责人`;状态胶囊「交付中」(`--good` 13% 底);进度(`done/total` + `%` + 进度条,进度条颜色随健康度:正常 `--good` / 需关注 `--warn` / 风险 `--bad`);健康度 `CxStatus` 胶囊(正常 good / 需关注 warn / 风险 bad);金额;下一里程碑 + 日期(逾期显示「逾期 N 天」)。
- **已归档行**(整体 opacity 0.8):状态胶囊「赢单交付」(`--good`)或「输单流失」(灰);进度列显示「已归档」;金额;`结案 YYYY-MM`。

**交互**:点 Tab 切换两类;客户筛选下拉支持搜索过滤、选中联动整页;行 / 卡 hover 态;均可点进项目详情。

---

## 屏 2 · 项目详情(共 9 个 Tab,共用 `CxProjectShell`)
`CxProjectShell`(`direction-codex-project-1.jsx`)= 顶部单条栏(56px):左「← 项目」面包屑 + 项目名 + 状态/记忆版本下拉;中部 Tab 导航;右侧仅 通知铃 + 头像(**已移除「项目内搜索」**)。选中 Tab:`--ink` 文字 + 2px `--accent` 下划线。

**Tab 顺序(务必保持)**:概览 · 项目对话 · 会前简报 · 项目记忆 · 干系人 · 活动 · 财务 · 文档。(另有「对话 + 文件预览」变体屏,1600 宽。)

| Tab key | 名称 | 组件 / 文件 |
|---|---|---|
| overview | 概览 | `CxProjectOverview`(project-1) |
| chat | 项目对话 | `CxProjectChat`(project-chat) |
| (preview) | 对话 + 文件预览 | `CxProjectChatPreview`(project-chat-preview) |
| briefing | 会前简报 | `CxProjectBriefing`(project-2) |
| memory | 项目记忆 | `CxProjectMemory`(project-2) |
| stakeholders | 干系人 | `CxProjectStakeholders`(project-3) |
| milestones | 活动 | `CxProjectMilestones`(project-3) |
| finance | 财务 | `CxProjectFinance`(project-4) |
| docs | 文档 | `CxProjectDocs`(project-4) |

### 概览(overview)
两栏:主列(AI 项目快照 / 记忆摘要 + 会前 30 秒卡 / 最近动态时间线)+ 右栏侧边:
- **项目档案**面板:基本信息(客户/行业/地区/合同金额/开始/预计签约/负责人),面板头部有 **「✎ 编辑」** 入口(编辑基本信息)。
- **项目成员**面板(原「项目团队」):成员列表 + 头部「管理」+ 底部「+ 添加 / 邀请成员」按钮。
- **项目管理**面板:三行操作 —— 编辑项目信息 / 归档项目 / **删除项目**(删除用 `--bad` 红色)。

### 财务(finance,**本次新增**)
自上而下:
1. **4 个 KPI 卡**:合同总额 ¥280万 / 已回款 ¥84万(good)/ 应收余额 ¥196万(accent)/ 预估毛利率 42%。
2. **回款进度**:分段条(已回款 `--good` / 已开票待回款 `--warn` 60% / 未到期 `--bg-tint`)+ 图例。
3. **收款计划表**:按里程碑节点(预付款 / POC 验收款 / 方案交付款 / 尾款),列:付款节点(含 已开票/待开票)| 比例 | 金额 | 计划日期 | 状态胶囊(已回款 good / 待回款 warn / 未到期 neutral)。
4. **右栏**:成本与毛利(人天 / 人力 / 差旅 / 成本合计 + 预估毛利高亮块)、开票记录(发票号 + 日期 + 金额 + 回款状态)。

### 文档(docs,**左右树形结构**)
两栏:`280px 左树 + 右内容`。
- **左:项目文件树**。头部「项目文件 + N 夹·M 份」;上传拖拽区(虚线框 + ＋);可展开树:`全部文件` 根 →（客户访谈 / 方案文档 / 会议纪要 / 交付物 / 合同·财务 / 自动生成）文件夹,展开后文件作为子项(文件类型角标 + 文件名)。展开符 ▾/▸,选中项 `--bg-tint` 底 + 2px `--accent` 左条;文件选中 `--accent-bg` 底。
- **右:内容区**。面包屑 `全部文件 › 当前文件夹 N`;右上「新建文件夹 / + 上传」;下方为当前文件夹的文档列表(类型角标 + 标题 + 摘要 2 行 + `上传人 · 来源 · #标签` + 大小 + 日期),点树或列表互相联动选中。
- 此树结构与「项目对话空间」的只读树(`CxRailSpace`,project-chat.jsx)同源,可复用。

### 其余 Tab
项目对话(含左侧空间树 + 只读对话 + 文件预览变体)、会前简报(4 卡体系 + AI 话术)、项目记忆(v12 + 健康度 + 锚点合并区)、干系人(影响力散点图 + 表)、活动(整体进度条 + 8 里程碑竖向时间线 + 待办,原名「推进」,**已改名「活动」**)。详见各 `.jsx`。

---

## State / 交互要点
- 项目列表:`cat`(presale/delivery)Tab 状态、`client` 客户筛选(可搜索)。
- 项目详情:`activeTab` 路由;各 Tab 内局部状态(如文档树 `expanded` / 选中 `sel`)。
- 主题:浅 / 深双主题(`.theme-codex` / `.dark`);密度(compact/regular/comfy)、圆角(sharp/soft/round)、强调色(moss/amber/azure/rose)为可调 token,生产可固定为默认(浅色 / regular / soft / moss)。

## Assets
无位图资源。图标为内联 SVG(见 `common.jsx` 的 `I(name)` 图标函数,line-icon 风格,stroke 1.5)。头像为客户/姓名首字色块。

## Files(按加载顺序)
`design-canvas.jsx`(画布外壳,仅用于本预览,生产不需要)、`tweaks-panel.jsx`(同前)、`common.jsx`(数据 + `I` 图标 + 基础组件)、`direction-codex-part1.jsx`(`CxShell` / `CxStatus` / `CxStatusByKey`)、`direction-codex-part2.jsx`、`direction-codex-project-1.jsx`(`CxProjectShell` / `CxPanel` / 概览)、`direction-codex-project-chat.jsx`、`direction-codex-project-chat-preview.jsx`、`direction-codex-project-2.jsx`、`direction-codex-project-3.jsx`、`direction-codex-project-4.jsx`(文档 + 财务)、`direction-codex-projects.jsx`(项目列表)、`app-codex-slim.jsx`(画布装配)、`codex.css`(全部 token + 主题)。

> 注:`design-canvas` / `tweaks-panel` 仅为设计预览的画布与调参工具,**实现时无需移植**;真正要复刻的是各 `Cx*` 页面组件 + `codex.css` 的 tokens。
