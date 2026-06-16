# Handoff: AriaAI Codex-style Frontend Redesign

## Overview

This bundle contains a complete UI redesign of **AriaAI** — an AI collaboration workspace for consulting / pre-sales / delivery teams. The redesign covers ~30 screens including the workspace dashboard, project chat with rich tool-call / artifact preview, deep project detail (7 tabs), full settings (12 pages), client / contact / skill / knowledge directories, plus auth and empty/error states.

The aesthetic is what we've been calling **"Codex style"** — quiet, info-dense, mono-first for numerical values, off-white parchment background, single low-saturation accent, hairline borders, no decorative gradients. Engineer-friendly without being terminal-coded.

## About the Design Files

The files in this bundle are **design references created as HTML/React-with-Babel prototypes**. They are not production code to copy directly into the existing AriaAI codebase. Your task is to **recreate these designs inside the existing `web/` React + TypeScript + Tailwind environment**, using its established patterns (the existing `api/client.ts`, hooks, i18n, lucide-react icons, design tokens in `index.css` / `tailwind.config`).

For each page in the existing app there is **already a real TSX file** under `web/src/pages/`. Your job is to refactor those files to match the new visual language and structure — not to start from scratch. The state management, SSE streaming, memory ops, skill calls, and API integration all stay.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and component anatomy are decided. Open the bundled HTML in a browser to see live behavior (tabs, dropdowns, hover states, animations). Recreate at this exact fidelity in the existing codebase. Where my design uses inline `style={{}}` and CSS variables, map those to Tailwind utility classes against the new tokens in `tailwind.config.ts`.

## Design Tokens

These come from `codex.css`. Add them to `tailwind.config.ts` `theme.extend` and to the global CSS as CSS variables.

### Color tokens — Light

| Token | Value | Use |
|---|---|---|
| `--bg`           | `#FCFBF7`                       | App background, page canvas |
| `--bg-elev`      | `#FFFFFF`                        | Elevated cards, panels, headers, inputs |
| `--bg-sunken`    | `#F4F1EA`                        | Sunken areas (page footers, secondary chrome) |
| `--bg-tint`      | `#F3F0E7`                        | Subtle tinted backgrounds (active rows, chip backgrounds) |
| `--ink`          | `#1A1815`                        | Primary text |
| `--ink-soft`     | `#514C44`                        | Secondary text |
| `--ink-mute`     | `#8B8270`                        | Muted / metadata text |
| `--ink-faint`    | `#B8AE99`                        | Faintest text, dividers |
| `--line`         | `oklch(0.88 0.012 75)`           | Hairline borders |
| `--line-soft`    | `oklch(0.92 0.008 75)`           | Soft inner-row dividers |
| `--line-strong`  | `oklch(0.78 0.015 75)`           | Stronger borders (dashed dropzones, checkbox outlines) |
| `--accent`       | `oklch(0.5 0.07 150)` (moss)     | Primary brand accent — status dots, links, CTAs |
| `--accent-soft`  | `oklch(0.92 0.04 150)`           | Soft accent for hover/bg fills |
| `--accent-ink`   | `oklch(0.4 0.08 150)`            | Accent text on accent backgrounds |
| `--accent-bg`    | `oklch(0.96 0.02 150)`           | Very faint accent background (chips, pinned rows) |
| `--good`         | `oklch(0.55 0.08 150)`           | Success status |
| `--warn`         | `oklch(0.6 0.1 65)`              | Warning status |
| `--bad`          | `oklch(0.55 0.14 25)`            | Error status |
| `--info`         | `oklch(0.5 0.07 235)`            | Informational status |

### Color tokens — Dark

