// direction-codex-project.jsx
// Deep project detail — 8 tabs, each rich.
// All tabs share CxProjectShell which renders header + tab nav + breadcrumb.

const PROJECT = {
  id: "DH-2026-001",
  name: "鼎和保险 · 数字化转型咨询",
  status: "opportunity",
  statusLabel: "机会期",
  client: "鼎和保险股份有限公司",
  clientShort: "鼎和保险",
  industry: "保险 · 财产险",
  region: "深圳",
  amount: 2_800_000,
  amountText: "¥280 万",
  owner: "陈悦",
  team: [
    { n: "陈悦", r: "项目经理" },
    { n: "林宥", r: "解决方案" },
    { n: "苏明", r: "数据顾问" },
  ],
  memoryVersion: 12,
  memoryFresh: true,
  memoryUpdated: "2 小时前",
  docs: 12,
  messages: 128,
  skillCalls: 47,
  todoOpen: 4,
  todoDone: 12,
  milestoneDone: 3,
  milestoneTotal: 8,
  start: "2026-04-12",
  expectedClose: "2026-08-31",
  oneLiner: "围绕续保与理赔两个高频场景搭建数据闭环,Q3 完成首批试点。",
};

// ---------- Project Shell — single unified top bar (no double nav) ----------
function CxProjectShell({ activeTab = "overview", children }) {
  const tabs = [
    { k: "overview",    zh: "概览" },
    { k: "chat",        zh: "项目对话" },
    { k: "briefing",    zh: "会前简报" },
    { k: "memory",      zh: "项目记忆" },
    { k: "stakeholders",zh: "干系人" },
    { k: "milestones",  zh: "活动" },
    { k: "finance",     zh: "财务" },
    { k: "docs",        zh: "文档" },
  ];
  return (
    <div className="frame-codex" style={{ flexDirection: "column" }}>
      {/* Single unified top bar — project name + tabs + utilities, no global nav */}
      <header style={{ padding: "0 28px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "stretch", height: 56, flexShrink: 0 }}>
        {/* Left — back chip + project name + status */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
          <a style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--ink-mute)", padding: "4px 8px", marginLeft: -8, borderRadius: "var(--r-sm)" }} className="row-hov">
            <I name="chevron-right" size={11} stroke={1.5} style={{ transform: "rotate(180deg)" }}/> 项目
          </a>
          <div style={{ width: 1, height: 22, background: "var(--line)" }}/>
          <button style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: "var(--r-sm)" }} className="row-hov">
            <span style={{ width: 26, height: 26, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 500 }}>鼎</span>
            <div style={{ textAlign: "left", lineHeight: 1.2 }}>
              <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, letterSpacing: "-0.005em" }}>{PROJECT.name}</div>
              <div style={{ fontSize: 10.5, color: "var(--ink-mute)", marginTop: 1, display: "flex", alignItems: "center", gap: 6 }}>
                <CxStatusByKey status={PROJECT.status}/>
                <span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>记忆 v{PROJECT.memoryVersion} · {PROJECT.memoryUpdated}</span>
              </div>
            </div>
            <I name="chevron-down" size={10} stroke={1.5} style={{ color: "var(--ink-faint)", marginLeft: 4 }}/>
          </button>
        </div>

        {/* Center — tabs */}
        <nav style={{ display: "flex", alignItems: "stretch", marginLeft: 28, flex: 1, minWidth: 0, overflow: "hidden" }}>
          {tabs.map(t => (
            <a key={t.k} style={{ display: "flex", alignItems: "center", padding: "0 12px", fontSize: 13, color: t.k === activeTab ? "var(--ink)" : "var(--ink-mute)", fontWeight: t.k === activeTab ? 500 : 400, borderBottom: t.k === activeTab ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1, whiteSpace: "nowrap" }}>
              {t.zh}
            </a>
          ))}
        </nav>

        {/* Right — utilities */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--ink-mute)" }}><I name="bell" size={14} stroke={1.5}/></button>
          <span style={{ width: 26, height: 26, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 500 }}>陈</span>
        </div>
      </header>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}

// ---------- Sub-card primitives ----------
function CxPanel({ title, subtitle, action, children, style = {} }) {
  return (
    <section style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "18px 20px", ...style }}>
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, gap: 12 }}>
          <div>
            {title && <h3 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)", letterSpacing: "-0.01em" }}>{title}</h3>}
            {subtitle && <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--ink-mute)", lineHeight: 1.5 }}>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ============================================================
   1) Overview
   ============================================================ */
