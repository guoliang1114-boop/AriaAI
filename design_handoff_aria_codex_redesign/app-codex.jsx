// app-codex.jsx — Codex style app root

const CX_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": false,
  "density": "regular",
  "radius": "soft",
  "accent": "moss"
}/*EDITMODE-END*/;

const CX_ACCENTS = {
  moss:   { name: "moss",   l: 0.5,  c: 0.07, h: 150, dl: 0.72 },
  amber:  { name: "amber",  l: 0.58, c: 0.12, h: 75,  dl: 0.78 },
  azure:  { name: "azure",  l: 0.5,  c: 0.1,  h: 235, dl: 0.76 },
  rose:   { name: "rose",   l: 0.55, c: 0.12, h: 15,  dl: 0.76 },
};

function applyCxAccent(key, dark) {
  const p = CX_ACCENTS[key] || CX_ACCENTS.moss;
  if (dark) {
    return {
      "--accent": `oklch(${p.dl} ${p.c} ${p.h})`,
      "--accent-soft": `oklch(0.28 ${p.c * 0.55} ${p.h})`,
      "--accent-ink": `oklch(0.84 ${p.c * 0.9} ${p.h})`,
      "--accent-bg": `oklch(0.22 ${p.c * 0.45} ${p.h})`,
    };
  }
  return {
    "--accent": `oklch(${p.l} ${p.c} ${p.h})`,
    "--accent-soft": `oklch(0.92 ${p.c * 0.4} ${p.h})`,
    "--accent-ink": `oklch(0.4 ${p.c * 1.1} ${p.h})`,
    "--accent-bg": `oklch(0.96 ${p.c * 0.3} ${p.h})`,
  };
}

function CxThemed({ t, children }) {
  return (
    <div className={`theme-codex density-${t.density} radius-${t.radius} ${t.dark ? "dark" : ""}`}
         style={{ width: "100%", height: "100%", ...applyCxAccent(t.accent, t.dark) }}>
      {children}
    </div>
  );
}