| Token | Value |
|---|---|
| `--bg`           | `#15130F` |
| `--bg-elev`      | `#1C1916` |
| `--bg-sunken`    | `#100E0B` |
| `--bg-tint`      | `#211D17` |
| `--ink`          | `#E8E2D1` |
| `--ink-soft`     | `#B5AC97` |
| `--ink-mute`     | `#7F7666` |
| `--ink-faint`    | `#524A3D` |
| `--line`         | `oklch(0.26 0.008 75)` |
| `--line-soft`    | `oklch(0.22 0.005 75)` |
| `--line-strong`  | `oklch(0.32 0.012 75)` |
| `--accent`       | `oklch(0.72 0.08 150)` |
| `--accent-soft`  | `oklch(0.28 0.04 150)` |
| `--accent-ink`   | `oklch(0.82 0.08 150)` |
| `--accent-bg`    | `oklch(0.22 0.025 150)` |

### Accent alternatives (user-switchable)

| Name | Hue | Chroma |
|---|---|---|
| Moss (default) | 150 | 0.07 |
| Amber          | 75  | 0.12 |
| Azure          | 235 | 0.10 |
| Rose           | 15  | 0.12 |

### Typography

- **UI sans (primary):** `"Inter", "Noto Sans SC", -apple-system, system-ui, sans-serif`. Used for headings, body, controls. Apply `font-feature-settings: "cv11", "ss03"` for proper tabular and stylistic alternates.
- **Mono (numbers + identifiers ONLY):** `"JetBrains Mono", "SF Mono", ui-monospace, monospace`. Used for: file sizes, version numbers, currency, percentages, identifiers (id codes), timestamps, command shortcuts (⌘K). With `font-feature-settings: "ss01", "ss02", "calt", "zero"`. Use sparingly — never for body copy.
- **Base size:** 13.5px / line-height 1.6.
- **Display headings:** use `letter-spacing: -0.02em` for h1 (sizes 26–32px), `-0.015em` for h2 (18–22px), `-0.01em` for h3 (14–16px). Headings are sans-serif, weight 500 (not bold).

### Spacing & Radius

| Token | Value |
|---|---|
| `--r-sm` (sharp/soft/round) | 0 / 3px / 6px |
| `--r-md`                     | 0 / 6px / 10px |
| `--r-lg`                     | 2px / 10px / 16px |
| `--r-pill`                   | 0 / 999px / 999px |

Padding scale (used as variables; choose Tailwind equivalents like `p-2 p-4 p-5 p-6`):
- Card padding: 16–22px (most common)
- Page padding: 32–56px
- Section gap: 16–22px between cards
- Form row vertical padding: 14–16px

Density modes (controlled by `.density-compact / -regular / -comfy` on the root):
- The current implementation uses `zoom: 0.92 / 1.0 / 1.10` as a quick mechanism. For production, prefer rebuilding with rem-based spacing and a base-font multiplier on the root (`html.density-compact { font-size: 13px }` etc.) so layout scales properly without `zoom`.

### Shadows / Motion

- Cards generally use `border: 1px solid var(--line)` (no shadow). For floating panels (notification dropdown, avatar menu) use `box-shadow: 0 12px 36px -8px rgba(0,0,0,0.18), 0 0 0 1px var(--line)`.
- Animations are subtle. Key keyframes (all in `codex.css`):
  - `codex-pulse` — 2s pulse for live status indicators
  - `codex-shimmer` — skeleton loaders
  - `codex-progress` — top-loading bar
  - `codex-drift / float-a / float-b` — login page ambient orbs
  - `blink` — cursor blink on streaming AI responses
- Easing default: `ease-in-out`.

## Screens / Views

The full screen catalogue, grouped as they appear in `app-codex.jsx`. Each screen maps to an existing file in `web/src/pages/` — implement the redesign there.

### Top-level pages

