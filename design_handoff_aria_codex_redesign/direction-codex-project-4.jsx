// direction-codex-project-4.jsx — Docs + Notes + remaining secondary pages

/* ============================================================
   8) Docs — Documents linked to this project
   ============================================================ */
function CxProjectDocs() {
  const docs = [
    { code: "DOC-0042", title: "鼎和保险 续保业务深度访谈记录", type: "DOC", size: "1.2 MB", who: "林宥", date: "2026-05-15", tags: ["访谈", "续保"], summary: "针对续保团队 4 位负责人进行的深度访谈,识别出 12 个关键痛点。", source: "本地上传" },
    { code: "DOC-0091", title: "申通快运 项目周报合集 Q2", type: "DOC", size: "3.1 MB", who: "陈悦", date: "2026-05-08", tags: ["周报"], summary: "Q2 周报合集,包含里程碑与风险跟踪。", source: "知识库" },
    { code: "DOC-0042b", title: "客户访谈纪要 V3", type: "DOC", size: "920 KB", who: "林宥", date: "2026-05-26", tags: ["访谈"], summary: "更新版 — 补充了关于数据治理边界的讨论。", source: "本地上传" },
    { code: "MEM-0012", title: "项目记忆快照 v12", type: "MEM", size: "—",     who: "Aria", date: "2026-05-28", tags: ["记忆", "自动"], summary: "由 11 次对话 + 12 份文档汇总的结构化记忆。", source: "自动生成" },
    { code: "DOC-0008", title: "数据治理 POC 评估方案 v0.3", type: "PDF", size: "2.4 MB", who: "苏明", date: "2026-05-22", tags: ["技术", "POC"], summary: "POC 评估的范围、指标定义与方法。", source: "本地上传" },
    { code: "OUT-0001", title: "会前简报 · 6 月 3 日例会", type: "MD", size: "12 KB", who: "Aria", date: "2026-05-28", tags: ["简报", "输出"], summary: "为 6 月 3 日例会生成的 30 秒卡 + 话术。", source: "Skill 输出" },
  ];
  return (
    <CxProjectShell activeTab="docs">
      <div style={{ height: "100%", overflow: "hidden", padding: "24px 40px 32px", display: "grid", gridTemplateColumns: "1fr 260px", gap: 24, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <h2 className="ui" style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.015em" }}>文档 · {docs.length} 份</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-mute)" }}>已全部进入项目记忆索引</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "6px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}>
                <I name="paperclip" size={11} stroke={1.5}/> 从知识库链接
              </button>
              <button style={{ padding: "6px 12px", fontSize: 12, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>+ 上传</button>
            </div>
          </div>

          {/* Filter chips */}
          <div style={{ display: "flex", gap: 6 }}>
            {["全部", "本地上传", "知识库链接", "Skill 输出", "自动生成"].map((t, i) => (
              <button key={t} style={{ padding: "5px 12px", borderRadius: "var(--r-sm)", background: i === 0 ? "var(--ink)" : "transparent", color: i === 0 ? "var(--bg-elev)" : "var(--ink-soft)", border: i === 0 ? "1px solid var(--ink)" : "1px solid var(--line)", fontSize: 12 }}>
                {t}
              </button>
            ))}
          </div>

          {/* Doc list */}
          <div>
            {docs.map(d => (
              <a key={d.code} className="row-hov" style={{ display: "grid", gridTemplateColumns: "50px 1fr 100px 90px 14px", padding: "14px 8px", gap: 14, alignItems: "flex-start", borderBottom: "1px solid var(--line-soft)", borderRadius: "var(--r-sm)" }}>
                <span style={{ fontSize: 10, color: "var(--ink-mute)", padding: "3px 8px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", textAlign: "center", letterSpacing: "0.04em", justifySelf: "start" }}>{d.type}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{d.title}</div>
                  <p style={{ margin: "3px 0 6px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.55, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{d.summary}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--ink-mute)", flexWrap: "wrap" }}>
                    <span>{d.who} 上传</span>
                    <span style={{ color: "var(--ink-faint)" }}>·</span>
                    <span>{d.source}</span>
                    {d.tags.map(t => (
                      <span key={t} style={{ color: "var(--accent)" }}>#{t}</span>
                    ))}
                  </div>
                </div>
                <span className="num" style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{d.size}</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{d.date}</span>
                <I name="arrow-right" size={12} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
              </a>
            ))}
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CxPanel title="文档来源分布">
            <div style={{ fontSize: 12.5, lineHeight: 1.85 }}>
              {[
                ["本地上传", 3], ["知识库链接", 1], ["Skill 输出", 1], ["自动生成", 1],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                  <span style={{ color: "var(--ink-mute)" }}>{k}</span>
                  <span className="num" style={{ color: "var(--ink)" }}>{v}</span>
                </div>
              ))}
            </div>
          </CxPanel>

          <CxPanel title="高引用文档">
            {[
              { t: "项目记忆快照 v12", n: 47 },
              { t: "客户访谈纪要 V3",  n: 23 },
              { t: "POC 评估方案 v0.3", n: 18 },
            ].map((d, i) => (
              <div key={i} style={{ display: "flex", padding: "7px 0", borderBottom: i === 2 ? "none" : "1px solid var(--line-soft)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.t}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>被引用 {d.n} 次</div>
                </div>
              </div>
            ))}
          </CxPanel>
        </aside>
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

Object.assign(window, { CxProjectDocs, CxProjectNotes });