const CX_ARTBOARDS = [
  // -- Top-level pages
  { id: "cx-workspace", label: "Workspace · 工作台",     w: 1440, h: 920, render: () => <CxWorkspace /> },
  { id: "cx-chat",      label: "Chat · 项目对话",         w: 1440, h: 920, render: () => <CxChat /> },

  // -- Project Detail (deep dive — 8 tabs)
  { id: "cx-proj-chat",         label: "项目详情 · 项目对话", w: 1440, h: 960, render: () => <CxProjectChat /> },
  { id: "cx-proj-chat-preview", label: "项目详情 · 对话 + 文件预览", w: 1600, h: 960, render: () => <CxProjectChatPreview /> },
  { id: "cx-proj-overview",     label: "项目详情 · 概览",     w: 1440, h: 960, render: () => <CxProjectOverview /> },
  { id: "cx-proj-briefing",     label: "项目详情 · 会前简报", w: 1440, h: 960, render: () => <CxProjectBriefing /> },
  { id: "cx-proj-memory",       label: "项目详情 · 项目记忆", w: 1440, h: 1020, render: () => <CxProjectMemory /> },
  { id: "cx-proj-stakeholders", label: "项目详情 · 干系人",  w: 1440, h: 960, render: () => <CxProjectStakeholders /> },
  { id: "cx-proj-milestones",   label: "项目详情 · 推进",    w: 1440, h: 1080, render: () => <CxProjectMilestones /> },
  { id: "cx-proj-docs",         label: "项目详情 · 文档",    w: 1440, h: 960, render: () => <CxProjectDocs /> },

  // -- Project creation + Client + Skill detail
  { id: "cx-new-project",   label: "新建项目 · 向导",     w: 1440, h: 920, render: () => <CxNewProject /> },
  { id: "cx-skill-detail",  label: "Skill 详情 · 战略分析", w: 1440, h: 920, render: () => <CxSkillDetail /> },

  // -- Library pages
  { id: "cx-skills",    label: "Skill 库",           w: 1440, h: 920, render: () => <CxSkills /> },
  { id: "cx-clients",   label: "客户列表",            w: 1440, h: 920, render: () => <CxClients /> },
  { id: "cx-contacts",  label: "联系人通讯录",        w: 1440, h: 920, render: () => <CxContacts /> },
  { id: "cx-knowledge", label: "知识库",             w: 1440, h: 920, render: () => <CxKnowledge /> },

  // -- Settings + auth + empty
  // -- Settings (11 pages)
  { id: "cx-set-profile",     label: "设置 · 个人资料",         w: 1440, h: 920, render: () => <CxSettingsProfile /> },
  { id: "cx-set-appearance",  label: "设置 · 外观",             w: 1440, h: 1000, render: () => <CxSettingsAppearance /> },
  { id: "cx-set-language",    label: "设置 · 语言与时区",       w: 1440, h: 820, render: () => <CxSettingsLanguage /> },
  { id: "cx-set-ai",          label: "设置 · AI 模型",          w: 1440, h: 920, render: () => <CxSettingsAI /> },
  { id: "cx-set-proj-mem",    label: "设置 · 项目记忆",         w: 1440, h: 920, render: () => <CxSettingsProjMem /> },
  { id: "cx-set-client-mem",  label: "设置 · 客户记忆",         w: 1440, h: 920, render: () => <CxSettingsClientMem /> },
  { id: "cx-set-mem-ops",     label: "设置 · 记忆任务中心",     w: 1440, h: 1100, render: () => <CxSettingsMemOps /> },
  { id: "cx-set-api",         label: "设置 · API 限流提醒",     w: 1440, h: 1200, render: () => <CxSettingsAPI /> },
  { id: "cx-set-migrations",  label: "设置 · 迁移状态",         w: 1440, h: 920, render: () => <CxSettingsMigrations /> },
  { id: "cx-set-messages",    label: "设置 · 消息管理",         w: 1440, h: 980, render: () => <CxSettingsMessages /> },
  { id: "cx-set-server",      label: "设置 · 服务器配置",       w: 1440, h: 1000, render: () => <CxSettingsServer /> },
  { id: "cx-set-users",       label: "设置 · 用户管理",         w: 1440, h: 920, render: () => <CxSettingsUsers /> },
  { id: "cx-set-about",       label: "设置 · 关于",            w: 1440, h: 1280, render: () => <CxSettingsAbout /> },
  { id: "cx-loading",   label: "加载中 · 骨架屏",     w: 1440, h: 920, render: () => <CxLoading /> },
  { id: "cx-notify",    label: "消息通知下拉 + Toast", w: 1440, h: 920, render: () => <CxNotifications /> },
  { id: "cx-avatar",    label: "头像下拉菜单",        w: 1440, h: 920, render: () => <CxAvatarMenu /> },
  { id: "cx-welcome",   label: "欢迎页",             w: 1440, h: 920, render: () => <CxWelcome /> },
  { id: "cx-login",     label: "登录",               w: 1024, h: 680, render: () => <CxLogin /> },
  { id: "cx-503",       label: "503 · 服务暂时不可用", w: 1440, h: 900, render: () => <CxServiceDown /> },
  { id: "cx-404",       label: "404 · 空态",         w: 1440, h: 820, render: () => <CxNotFound /> },
];

