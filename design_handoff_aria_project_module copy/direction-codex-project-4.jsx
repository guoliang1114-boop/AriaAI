// direction-codex-project-4.jsx — Docs + Notes + remaining secondary pages

/* ============================================================
   8) Docs — Documents linked to this project
   ============================================================ */
function CxProjectDocs() {
  const FOLDERS = [
    { id: "interview", name: "客户访谈", tone: "neutral", files: [
      { ext: "DOC", title: "鼎和保险 续保业务深度访谈记录", size: "1.2 MB", who: "林宥", date: "2026-05-15", source: "本地上传", summary: "针对续保团队 4 位负责人的深度访谈,识别 12 个关键痛点。", tags: ["访谈", "续保"] },
      { ext: "DOC", title: "客户访谈纪要 V3", size: "920 KB", who: "林宥", date: "2026-05-26", source: "本地上传", summary: "更新版 — 补充数据治理边界的讨论。", tags: ["访谈"] },
      { ext: "PDF", title: "决策链补充材料", size: "640 KB", who: "陈悦", date: "2026-05-20", source: "本地上传", summary: "CTO / COO / 数字化办公室的决策权重梳理。", tags: ["客户"] },
    ]},
    { id: "method", name: "方案文档", tone: "neutral", files: [
      { ext: "PDF", title: "数据治理 POC 评估方案 v0.3", size: "2.4 MB", who: "苏明", date: "2026-05-22", source: "本地上传", summary: "POC 评估的范围、指标定义与方法。", tags: ["技术", "POC"] },
      { ext: "MD", title: "AI 售前评估方法论 v2", size: "120 KB", who: "苏明", date: "2026-05-19", source: "知识库", summary: "标准化的售前评估方法论模板。", tags: ["方法论"] },
    ]},
    { id: "meeting", name: "会议纪要", tone: "neutral", files: [
      { ext: "MD", title: "会前简报 · 6 月 3 日例会", size: "12 KB", who: "Aria", date: "2026-05-28", source: "Skill 输出", summary: "为 6/3 例会生成的 30 秒卡 + 话术。", tags: ["简报", "输出"] },
      { ext: "DOC", title: "申通快运 项目周报合集 Q2", size: "3.1 MB", who: "陈悦", date: "2026-05-08", source: "知识库", summary: "Q2 周报合集,含里程碑与风险跟踪。", tags: ["周报"] },
    ]},
    { id: "deliver", name: "交付物", tone: "good", files: [
      { ext: "PDF", title: "数字化转型蓝图 V1", size: "5.2 MB", who: "陈悦", date: "2026-05-25", source: "本地上传", summary: "三层框架的整体蓝图初稿。", tags: ["交付物"] },
    ]},
    { id: "finance", name: "合同 / 财务", tone: "warn", files: [
      { ext: "PDF", title: "咨询服务合同 DH-2026-001", size: "880 KB", who: "陈悦", date: "2026-04-12", source: "本地上传", summary: "主合同 · ¥280 万 · 里程碑付款。", tags: ["合同"] },
    ]},
    { id: "auto", name: "自动生成", tone: "accent", files: [
      { ext: "MEM", title: "项目记忆快照 v12", size: "—", who: "Aria", date: "2026-05-28", source: "自动生成", summary: "由 11 次对话 + 12 份文档汇总的结构化记忆。", tags: ["记忆", "自动"] },
    ]},
  ];
  const totalFiles = FOLDERS.reduce((s, f) => s + f.files.length, 0);
  return <CxProjectDocsInner FOLDERS={FOLDERS} totalFiles={totalFiles}/>;
}