| Screen | Artboard ID | Existing file | Notes |
|---|---|---|---|
| **Workspace** | `cx-workspace` | `pages/Workspace.tsx` | Greeting + Skill quick row (3 cards) + project list table + right rail (todos, milestones, recent conversations). Hairline-only chrome. |
| **Chat (global, scoped)** | `cx-chat` | `pages/chat/*` | Conversation list (left), thread (center), context+citations panel (right). Tool-call result rendered as a quiet `bg-elev` block, not a terminal output. |
| **Skills library** | `cx-skills` | `pages/skills/Skills.tsx` | Sidebar with categories + view filters + stats. Main: grouped rows by category (战略/销售/售前/交付/客户). |
| **Clients list** | `cx-clients` | `pages/clients/Clients.tsx` | Top stat strip (total/active/watch/dormant) + 7-column table with avatar bubble + name/short + industry + region + projects (num) + last contact + status. |
| **Contacts directory** | `cx-contacts` | `pages/contacts/Contacts.tsx` | Filter pills + table: name/role + client + level (决策/影响/执行) + phone/email recorded indicators + last contact. |
| **Knowledge base** | `cx-knowledge` | `pages/knowledge/*` | Filter pills + doc rows (type badge, title, tags, size, time) + right rail (index stats, distribution bars, recent ingest). |

### Project detail — deep page, 7 tabs

The project shell has **a single unified top bar** (back chip + project name with status + tab nav + utilities) — NOT a global nav + tab nav double layer. This is critical: it removes the redundant chrome row.

| Tab | Artboard ID | Existing file(s) | Notes |
|---|---|---|---|
| **项目对话 (Chat)** | `cx-proj-chat` | `pages/projects/ProjectChatTab.tsx`, `ProjectChatMainPanel.tsx`, `ProjectChatSidebar.tsx`, `ProjectChatMessages.tsx`, `ProjectChatMessageBubble.tsx`, `ProjectChatToolCallCard.tsx`, `ProjectChatPlanCard.tsx`, `ProjectChatArtifactCard.tsx`, `ProjectChatInput.tsx` | THE main work surface. 2 columns: left rail with **switchable tabs (对话 / 空间)**, center thread. NO right context panel. Thread renders: user bubble (right-aligned, ink bg) → Aria bubble (left, accent dot) with tool-call card (collapsible "检索了 3 个数据源 · 1.01s") + plan card with check/dot progress + Markdown answer with footnote citations [1][2] + artifact card (MD/PDF badge + filename + preview/save buttons) + action chips (重新生成 / 固定为锚点 / 加到笔记 / 沉淀到项目记忆). Composer at bottom with active context chips. |
| **概览 (Overview)** | `cx-proj-overview` | `pages/projects/ProjectAnchorsCard.tsx` + new | Three vertically-stacked panels: AI snapshot card (one-liner + 3 highlight cards), 2-col grid (memory excerpt + briefing preview), activity timeline. Right rail: project meta (client/industry/owner...), key stakeholders preview, team. |
| **会前简报 (Briefing)** | `cx-proj-briefing` | `pages/projects/ProjectBriefingTab.tsx` | Meeting card hero (gradient `accent-bg → bg-elev`) with next meeting date + "30-second card" headline + 生成话术 / 去对话准备 CTAs. 2×2 grid of Say / Avoid / Confirm / Lessons cards, each with numbered items. AI-generated script panel. Right rail: stakeholders attendance, 近期节奏, 资料依据. |
| **项目记忆 (Memory + Anchors merged)** | `cx-proj-memory` | `pages/projects/ProjectAnchorsTab.tsx` + memory section | Header strip (v12 + 已同步 + 历史版本/对比/重新汇总). **Pinned anchors panel above structured memory** — 3 columns (风险锚点 / 待确认问题 / 干系人提示) with tone-colored dots. Then 5 structured memory cards (客户背景/核心痛点/我方方案/决策链/下一步), each with body + sources chips. Right rail: 记忆健康度 (92/100), 自动更新建议, 版本历史. |
| **干系人 (Stakeholders)** | `cx-proj-stakeholders` | `pages/projects/ClientStakeholdersStructuredCard.tsx` | Influence map (scatter — x: influence, y: support, dot size: support strength). Table of 6 stakeholders. Right rail: decision structure tree, communication cadence advice, AI tip card. |
| **推进 (Milestones + Todos merged)** | `cx-proj-milestones` | `pages/projects/Milestones*`, `Todos*` | Stacked: progress strip (37% overall + day-range), vertical timeline of 8 milestones (done/in-progress/next/planned dots), then "本周待办" panel under it. Right rail: 风险预警, 速度指标. |
| **文档 (Documents)** | `cx-proj-docs` | `pages/projects/Docs*` | Filter pills (本地上传/知识库链接/Skill 输出/自动生成) + doc list with type badge + title + summary + tags + meta. Right rail: source distribution, high-citation docs. |

