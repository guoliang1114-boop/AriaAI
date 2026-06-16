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
  { id: "cx-projects",  label: "项目列表",               w: 1440, h: 920, render: () => <CxProjects /> },

  // -- Project Detail (deep dive tabs)
  { id: "cx-proj-overview",     label: "项目详情 · 概览",     w: 1440, h: 960, render: () => <CxProjectOverview /> },
  { id: "cx-proj-chat",         label: "项目详情 · 项目对话", w: 1440, h: 960, render: () => <CxProjectChat /> },
  { id: "cx-proj-chat-preview", label: "项目详情 · 对话 + 文件预览", w: 1600, h: 960, render: () => <CxProjectChatPreview /> },
  { id: "cx-proj-briefing",     label: "项目详情 · 会前简报", w: 1440, h: 960, render: () => <CxProjectBriefing /> },
  { id: "cx-proj-memory",       label: "项目详情 · 项目记忆", w: 1440, h: 1020, render: () => <CxProjectMemory /> },
  { id: "cx-proj-stakeholders", label: "项目详情 · 干系人",  w: 1440, h: 960, render: () => <CxProjectStakeholders /> },
  { id: "cx-proj-milestones",   label: "项目详情 · 活动",    w: 1440, h: 1080, render: () => <CxProjectMilestones /> },
  { id: "cx-proj-finance",      label: "项目详情 · 财务",    w: 1440, h: 1080, render: () => <CxProjectFinance /> },
  { id: "cx-proj-docs",         label: "项目详情 · 文档",    w: 1440, h: 960, render: () => <CxProjectDocs /> },
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
        title="AriaAI · 项目模块"
        subtitle="项目列表(商务阶段管线 + 交付阶段) · 项目详情 9 个深度 tab"
      >
        <DCSection
          id="codex-projects"
          title="项目列表"
          subtitle="商务阶段 5 列管线 + 交付阶段(交付中 / 已归档)"
        >
          {CX_ARTBOARDS.filter(ab => ab.id === "cx-projects").map(ab => (
            <DCArtboard key={ab.id} id={ab.id} label={ab.label} width={ab.w} height={ab.h}>
              <CxThemed t={t}>{ab.render()}</CxThemed>
            </DCArtboard>
          ))}
        </DCSection>

        <DCSection
          id="codex-project-deep"
          title="项目详情 · 深度页"
          subtitle="概览 / 项目对话 / 对话+预览 / 会前简报 / 项目记忆 / 干系人 / 活动 / 财务 / 文档"
        >
          {CX_ARTBOARDS.filter(ab => ab.id.startsWith("cx-proj-")).map(ab => (
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