function CxAccentRow({ t, setTweak }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "4px 12px 8px" }}>
      {Object.entries(CX_ACCENTS).map(([key, p]) => {
        const accent = applyCxAccent(key, t.dark)["--accent"];
        const active = t.accent === key;
        return (
          <button
            key={key}
            onClick={() => setTweak("accent", key)}
            title={p.name}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              padding: 4, background: "transparent", border: "none", cursor: "pointer",
            }}
          >
            <span style={{
              width: 26, height: 26, borderRadius: 4, background: accent,
              boxShadow: active ? "0 0 0 2px var(--tw-bg, #1c1d22), 0 0 0 4px " + accent : "0 0 0 1px rgba(0,0,0,0.1)",
            }}/>
            <span style={{ fontSize: 10, color: active ? "#fff" : "rgba(255,255,255,0.55)", fontFamily: "ui-monospace, monospace" }}>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(CX_TWEAK_DEFAULTS);

  return (
    <>
      <DesignCanvas
        title="AriaAI · Codex Style"
        subtitle="22 个页面 · 项目详情 8 个深度 tab · 工作台 / 对话 / 客户 / Skill / 知识库 / 设置 / 欢迎 / 404"
      >
        <DCSection
          id="codex-toplevel"
          title="顶层页面"
          subtitle="Workspace · Chat · 各列表页"
        >
          {CX_ARTBOARDS.filter(ab => !ab.id.startsWith("cx-proj-") && !ab.id.startsWith("cx-set-") && ab.id !== "cx-new-project" && ab.id !== "cx-skill-detail" && ab.id !== "cx-welcome" && ab.id !== "cx-login" && ab.id !== "cx-404" && ab.id !== "cx-503" && ab.id !== "cx-loading" && ab.id !== "cx-notify" && ab.id !== "cx-avatar").map(ab => (
            <DCArtboard key={ab.id} id={ab.id} label={ab.label} width={ab.w} height={ab.h}>
              <CxThemed t={t}>{ab.render()}</CxThemed>
            </DCArtboard>
          ))}
        </DCSection>

        <DCSection
          id="codex-project-deep"
          title="项目详情 · 深度页 · 8 个 Tab"
          subtitle="概览 / 会前简报 / 项目记忆 / 锚点 / 干系人 / 里程碑 / 待办 / 文档 / 笔记 — 最关键的工作场"
        >
          {CX_ARTBOARDS.filter(ab => ab.id.startsWith("cx-proj-")).map(ab => (
            <DCArtboard key={ab.id} id={ab.id} label={ab.label} width={ab.w} height={ab.h}>
              <CxThemed t={t}>{ab.render()}</CxThemed>
            </DCArtboard>
          ))}
        </DCSection>

        <DCSection
          id="codex-secondary"
          title="二级页面 · 新建 / 详情"
          subtitle="新建项目向导 · 客户详情 · Skill 详情"
        >
          {CX_ARTBOARDS.filter(ab => ab.id === "cx-new-project" || ab.id === "cx-skill-detail").map(ab => (
            <DCArtboard key={ab.id} id={ab.id} label={ab.label} width={ab.w} height={ab.h}>
              <CxThemed t={t}>{ab.render()}</CxThemed>
            </DCArtboard>
          ))}
        </DCSection>

        <DCSection
          id="codex-settings"
          title="设置 · 全部 11 个页面"
          subtitle="个人资料 / 语言 / AI 模型 / 项目与客户记忆 / Memory Ops / API 限额 / 用户 / 迁移 / 服务器 / 关于"
        >
          {CX_ARTBOARDS.filter(ab => ab.id.startsWith("cx-set-")).map(ab => (
            <DCArtboard key={ab.id} id={ab.id} label={ab.label} width={ab.w} height={ab.h}>
              <CxThemed t={t}>{ab.render()}</CxThemed>
            </DCArtboard>
          ))}
        </DCSection>

        <DCSection
          id="codex-auth-empty"
          title="入口与空态"
          subtitle="登录 · 欢迎 · 加载中 · 消息通知 · 头像菜单 · 503 · 404"
        >
          {CX_ARTBOARDS.filter(ab => ab.id === "cx-welcome" || ab.id === "cx-login" || ab.id === "cx-404" || ab.id === "cx-503" || ab.id === "cx-loading" || ab.id === "cx-notify" || ab.id === "cx-avatar").map(ab => (
            <DCArtboard key={ab.id} id={ab.id} label={ab.label} width={ab.w} height={ab.h}>
              <CxThemed t={t}>{ab.render()}</CxThemed>
            </DCArtboard>
          ))}
        </DCSection>
      </DesignCanvas>

      <TweaksPanel title="Tweaks · 调节">
        <TweakSection label="主题" />
        <TweakToggle label="深色模式" value={t.dark} onChange={(v) => setTweak("dark", v)} />

        <TweakSection label="密度" />
        <TweakRadio
          label="信息密度"
          value={t.density}
          options={["compact", "regular", "comfy"]}
          onChange={(v) => setTweak("density", v)}
        />

        <TweakSection label="圆角" />
        <TweakRadio
          label="形态"
          value={t.radius}
          options={["sharp", "soft", "round"]}
          onChange={(v) => setTweak("radius", v)}
        />

        <TweakSection label="活力色 · accent" />
        <CxAccentRow t={t} setTweak={setTweak} />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