**Note: 笔记 was removed** (daily notes belong in chat). **锚点 merged into 项目记忆**. **里程碑 + 待办 merged into 推进**. Tabs collapsed from 10 to 7.

#### Project chat — file preview variant

`cx-proj-chat-preview` shows the chat with a right-side **markdown file preview pane** that opens when the user clicks an artifact MD card in the thread. 3 columns: left rail (260), center thread (1fr), preview pane (480). Preview pane has: file header (type badge + filename + size + close X), tabs (预览/源码/目录/版本), rendered Markdown content. Implement as a panel that slides in.

#### Project chat — left rail "空间" view

The left rail can switch between **对话** (conversation list) and **空间** (project space). 空间 is a **file-explorer-style tree** with:
- Top: search + drag-drop **upload zone** ("拖入文件或点击上传 · PDF/DOC/MD/TXT · ≤ 50 MB")
- Tree branches (collapsible with ▾/▸):
  - 项目记忆 v12 → current/history/health
  - 锚点 (6) → risks/questions/stakeholder
  - 文档 (12) → nested subfolders (客户访谈/方法论/行业资料) + loose files
  - 本会话产出 (1) → currently-being-edited MD file (accent background)
- Bottom: storage usage bar (23 MB / 1 GB)

### Secondary / detail pages

| Screen | Artboard ID | Existing file | Notes |
|---|---|---|---|
| **New project wizard** | `cx-new-project` | `pages/projects/NewProject.tsx`, `NewProjectBasicsForm.tsx`, `NewProjectClientSelect.tsx`, `NewProjectStageSelector.tsx`, `NewProjectAIPanel.tsx` | 4-step indicator at top. Form panels (基础信息 / 客户与阶段 / 项目团队). Right side **AI assist panel** (gradient `accent-bg → bg-elev`) with live status (识别客户, 找到 Skill, 生成记忆草稿) + recommended skills + similar projects. |
| **Skill detail** | `cx-skill-detail` | `pages/skills/SkillForm.tsx` (likely needs new detail view) | Hero with skill icon + name + description. Tabs: 概览 / 提示词模板 / 调用历史 / 设置. Overview: 4 stat cards, "它会做什么" numbered list, "需要哪些上下文" 2×2 readiness grid (✓ checks + 待补 outlines), 示例输出, 最近调用 + meta. |

### Settings — 12 pages (left rail grouped: 个人 / AI 与记忆 / 管理员)

Settings shell wraps the regular CxShell. Left sidebar shows grouped nav with current active item indicated by `bg-tint` background + 2px accent bar on the left.