function CxProjectOverview() {
  return (
    <CxProjectShell activeTab="overview">
      <div style={{ height: "100%", overflow: "hidden", padding: "24px 40px 32px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, minWidth: 0 }}>
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
          {/* AI snapshot */}
          <CxPanel
            title="AI 项目快照"
            subtitle="基于最近 3 次会议与 2 份文档自动生成 · 14 分钟前"
            action={<button style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}><I name="sparkle" size={11} stroke={1.5}/> 重新生成</button>}
          >
            <p className="ui" style={{ margin: "0 0 14px", fontSize: 14, color: "var(--ink)", lineHeight: 1.75 }}>
              {PROJECT.oneLiner} 客户内部已有 Q3 数字化目标共识,我方建议先以续保数据闭环作为切入点,同时<span style={{ color: "var(--warn)", borderBottom: "1px dotted var(--warn)" }}>注意理赔系统改造涉及核心交易,需谨慎评估</span>。
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, paddingTop: 14, borderTop: "1px solid var(--line-soft)" }}>
              {[
                { l: "下一动作", v: "Q3 第一周提交 POC 报告", tone: "accent", icon: "arrow-right" },
                { l: "关键决策人", v: "CTO 王浩 · COO 张丽", tone: "neutral", icon: "user" },
                { l: "记忆状态", v: "已同步 · v12 · 完整", tone: "good", icon: "check" },
              ].map((b, i) => (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <span style={{ width: 26, height: 26, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><I name={b.icon} size={12} stroke={1.5}/></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 2 }}>{b.l}</div>
                    <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, lineHeight: 1.45 }}>{b.v}</div>
                  </div>
                </div>
              ))}
            </div>
          </CxPanel>

          {/* Memory excerpt + Briefing preview side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <CxPanel
              title="项目记忆摘要"
              subtitle="结构化沉淀 · v12"
              action={<a style={{ fontSize: 11.5, color: "var(--accent)" }}>查看完整 →</a>}
            >
              {[
                ["客户背景", "深圳总部 · 3 万员工 · 2025 总保费 480 亿"],
                ["核心痛点", "续保转化下滑 · 数据散落 5 系统"],
                ["我方方案", "三层框架,先做续保 + 理赔数据闭环"],
                ["下一步",   "Q3 W1 POC 报告 · W3 提案 V2"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "75px 1fr", padding: "8px 0", borderBottom: "1px solid var(--line-soft)", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{k}</div>
                  <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.55 }}>{v}</div>
                </div>
              ))}
            </CxPanel>

            <CxPanel
              title="会前 30 秒卡"
              subtitle="下次例会前自动准备"
              action={<a style={{ fontSize: 11.5, color: "var(--accent)" }}>详细 →</a>}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                {[
                  { l: "建议说", v: "聚焦续保的 Q3 试点目标与 KPI", tone: "good" },
                  { l: "避开",   v: "理赔系统改造的具体范围", tone: "warn" },
                  { l: "确认",   v: "客户能否在 6 月前提供历史数据", tone: "neutral" },
                ].map((b, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: i === 2 ? "none" : "1px solid var(--line-soft)" }}>
                    <span style={{ width: 36, color: b.tone === "good" ? "var(--good)" : b.tone === "warn" ? "var(--warn)" : "var(--ink-mute)", fontSize: 11.5, fontWeight: 500, paddingTop: 1, flexShrink: 0 }}>{b.l}</span>
                    <span style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.55 }}>{b.v}</span>
                  </div>
                ))}
              </div>
            </CxPanel>
          </div>

          {/* Activity timeline */}
          <CxPanel
            title="最近动态"
            subtitle="24 小时内"
            action={<a style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>全部 →</a>}
          >
            <div style={{ position: "relative", paddingLeft: 14 }}>
              <div style={{ position: "absolute", left: 4, top: 4, bottom: 4, width: 1, background: "var(--line)" }}/>
              {[
                { t: "14:18", who: "陈悦",  what: "更新了项目记忆 v12 · 调整核心痛点描述", tone: "accent" },
                { t: "11:02", who: "Aria",  what: "调用 会前简报 Skill · 生成例会卡", tone: "good" },
                { t: "09:30", who: "林宥",  what: "上传 2 份文档 · 客户访谈纪要 V3", tone: "neutral" },
                { t: "昨天",  who: "Aria",  what: "完成项目记忆增量索引 · 新增 7 条片段", tone: "neutral" },
                { t: "昨天",  who: "苏明",  what: "添加锚点 · 续保转化率指标待客户确认", tone: "warn" },
              ].map((e, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "56px auto 1fr", gap: 12, padding: "9px 0", alignItems: "flex-start", position: "relative" }}>
                  <span style={{ fontSize: 11.5, color: "var(--ink-mute)", paddingTop: 1 }}>{e.t}</span>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--bg-elev)", border: `1.5px solid ${e.tone === "accent" ? "var(--accent)" : e.tone === "good" ? "var(--good)" : e.tone === "warn" ? "var(--warn)" : "var(--ink-faint)"}`, marginTop: 6, position: "relative", left: -14, flexShrink: 0 }}/>
                  <div style={{ marginLeft: -10 }}>
                    <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
                      <span style={{ color: "var(--ink)", fontWeight: 500 }}>{e.who}</span> · {e.what}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CxPanel>
        </div>

        {/* Side rail */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Quick facts */}
          <CxPanel title="项目档案" action={<button style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg> 编辑</button>}>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.85 }}>
              {[
                ["客户",     PROJECT.client],
                ["行业",     PROJECT.industry],
                ["地区",     PROJECT.region],
                ["合同金额", PROJECT.amountText + " · 预估"],
                ["开始",     PROJECT.start],
                ["预计签约", PROJECT.expectedClose],
                ["负责人",   PROJECT.owner],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
                  <span style={{ color: "var(--ink-mute)" }}>{k}</span>
                  <span style={{ color: "var(--ink)", textAlign: "right", minWidth: 0 }}>{v}</span>
                </div>
              ))}
            </div>
          </CxPanel>

          {/* Stakeholders preview */}
          <CxPanel title="关键干系人" action={<a style={{ fontSize: 11.5, color: "var(--accent)" }}>详细 →</a>}>
            {[
              { n: "王浩", r: "CTO · 技术拍板", lvl: "决策", tone: "accent" },
              { n: "张丽", r: "COO · 业务背书", lvl: "决策", tone: "accent" },
              { n: "王凯", r: "数字化办公室",   lvl: "影响", tone: "neutral" },
            ].map(p => (
              <div key={p.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>{p.n[0]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{p.n}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{p.r}</div>
                </div>
                <CxStatus tone={p.tone}>{p.lvl}</CxStatus>
              </div>
            ))}
          </CxPanel>

          {/* Members */}
          <CxPanel title="项目成员" action={<a style={{ fontSize: 11.5, color: "var(--accent)" }}>管理</a>}>
            {PROJECT.team.map(p => (
              <div key={p.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                <span style={{ width: 26, height: 26, borderRadius: 99, background: "var(--bg-tint)", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>{p.n[0]}</span>
                <div style={{ flex: 1 }}>
                  <div className="ui" style={{ fontSize: 13, color: "var(--ink)" }}>{p.n}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{p.r}</div>
                </div>
              </div>
            ))}
            <button style={{ width: "100%", marginTop: 8, padding: "7px 10px", fontSize: 12, color: "var(--ink-mute)", border: "1px dashed var(--line-strong)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              <I name="plus" size={11} stroke={1.6}/> 添加 / 邀请成员
            </button>
          </CxPanel>

          {/* Project management — archive / delete */}
          <CxPanel title="项目管理">
            {[
              { l: "编辑项目信息", d: "名称、客户、金额、周期等", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>, tone: "soft" },
              { l: "归档项目", d: "移入归档,保留全部记忆", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4"/></svg>, tone: "soft" },
              { l: "删除项目", d: "不可恢复,谨慎操作", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>, tone: "bad" },
            ].map((a, i) => (
              <button key={a.l} className="row-hov" style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "9px 8px", borderRadius: "var(--r-sm)", borderTop: i === 0 ? "none" : "1px solid var(--line-soft)", textAlign: "left" }}>
                <span style={{ color: a.tone === "bad" ? "var(--bad)" : "var(--ink-mute)", display: "inline-flex", flexShrink: 0 }}>{a.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 13, color: a.tone === "bad" ? "var(--bad)" : "var(--ink)", fontWeight: 500 }}>{a.l}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 1 }}>{a.d}</div>
                </div>
                <I name="chevron-right" size={12} stroke={1.5} style={{ color: "var(--ink-faint)", flexShrink: 0 }}/>
              </button>
            ))}
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  );
}

Object.assign(window, { PROJECT, CxProjectShell, CxPanel, CxProjectOverview });