function CxProjectDocsInner({ FOLDERS, totalFiles }) {
  const [expanded, setExpanded] = React.useState({ interview: true, method: false, meeting: false, deliver: false, finance: false, auto: false });
  const [sel, setSel] = React.useState({ folder: "interview", file: 0 });
  const toggle = (k) => setExpanded(e => ({ ...e, [k]: !e[k] }));
  const cur = FOLDERS.find(f => f.id === sel.folder) || FOLDERS[0];
  const curFile = cur.files[sel.file] || cur.files[0];
  const toneColor = t => t === "accent" ? "var(--accent)" : t === "good" ? "var(--good)" : t === "warn" ? "var(--warn)" : "var(--ink-mute)";

  const TreeRow = ({ depth = 0, icon, iconColor, expandable, isOpen, label, badge, onClick, active }) => (
    <a className="row-hov" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 5, padding: "5px 6px", paddingLeft: 6 + depth * 14,
      margin: "0 -6px", borderRadius: "var(--r-sm)", cursor: "pointer",
      background: active ? "var(--bg-tint)" : "transparent", position: "relative",
    }}>
      {active && <span style={{ position: "absolute", left: 0, top: 5, bottom: 5, width: 2, background: "var(--accent)" }}/>}
      <span style={{ width: 12, color: "var(--ink-faint)", fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {expandable ? (isOpen ? "▾" : "▸") : ""}
      </span>
      {icon && <I name={icon} size={12} stroke={1.5} style={{ color: iconColor || "var(--ink-mute)", flexShrink: 0 }}/>}
      <span style={{ fontSize: 12.5, color: active ? "var(--ink)" : "var(--ink-soft)", fontWeight: active ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{label}</span>
      {badge != null && <span className="num" style={{ fontSize: 10, color: "var(--ink-faint)", flexShrink: 0 }}>{badge}</span>}
    </a>
  );
  const FileRow = ({ depth, ext, label, active, onClick }) => (
    <a className="row-hov" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", paddingLeft: 6 + depth * 14 + 12,
      margin: "0 -6px", borderRadius: "var(--r-sm)", cursor: "pointer", background: active ? "var(--accent-bg)" : "transparent",
    }}>
      <span style={{ fontSize: 9, color: ext === "MD" || ext === "MEM" ? "var(--accent)" : "var(--ink-mute)", padding: "1px 4px", border: `1px solid ${ext === "MD" || ext === "MEM" ? "var(--accent-bg)" : "var(--line)"}`, background: ext === "MD" || ext === "MEM" ? "var(--accent-bg)" : "transparent", borderRadius: 2, flexShrink: 0, letterSpacing: "0.04em", minWidth: 26, textAlign: "center" }}>{ext}</span>
      <span style={{ fontSize: 12, color: active ? "var(--ink)" : "var(--ink-soft)", fontWeight: active ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{label}</span>
    </a>
  );

  return (
    <CxProjectShell activeTab="docs">
      <div style={{ height: "100%", overflow: "hidden", display: "grid", gridTemplateColumns: "280px 1fr", minWidth: 0 }}>
        {/* LEFT — tree */}
        <aside style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "18px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>项目文件</h2>
            <span className="num" style={{ fontSize: 11, color: "var(--ink-faint)" }}>{FOLDERS.length} 夹 · {totalFiles} 份</span>
          </div>
          {/* upload dropzone */}
          <div style={{ padding: "0 14px 8px" }}>
            <div style={{ padding: "9px 11px", border: "1.5px dashed var(--line-strong)", borderRadius: "var(--r-sm)", background: "color-mix(in oklch, var(--accent) 4%, transparent)", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <span style={{ width: 26, height: 26, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><I name="plus" size={13} stroke={1.6}/></span>
              <div style={{ minWidth: 0 }}>
                <div className="ui" style={{ fontSize: 12, color: "var(--ink)", fontWeight: 500 }}>拖入或上传文件</div>
                <div style={{ fontSize: 10.5, color: "var(--ink-mute)", marginTop: 1 }}>PDF · DOC · MD · ≤ 50 MB</div>
              </div>
            </div>
          </div>
          {/* tree */}
          <div style={{ flex: 1, overflow: "auto", padding: "4px 14px 14px" }}>
            <TreeRow depth={0} icon="folder" iconColor="var(--ink-soft)" label="全部文件" badge={totalFiles} active={false}/>
            {FOLDERS.map(f => (
              <React.Fragment key={f.id}>
                <TreeRow depth={1} expandable isOpen={expanded[f.id]} icon="folder" iconColor={toneColor(f.tone)}
                  label={f.name} badge={f.files.length} active={sel.folder === f.id && sel.file === -1}
                  onClick={() => { toggle(f.id); setSel({ folder: f.id, file: 0 }); }}/>
                {expanded[f.id] && f.files.map((d, i) => (
                  <FileRow key={i} depth={2} ext={d.ext} label={d.title}
                    active={sel.folder === f.id && sel.file === i}
                    onClick={() => setSel({ folder: f.id, file: i })}/>
                ))}
              </React.Fragment>
            ))}
          </div>
        </aside>

        {/* RIGHT — folder contents + selected preview */}
        <div style={{ overflow: "auto", padding: "20px 32px 32px", minWidth: 0 }}>
          {/* breadcrumb + actions */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--ink-mute)" }}>
              <I name="folder" size={13} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
              <span>全部文件</span>
              <I name="chevron-right" size={11} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
              <span style={{ color: "var(--ink)", fontWeight: 500 }}>{cur.name}</span>
              <span className="num" style={{ color: "var(--ink-faint)", marginLeft: 4 }}>{cur.files.length}</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "6px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>新建文件夹</button>
              <button style={{ padding: "6px 12px", fontSize: 12, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>+ 上传</button>
            </div>
          </div>

          {/* doc list for current folder */}
          <div>
            {cur.files.map((d, i) => (
              <a key={i} className="row-hov" onClick={() => setSel({ folder: cur.id, file: i })} style={{ display: "grid", gridTemplateColumns: "50px 1fr 100px 90px", padding: "14px 8px", gap: 14, alignItems: "flex-start", borderBottom: "1px solid var(--line-soft)", borderRadius: "var(--r-sm)", cursor: "pointer", background: sel.file === i ? "var(--bg-tint)" : "transparent" }}>
                <span style={{ fontSize: 10, color: "var(--ink-mute)", padding: "3px 8px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", textAlign: "center", letterSpacing: "0.04em", justifySelf: "start" }}>{d.ext}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{d.title}</div>
                  <p style={{ margin: "3px 0 6px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.55, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{d.summary}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--ink-mute)", flexWrap: "wrap" }}>
                    <span>{d.who} 上传</span>
                    <span style={{ color: "var(--ink-faint)" }}>·</span>
                    <span>{d.source}</span>
                    {d.tags.map(t => <span key={t} style={{ color: "var(--accent)" }}>#{t}</span>)}
                  </div>
                </div>
                <span className="num" style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{d.size}</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{d.date}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </CxProjectShell>
  );
}

/* ============================================================
   9) Notes — markdown-ish notes
   ============================================================ */
function CxProjectNotes() {
  const notes = [
    { id: 1, t: "POC 评估指标定义讨论", who: "苏明", date: "今天 14:08", preview: "POC 阶段需要衡量的核心指标:1) 续保转化率提升幅度,2) 数据查询响应时间,3) 报表生成耗时…", pinned: true },
    { id: 2, t: "5 月 22 日客户例会笔记", who: "陈悦", date: "5 月 22 日", preview: "王浩明确表示希望以小范围试点切入,避免一次性铺开。张丽关注的是 Q3 续保 KPI…", pinned: true },
    { id: 3, t: "续保业务流程梳理初稿", who: "林宥", date: "5 月 18 日", preview: "续保业务当前流程:到期前 60 天系统提醒 → 客户经理跟进 → 报价 → 客户决策 → 续约。关键卡点在 30 天窗口…" },
    { id: 4, t: "数据治理初步评估", who: "苏明", date: "5 月 10 日", preview: "客户当前有 5 个核心系统:客户系统、保单系统、理赔系统、收付系统、风控系统…" },
    { id: 5, t: "项目启动会要点", who: "陈悦", date: "4 月 12 日", preview: "项目目标:为鼎和保险设计并落地数字化转型蓝图,聚焦续保与理赔两个高频场景…" },
  ];
  const active = notes[0];
  return (
    <CxProjectShell activeTab="notes">
      <div style={{ height: "100%", overflow: "hidden", padding: "24px 40px 32px", display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, minWidth: 0 }}>
        {/* Note list */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 className="ui" style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.015em" }}>笔记 · {notes.length}</h2>
            <button style={{ padding: "5px 10px", fontSize: 12, color: "var(--bg-elev)", background: "var(--ink)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 4 }}>
              <I name="plus" size={11} stroke={1.6}/> 新建
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: "var(--r-sm)", color: "var(--ink-mute)" }}>
            <I name="search" size={12} stroke={1.5}/> <span>搜索笔记</span>
          </div>
          <div style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {notes.map((n, i) => (
              <a key={n.id} style={{
                padding: "11px 12px",
                background: i === 0 ? "var(--bg-tint)" : "transparent",
                border: i === 0 ? "1px solid var(--line)" : "1px solid transparent",
                borderRadius: "var(--r-sm)",
                marginBottom: 4,
                position: "relative",
                cursor: "pointer",
              }}>
                {i === 0 && <span style={{ position: "absolute", left: 0, top: 12, bottom: 12, width: 2, background: "var(--accent)", borderRadius: 99 }}/>}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  {n.pinned && <span style={{ fontSize: 10, color: "var(--accent)" }}>★</span>}
                  <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: i === 0 ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.t}</div>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-mute)", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{n.preview}</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>
                  <span>{n.who}</span>
                  <span>{n.date}</span>
                </div>
              </a>
            ))}
          </div>
        </aside>

        {/* Note editor */}
        <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "20px 32px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <h1 className="ui" style={{ margin: 0, fontSize: 22, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>{active.t}</h1>
              <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
                <span>{active.who}</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>{active.date}</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                <CxStatus tone="good">已保存</CxStatus>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-mute)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>★ 取消固定</button>
              <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--accent)", border: "1px solid var(--accent-bg)", background: "var(--accent-bg)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 4 }}>
                <I name="sparkle" size={10} stroke={1.5}/> 提炼到记忆
              </button>
              <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-mute)" }}>⋯</button>
            </div>
          </div>

          {/* Markdown content */}
          <div className="ui" style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.8, overflow: "hidden" }}>
            <p style={{ margin: "0 0 16px" }}>
              POC 阶段需要衡量的核心指标,讨论后初步对齐如下:
            </p>
            <h3 style={{ margin: "20px 0 10px", fontSize: 15, color: "var(--ink)", fontWeight: 600 }}>1 · 业务指标</h3>
            <ul style={{ margin: "0 0 16px", paddingLeft: 22 }}>
              <li style={{ marginBottom: 4 }}>续保转化率提升幅度 (当前 38%,目标 ≥ 50%)</li>
              <li style={{ marginBottom: 4 }}>30 天窗口客户经理触达率</li>
              <li style={{ marginBottom: 4 }}>续保业务报表生成耗时 (当前 4 小时,目标 ≤ 30 分钟)</li>
            </ul>
            <h3 style={{ margin: "20px 0 10px", fontSize: 15, color: "var(--ink)", fontWeight: 600 }}>2 · 技术指标</h3>
            <ul style={{ margin: "0 0 16px", paddingLeft: 22 }}>
              <li style={{ marginBottom: 4 }}>数据查询响应时间 (P95 ≤ 200ms)</li>
              <li style={{ marginBottom: 4 }}>新增数据接入到可查询的延迟 (≤ 15 分钟)</li>
            </ul>
            <h3 style={{ margin: "20px 0 10px", fontSize: 15, color: "var(--ink)", fontWeight: 600 }}>3 · 待客户确认</h3>
            <blockquote style={{ margin: "0 0 16px", padding: "10px 14px", background: "var(--bg-tint)", borderLeft: "2px solid var(--accent)", borderRadius: 4, fontSize: 13.5, color: "var(--ink-soft)" }}>
              是否需要将 NPS 评分纳入 POC 评估?苏明建议先不纳入,集中在转化率与效率指标。
            </blockquote>
            <p style={{ margin: 0, color: "var(--ink-mute)" }}>
              <em>— 接下来 · 整理成正式文档后上传到项目文档,供 6/3 例会使用<span className="cursor-blink"/></em>
            </p>
          </div>
        </div>
      </div>
    </CxProjectShell>
  );
}

/* ============================================================
   10) Finance — 项目财务
   ============================================================ */
function CxProjectFinance() {
  const kpis = [
    { l: "合同总额", v: "¥280", u: "万", tone: "neutral", sub: "含税 · 一次签订" },
    { l: "已回款",   v: "¥84",  u: "万", tone: "good",    sub: "30% · 预付款" },
    { l: "应收余额", v: "¥196", u: "万", tone: "accent",  sub: "70% 待收" },
    { l: "预估毛利率", v: "42", u: "%", tone: "neutral",  sub: "毛利 ¥118 万" },
  ];
  const schedule = [
    { node: "预付款",     pctp: "30%", amt: "¥84 万",  due: "2026-04-20", state: "received", inv: "已开票" },
    { node: "POC 验收款", pctp: "30%", amt: "¥84 万",  due: "2026-06-30", state: "invoiced", inv: "已开票" },
    { node: "方案交付款", pctp: "25%", amt: "¥70 万",  due: "2026-08-15", state: "pending",  inv: "待开票" },
    { node: "尾款",       pctp: "15%", amt: "¥42 万",  due: "2026-09-30", state: "pending",  inv: "待开票" },
  ];
  const stateMap = {
    received: ["已回款", "good"],
    invoiced: ["待回款", "warn"],
    pending:  ["未到期", "neutral"],
  };
  const invoices = [
    { code: "INV-2026-0418", amt: "¥84 万", date: "2026-04-18", status: "已回款", tone: "good" },
    { code: "INV-2026-0605", amt: "¥84 万", date: "2026-06-05", status: "待回款 · 25 天", tone: "warn" },
  ];
  const costs = [
    ["顾问人天", "320 人天"],
    ["人力成本", "¥138 万"],
    ["差旅 / 其他", "¥24 万"],
    ["成本合计", "¥162 万"],
  ];
  return (
    <CxProjectShell activeTab="finance">
      <div style={{ height: "100%", overflow: "auto", padding: "24px 40px 32px", display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
        {/* KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {kpis.map((k, i) => (
            <div key={i} style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 18px" }}>
              <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{k.l}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 8 }}>
                <span className="num" style={{ fontSize: 26, fontWeight: 500, lineHeight: 1, color: k.tone === "good" ? "var(--good)" : k.tone === "accent" ? "var(--accent-ink)" : "var(--ink)" }}>{k.v}</span>
                <span className="num" style={{ fontSize: 13, color: "var(--ink-mute)" }}>{k.u}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 7 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Collection progress bar */}
        <CxPanel title="回款进度" subtitle="已回款 ¥84 万 / 合同 ¥280 万 · 30%">
          <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", background: "var(--bg-tint)", marginTop: 2 }}>
            <div style={{ width: "30%", background: "var(--good)" }}/>
            <div style={{ width: "30%", background: "color-mix(in oklch, var(--warn) 60%, transparent)" }}/>
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 11.5, color: "var(--ink-mute)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--good)" }}/>已回款 30%</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "color-mix(in oklch, var(--warn) 60%, transparent)" }}/>已开票待回款 30%</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--bg-tint)" }}/>未到期 40%</span>
          </div>
        </CxPanel>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, minWidth: 0 }}>
          {/* Payment schedule */}
          <CxPanel title="收款计划" subtitle="按里程碑节点收款" action={<button style={{ fontSize: 12, color: "var(--accent)" }}>导出对账单</button>}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 60px 90px 110px 90px", gap: 12, padding: "0 4px 8px", fontSize: 11, color: "var(--ink-faint)", borderBottom: "1px solid var(--line-soft)" }}>
              <span>付款节点</span><span>比例</span><span>金额</span><span>计划日期</span><span>状态</span>
            </div>
            {schedule.map((r, i) => {
              const [sl, st] = stateMap[r.state];
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 60px 90px 110px 90px", gap: 12, padding: "12px 4px", alignItems: "center", borderBottom: i === schedule.length - 1 ? "none" : "1px solid var(--line-soft)" }}>
                  <div>
                    <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{r.node}</div>
                    <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2 }}>{r.inv}</div>
                  </div>
                  <span className="num" style={{ fontSize: 12, color: "var(--ink-mute)" }}>{r.pctp}</span>
                  <span className="num" style={{ fontSize: 13, color: "var(--ink)" }}>{r.amt}</span>
                  <span className="num" style={{ fontSize: 12, color: "var(--ink-mute)" }}>{r.due}</span>
                  <CxStatus tone={st}>{sl}</CxStatus>
                </div>
              );
            })}
          </CxPanel>

          {/* Right: cost + invoices */}
          <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <CxPanel title="成本与毛利">
              <div style={{ fontSize: 12.5 }}>
                {costs.map(([k, v], i) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i === costs.length - 1 ? "none" : "1px solid var(--line-soft)", fontWeight: i === costs.length - 1 ? 500 : 400 }}>
                    <span style={{ color: i === costs.length - 1 ? "var(--ink)" : "var(--ink-mute)" }}>{k}</span>
                    <span className="num" style={{ color: "var(--ink)" }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--accent-bg)", borderRadius: "var(--r-sm)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--accent-ink)" }}>预估毛利</span>
                <span className="num" style={{ fontSize: 15, fontWeight: 500, color: "var(--accent-ink)" }}>¥118 万 · 42%</span>
              </div>
            </CxPanel>

            <CxPanel title="开票记录">
              {invoices.map((iv, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i === invoices.length - 1 ? "none" : "1px solid var(--line-soft)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="num" style={{ fontSize: 12, color: "var(--ink)" }}>{iv.code}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>{iv.date}</div>
                  </div>
                  <span className="num" style={{ fontSize: 13, color: "var(--ink)" }}>{iv.amt}</span>
                  <CxStatus tone={iv.tone}>{iv.status}</CxStatus>
                </div>
              ))}
            </CxPanel>
          </aside>
        </div>
      </div>
    </CxProjectShell>
  );
}

Object.assign(window, { CxProjectDocs, CxProjectNotes, CxProjectFinance });