| Tab | Artboard ID | Existing file |
|---|---|---|
| 个人资料 | `cx-set-profile` | `settings/ProfileSettings.tsx` |
| 外观 (NEW) | `cx-set-appearance` | new — theme / accent / density / radius |
| 语言与时区 | `cx-set-language` | `settings/LanguageSettings.tsx` |
| AI 模型 | `cx-set-ai` | `settings/AISettings.tsx` |
| 项目记忆 | `cx-set-proj-mem` | `settings/ProjectMemorySettings.tsx` |
| 客户记忆 | `cx-set-client-mem` | `settings/ClientMemorySettings.tsx` |
| 记忆任务中心 | `cx-set-mem-ops` | `settings/MemoryOperationsSettings.tsx` |
| API 限流提醒 | `cx-set-api` | `settings/ApiLimitsSettings.tsx` |
| 迁移状态 | `cx-set-migrations` | `settings/MigrationSettings.tsx` |
| 消息管理 (NEW) | `cx-set-messages` | `settings/MessageSettings.tsx` (or new) |
| 服务器配置 | `cx-set-server` | `settings/ServerSettings.tsx` |
| 用户管理 | `cx-set-users` | `settings/UsersSettings.tsx` |
| 关于 | `cx-set-about` | `settings/AboutSettings.tsx` — has internal tabs (概览 / 更新日志 / 许可说明); overview includes the migration status panel for quick visibility |

The detailed structure of each settings page is captured in the corresponding direction-codex-settings*.jsx files.

### Entry & empty / loading states

| Screen | Artboard ID | Notes |
|---|---|---|
| **Login** | `cx-login` | Split screen. Left: ambient quiet panel with logo + 12px accent line + 44px hero "一个安静的 AI 协作工作台" + paragraph + footer line. Background: faint animated dot grid (`codex-drift`) + 2 floating accent orbs (`codex-float-a` / `codex-float-b`). NO SSO button, NO system status indicators. Right: email + password + 登录. Nothing else. |
| **Welcome / Onboarding** | `cx-welcome` | Personalization split: left form (称呼 + 4 preference pill groups) + 完成设置 CTA. Right: live preview of how Aria will respond, with 3 "setting → effect" chips below. |
| **Loading / skeleton** | `cx-loading` | Top progress bar (animated 40% width sliding) + shimmer skeleton blocks matching the workspace layout. Use `CxSkeleton` component. |
| **Notifications dropdown + toasts** | `cx-notify` | When user clicks the bell icon, a 420px dropdown opens below it with: header (count badge + 全部标为已读), 4 filter tabs (全部 / 未读 / 提及 / 系统), notification list with type icon + title + description + project chip + timestamp + unread indicator dot. Footer: 消息设置 + 打开消息中心. Toast stack appears bottom-right with success/error toasts (3px accent-color left border). |
| **Avatar menu** | `cx-avatar` | When user clicks top-right avatar, 300px dropdown opens with: user identity card (avatar + name + email + online status), status switcher (在线 / 忙碌 · 勿扰 / 离开), menu items (个人资料 / 外观 / 偏好与设置 ⌘, / 消息中心 / API 密钥), workspace switcher, footer (帮助与文档 / 退出登录). |
| **503 service down** | `cx-503` | Header status (脉冲 系统维护中), big 503 number (accent-bg color), explanation, auto-retry card with countdown + 立即重试, **system component status table** (Web 前端 / API 服务 / AI 模型代理 / 向量检索 / 记忆任务队列 / 文件存储, each with status pill and optional note), bottom CTA (查看完整状态页 / 订阅恢复通知 / 事故编号). |
| **404 not found** | `cx-404` | Centered. Big 404 in accent-bg, headline 这里什么也没有, soft explanation, 返回 / 回到工作台 buttons, search hint at bottom. |

## Interactions & Behavior

### Navigation
- The top nav is a **single bar inside project context** (project name with status + tab pills + utilities). Tabs use a 2px accent bottom border on the active tab.
- Outside a project, the standard top bar has the Aria logo + nav pills + search + bell + avatar.
- The **logo** is a small dark square (`var(--ink)` background, `var(--bg-elev)` text) with lowercase mono "a", radius 5px. Paired with a small "Aria" wordmark. Component: `CxLogo` (see `direction-codex-part1.jsx`).

### Tweaks panel
A floating panel (already implemented in this prototype via `tweaks-panel.jsx`) lets users switch theme / density / accent / radius. In production these should be controlled by the new **外观** settings page tied to user preferences (persisted server-side).

### Chat streaming
- Aria responses stream token-by-token. The blinking ▍ cursor (CSS class `cursor-blink`) appears at the end while streaming.
- Status pills with `pulse` prop animate the dot using `codex-pulse` keyframe.
- Tool calls render as collapsible cards with `[✓] 检索了 N 个数据源 · 1.01s` summary + expandable detail.
- Plan cards are accent-tinted (`bg-elev` mixed with `accent-bg`) and show step progress with check icons (done) and dots (current/upcoming).

### Project chat file preview
- Clicking an artifact card (MD/PDF/DOC file) opens a right-side preview pane (slides in / takes 480px).
- The artifact card visually indicates "active" via accent border + 4px outer accent ring.
- Preview pane has its own tabs: 预览 / 源码 / 目录 / 版本.

### Hover/focus states
- Row hover: add `var(--bg-tint)` background (use `.row-hov` class or Tailwind `hover:bg-[token]`).
- Input focus: 1px accent outline with 1px offset (see `.codex-input:focus`).
- Buttons inverted on press (subtle darken).

### Status conventions
| Tone | Color | When to use |
|---|---|---|
| neutral | `--ink-mute` | Default / quiet status |
| accent  | `--accent`   | Live / in-progress / current |
| good    | `--good`     | Success, healthy, on-track |
| warn    | `--warn`     | Attention required, near-limit |
| bad     | `--bad`      | Error, failure, blocked |
| info    | `--info`     | Informational |
| mute    | `--ink-faint`| Dormant / archived |

All status pills use a 5–7px filled dot + label, with `pulse` animation optional for live states.

## State Management

Reuse the existing React Query / useState / Zustand patterns already in `web/src/`. New state needs:
- **Tweaks → Settings 外观**: persist theme / accent / density / radius per-user. Backend endpoint or local-storage if no backend support yet. Apply via CSS classes on `<html>` or app root.
- **Project chat left rail mode**: 对话 / 空间 toggle, persist per-project.
- **File preview pane**: open state (which file ID, which tab), tied to selected artifact in conversation.
- **Notification dropdown**: open state for the bell, filter selection. Existing message API drives the data.

## Assets

- **Icons**: all `<I name="...">` references map to existing `lucide-react` icon names: `home, chat, wrench, folder, building, user, book, settings, bell, search, plus, arrow-right, arrow-up-right, chevron-right, chevron-down, sparkle, target, zap, clock, calendar, send, paperclip, file, check, dot, more, filter, grid, list, logout, star, tag, lock, mail, moon, sun`. Use the corresponding lucide-react component directly.
- **Fonts**: load `Inter`, `JetBrains Mono`, `Noto Sans SC` via your existing font pipeline (already in `web/index.html` likely).
- **No bitmap assets** required — everything is type, vector icons, and CSS.

## Implementation Order (recommended)

1. **Design tokens migration** (0.5 day) — add the color / radius / type tokens to `tailwind.config.ts`, write a `globals.css` defining the CSS vars (light + dark), update `:root` and `[data-theme="dark"]`.
2. **Core primitives** (1 day) — implement reusable components: `CxLogo`, `CxStatus` (status pill with tone + pulse), `CxPanel` (titled card), `CxFormRow`, `CxSwitch`, `CxSkeleton`. Place in `web/src/components/`.
3. **Login + Welcome** (0.5 day) — refactor `pages/Login.tsx`, `pages/Welcome.tsx`, `pages/PreferenceOnboarding.tsx`. Add the ambient animations.
4. **Settings · Appearance** (0.5 day) — new page; wire theme/accent/density/radius to root classes, persist to user preferences.
5. **Settings · all other pages** (2 days) — refactor existing TSX. Use the bundled JSX as the structural reference.
6. **Workspace + Skills + Clients + Contacts + Knowledge** (2 days) — directory pages, mostly visual refactor.
7. **Project chat + file preview + left rail "空间"** (3–4 days) — highest user value, most novel components. Reuse existing SSE / tool-call / artifact data plumbing.
8. **Project detail 7 tabs** (4–5 days) — the deepest redesign. Briefing (4-card system + AI script), Memory (with merged Anchors as a featured pinned section), Stakeholders (with influence-map scatter), 推进 (timeline + todos merged), Docs.
9. **Empty / loading / 503 / notifications dropdown / avatar menu** (1 day) — polish and edge states.

## Files in this bundle

Open `AriaAI Codex 风格.html` in a browser to see the full design canvas with all 30+ screens.

| File | Contents |
|---|---|
| `AriaAI Codex 风格.html` | Main HTML entry — loads all JSX via `<script type="text/babel">` |
| `codex.css` | Design tokens + animations (single source of truth for theme) |
| `common.jsx` | Shared mock data (projects, skills, clients, todos, milestones, navigation items) + `<I/>` icon set + small atoms (`Avatar`, etc) |
| `design-canvas.jsx` | Tool starter for the pan/zoom design canvas presenting all artboards |
| `tweaks-panel.jsx` | Tool starter for the floating Tweaks panel |
| `app-codex.jsx` | Root app — defines all artboards, sections, Tweaks wiring |
| `direction-codex-part1.jsx` | `CxShell` (global top-nav frame), `CxLogo`, `CxStatus`, `CxHead`, Workspace, Chat, Project Detail Overview |
| `direction-codex-part2.jsx` | Skills, Clients, Knowledge, Settings shell base, Login |
| `direction-codex-project-1.jsx` | `CxProjectShell` (single-bar project nav), `CxPanel`, mock PROJECT data, Project Overview |
| `direction-codex-project-2.jsx` | Project Briefing tab, Memory (with merged Anchors), legacy standalone Anchors |
| `direction-codex-project-3.jsx` | Stakeholders, Milestones (with merged Todos), legacy standalone Todos |
| `direction-codex-project-4.jsx` | Project Docs, legacy standalone Notes |
| `direction-codex-project-chat.jsx` | Project Chat with `CxRailChats` + `CxRailSpace` (tree + upload) |
| `direction-codex-project-chat-preview.jsx` | Variant with right-side Markdown preview pane |
| `direction-codex-more-1.jsx` | New Project wizard, (deprecated) Client Detail |
| `direction-codex-more-2.jsx` | Skill Detail, Welcome / personalization onboarding, Contacts, 404, 503 |
| `direction-codex-settings.jsx` | Settings shell + 11 settings pages (initial versions) |
| `direction-codex-settings-v2.jsx` | Refined settings pages matching real product layout: Project Memory, Client Memory, Memory Ops, Messages, Server Config, Appearance |
| `direction-codex-states.jsx` | Loading skeleton, Notifications dropdown, Avatar menu |

## Notes for the developer

- The bundled HTML uses Babel-transpiled JSX in the browser via `<script type="text/babel">`. This is **only for the prototype**. In the real codebase, write standard TSX and let Vite compile it.
- All Chinese microcopy (UI labels, helper text, empty states) is final — copy verbatim. The English / mono labels (`fileSize`, `v12`, `42ms`) are also final.
- Where the prototype uses inline `style={{ }}` with hex colors or `var(--...)`, replace with Tailwind utility classes against the new tokens.
- The CSS `zoom` density mechanism is a prototype shortcut — for production rebuild density using `rem` units throughout and adjust the root font-size.
- Project memory's structured-data shape and stakeholder data shape should match the existing TypeScript types in `web/src/types/api.ts` — adjust visual rendering to those exact field names.
- Status dots / chips should be implemented as a single shared `Status` component to keep tone usage consistent.

— End of handoff —
