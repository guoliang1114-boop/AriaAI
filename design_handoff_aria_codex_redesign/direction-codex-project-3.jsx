// direction-codex-project-3.jsx — Stakeholders + Milestones + Todos + Docs + Notes tabs

/* ============================================================
   5) Stakeholders — table + cards
   ============================================================ */
function CxProjectStakeholders() {
  const stakeholders = [
    { n: "王浩",  r: "CTO",         lvl: "决策", rel: "支持", concerns: "技术方案的可控性 · 偏好先小范围验证", last: "2026-05-22 例会", influence: 90 },
    { n: "张丽",  r: "COO",         lvl: "决策", rel: "支持", concerns: "业务 KPI 兑现 · 担心组织变革节奏过快",   last: "2026-05-22 例会", influence: 70 },
    { n: "王凯",  r: "数字化办公室", lvl: "影响", rel: "推动", concerns: "需要明确执行清单 · 是协调方而非决策方",   last: "2026-05-26 邮件",   influence: 55 },
    { n: "李远",  r: "CFO",         lvl: "影响", rel: "中立", concerns: "项目预算与 ROI · 可能列席关键节点",         last: "未直接接触",        influence: 40 },
    { n: "张博",  r: "续保业务负责人", lvl: "执行", rel: "积极", concerns: "续保转化率指标 · 急需数据闭环工具",         last: "2026-05-15 访谈", influence: 30 },
    { n: "刘洁",  r: "数据治理团队",   lvl: "执行", rel: "中立", concerns: "数据脱敏与权限合规 · 评估工作量",            last: "2026-05-08 评估",  influence: 25 },
  ];
  return (
    <CxProjectShell activeTab="stakeholders">
      <div style={{ height: "100%", overflow: "hidden", padding: "24px 40px 32px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <h2 className="ui" style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.015em" }}>关键干系人 · 6 人</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-mute)" }}>2 决策 · 2 影响 · 2 执行 · 与客户档案自动联动</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "6px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>从客户记忆同步</button>
              <button style={{ padding: "6px 12px", fontSize: 12, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>+ 添加</button>
            </div>
          </div>

          {/* Influence map row */}
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 className="ui" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>影响力地图</h3>
              <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>横轴:影响力 · 圆点大小:支持度</span>
            </div>
            <div style={{ position: "relative", height: 80, borderBottom: "1px solid var(--line-soft)" }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: "var(--line-soft)" }}/>
              {stakeholders.map((s, i) => {
                const support = s.rel === "支持" ? 80 : s.rel === "积极" ? 78 : s.rel === "推动" ? 60 : 50;
                const size = s.rel === "支持" ? 22 : s.rel === "积极" ? 18 : 16;
                return (
                  <div key={s.n} style={{
                    position: "absolute",
                    left: `${s.influence}%`,
                    bottom: `${support}%`,
                    transform: "translate(-50%, 50%)",
                  }}>
                    <span style={{ width: size, height: size, borderRadius: 99, background: s.rel === "支持" || s.rel === "积极" ? "var(--accent-bg)" : "var(--bg-tint)", color: s.rel === "支持" || s.rel === "积极" ? "var(--accent-ink)" : "var(--ink-soft)", border: `1.5px solid ${s.rel === "支持" || s.rel === "积极" ? "var(--accent)" : "var(--line-strong)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 500 }}>{s.n[0]}</span>
                  </div>
                );
              })}
              <div style={{ position: "absolute", bottom: -16, left: 0, fontSize: 10, color: "var(--ink-faint)" }}>低影响</div>
              <div style={{ position: "absolute", bottom: -16, right: 0, fontSize: 10, color: "var(--ink-faint)" }}>高影响</div>
            </div>
          </div>

          {/* Table */}
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.6fr 0.7fr 1.4fr 0.8fr 14px", padding: "12px 16px", fontSize: 11, color: "var(--ink-faint)", borderBottom: "1px solid var(--line)" }}>
              <span>姓名 · 角色</span><span>层级</span><span>关系</span><span>影响</span><span>关注点</span><span>最近接触</span><span/>
            </div>
            {stakeholders.map((s, i, arr) => (
              <a key={s.n} className="row-hov" style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 0.6fr 0.7fr 1.4fr 0.8fr 14px", padding: "14px 16px", gap: 12, alignItems: "center", borderTop: i === 0 ? "none" : "1px solid var(--line-soft)" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>{s.n[0]}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{s.n}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{s.r}</div>
                  </div>
                </div>
                <CxStatus tone={s.lvl === "决策" ? "accent" : s.lvl === "影响" ? "neutral" : "mute"}>{s.lvl}</CxStatus>
                <span style={{ fontSize: 12, color: s.rel === "支持" || s.rel === "积极" ? "var(--good)" : s.rel === "中立" ? "var(--ink-mute)" : "var(--warn)" }}>{s.rel}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ flex: 1, height: 3, background: "var(--bg-sunken)", borderRadius: 99 }}>
                    <div style={{ height: "100%", width: `${s.influence}%`, background: "var(--accent)", borderRadius: 99 }}/>
                  </div>
                  <span className="num" style={{ fontSize: 11, color: "var(--ink-mute)" }}>{s.influence}</span>
                </div>
                <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{s.concerns}</div>
                <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{s.last}</span>
                <I name="arrow-right" size={12} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
              </a>
            ))}
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CxPanel title="客户决策结构">
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              <div style={{ paddingBottom: 10, borderBottom: "1px solid var(--line-soft)", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>最终决策</div>
                <div className="ui" style={{ color: "var(--ink)", fontWeight: 500, marginTop: 2 }}>CTO 王浩 + COO 张丽 双签</div>
              </div>
              <div style={{ paddingBottom: 10, borderBottom: "1px solid var(--line-soft)", marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>预算审批</div>
                <div className="ui" style={{ color: "var(--ink)", marginTop: 2 }}>CFO 李远 · ¥300 万以上需董事会</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>执行推动</div>
                <div className="ui" style={{ color: "var(--ink)", marginTop: 2 }}>数字化办公室 王凯</div>
              </div>
            </div>
          </CxPanel>

          <CxPanel title="沟通节奏建议">
            {[
              { who: "CTO 王浩", w: "技术细节先邮件 · 关键节点面对面", tone: "accent" },
              { who: "COO 张丽", w: "数字优先 · 一页纸结论",       tone: "accent" },
              { who: "王凯",     w: "执行清单 + 双周对齐",        tone: "neutral" },
            ].map(s => (
              <div key={s.who} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                <span style={{ width: 5, height: 5, marginTop: 7, borderRadius: 99, background: s.tone === "accent" ? "var(--accent)" : "var(--ink-faint)", flexShrink: 0 }}/>
                <div style={{ flex: 1 }}>
                  <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500 }}>{s.who}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>{s.w}</div>
                </div>
              </div>
            ))}
          </CxPanel>

          <CxPanel title="AI 提示" subtitle="基于干系人画像">
            <div style={{ background: "var(--accent-bg)", padding: "10px 12px", borderRadius: "var(--r-sm)", fontSize: 12.5, color: "var(--accent-ink)", lineHeight: 1.6 }}>
              <I name="sparkle" size={11} stroke={1.5} style={{ marginRight: 4, verticalAlign: -1 }}/>
              CFO 李远尚未直接接触,但可能影响预算 — 建议下次例会前安排一次单独沟通。
            </div>
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  );
}

/* ============================================================
   6) Milestones — vertical timeline + status panel
   ============================================================ */
function CxProjectMilestones() {
  const milestones = [
    { d: "04/12", t: "项目立项", s: "done",        owner: "陈悦", note: "客户对齐项目目标与边界" },
    { d: "04/26", t: "需求调研完成", s: "done",    owner: "林宥", note: "完成 8 次客户访谈" },
    { d: "05/15", t: "方案 V1 提交", s: "done",   owner: "陈悦", note: "客户初步反馈积极" },
    { d: "06/03", t: "客户例会 · 进展同步", s: "next", owner: "陈悦", note: "本次准备会前简报" },
    { d: "06/30", t: "POC 评估报告", s: "in-progress", owner: "苏明", note: "数据治理 POC 阶段性结论" },
    { d: "07/14", t: "方案 V2 提交", s: "planned", owner: "陈悦", note: "纳入 POC 反馈后修订" },
    { d: "07/28", t: "客户决策评审", s: "planned", owner: "—",     note: "CTO + COO 双签" },
    { d: "08/31", t: "正式签约", s: "planned",     owner: "—",     note: "目标日期" },
  ];

  return (
    <CxProjectShell activeTab="milestones">
      <div style={{ height: "100%", overflow: "hidden", padding: "24px 40px 32px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <h2 className="ui" style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.015em" }}>里程碑 · 3 / 8 完成</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-mute)" }}>预计签约 2026-08-31 · 进度符合预期</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "6px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>导出甘特</button>
              <button style={{ padding: "6px 12px", fontSize: 12, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>+ 添加里程碑</button>
            </div>
          </div>

          {/* Progress strip */}
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <span className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500 }}>37%</span>
                <span style={{ fontSize: 12, color: "var(--ink-mute)", marginLeft: 8 }}>整体进度</span>
              </div>
              <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>4/12 → 8/31 · 共 141 天 · 已过 52 天</span>
            </div>
            <div style={{ height: 8, background: "var(--bg-sunken)", borderRadius: 99, overflow: "hidden", display: "flex" }}>
              <div style={{ width: "37%", background: "var(--accent)" }}/>
              <div style={{ width: "8%", background: "var(--accent-bg)" }}/>
            </div>
          </div>

          {/* Timeline */}
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "20px 24px" }}>
            <div style={{ position: "relative", paddingLeft: 22 }}>
              <div style={{ position: "absolute", left: 6, top: 8, bottom: 8, width: 1, background: "var(--line)" }}/>
              {milestones.map((m, i) => {
                const colors = { done: "var(--good)", "in-progress": "var(--accent)", next: "var(--accent)", planned: "var(--line-strong)" };
                const c = colors[m.s];
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 18, padding: "11px 0", borderBottom: i === milestones.length - 1 ? "none" : "1px solid var(--line-soft)", alignItems: "center", position: "relative" }}>
                    <span style={{
                      position: "absolute",
                      left: -22,
                      top: 17,
                      width: 13, height: 13, borderRadius: 99,
                      background: m.s === "done" || m.s === "in-progress" ? c : "var(--bg-elev)",
                      border: `1.5px solid ${c}`,
                      boxShadow: m.s === "next" ? `0 0 0 4px color-mix(in oklch, ${c} 20%, transparent)` : "none",
                    }}/>
                    <span className="num" style={{ fontSize: 12.5, color: m.s === "next" || m.s === "in-progress" ? "var(--accent)" : "var(--ink-mute)", fontWeight: 500 }}>{m.d}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: m.s === "done" || m.s === "next" || m.s === "in-progress" ? 500 : 400 }}>{m.t}</div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>负责人 {m.owner} · {m.note}</div>
                    </div>
                    {m.s === "done"        && <CxStatus tone="good">已完成</CxStatus>}
                    {m.s === "in-progress" && <CxStatus tone="accent" pulse>进行中</CxStatus>}
                    {m.s === "next"        && <CxStatus tone="accent">下一个</CxStatus>}
                    {m.s === "planned"     && <CxStatus tone="mute">计划</CxStatus>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Weekly todos (merged from former Todos tab) */}
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3 className="ui" style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>本周待办 · 5</h3>
                <CxStatus tone="warn">2 项高优</CxStatus>
                <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>· 由项目对话自动抽取</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{ fontSize: 11.5, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}><I name="sparkle" size={10} stroke={1.5}/> 从对话抽取</button>
                <button style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>+ 添加</button>
              </div>
            </div>
            {[
              { t: "整理鼎和保险周三例会准备材料", who: "陈悦", due: "今天 17:00", pri: "high" },
              { t: "准备 POC 评估指标定义文档",    who: "苏明", due: "明天",       pri: "high" },
              { t: "回复 CTO 关于灰度计划的问题",   who: "陈悦", due: "今天",       pri: "med" },
              { t: "联系客户法务确认脱敏方案",      who: "林宥", due: "本周",       pri: "med" },
              { t: "更新方案 V2 的组织变革章节",    who: "陈悦", due: "下周二",      pri: "low" },
            ].map((t, i, arr) => {
              const dueColor = t.due === "今天" || t.due.startsWith("今天") ? "var(--warn)" : t.due === "明天" ? "var(--accent)" : "var(--ink-mute)";
              return (
                <div key={i} className="row-hov" style={{ display: "grid", gridTemplateColumns: "20px 1fr 80px 80px", gap: 12, padding: "10px 8px", margin: "0 -8px", borderRadius: "var(--r-sm)", alignItems: "center", borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--line-soft)" }}>
                  <span style={{ width: 13, height: 13, borderRadius: 3, border: `1.5px solid ${t.pri === "high" ? "var(--accent)" : "var(--line-strong)"}`, flexShrink: 0 }}/>
                  <div className="ui" style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>{t.t}</div>
                  <span style={{ fontSize: 11.5, color: dueColor }}>{t.due}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{t.who[0]}</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{t.who}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ paddingTop: 10, marginTop: 6, borderTop: "1px solid var(--line-soft)", display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--ink-mute)" }}>
              <span>本周已完成 3 项 · 累计 12 项</span>
              <a style={{ color: "var(--accent)" }}>查看已完成 →</a>
            </div>
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CxPanel title="风险预警">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ padding: "10px 12px", background: "color-mix(in oklch, var(--warn) 8%, transparent)", border: "1px solid color-mix(in oklch, var(--warn) 25%, transparent)", borderRadius: "var(--r-sm)" }}>
                <div style={{ fontSize: 12, color: "var(--warn)", fontWeight: 500, marginBottom: 3 }}>○ POC 报告可能延期</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>客户脱敏数据尚未到位,影响 6/30 节点</div>
              </div>
              <div style={{ padding: "10px 12px", background: "color-mix(in oklch, var(--bad) 8%, transparent)", border: "1px solid color-mix(in oklch, var(--bad) 25%, transparent)", borderRadius: "var(--r-sm)" }}>
                <div style={{ fontSize: 12, color: "var(--bad)", fontWeight: 500, marginBottom: 3 }}>● 决策评审排期紧</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>7/28 评审 · 需提前 2 周对齐 CFO</div>
              </div>
            </div>
          </CxPanel>

          <CxPanel title="速度指标">
            <div style={{ fontSize: 12.5, lineHeight: 1.85 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>计划周期</span><span className="num">141 天</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>已用</span><span className="num">52 天 (37%)</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>平均里程碑间隔</span><span className="num">17 天</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>预测交付偏差</span><span className="num" style={{ color: "var(--warn)" }}>+3 天</span></div>
            </div>
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  );
}

/* ============================================================
   7) Todos
   ============================================================ */
function CxProjectTodos() {
  const todos = [
    { id: 1, t: "整理鼎和保险周三例会准备材料",         who: "陈悦", due: "今天 17:00", pri: "high",   done: false },
    { id: 2, t: "准备 POC 评估指标定义文档",            who: "苏明", due: "明天",       pri: "high",   done: false },
    { id: 3, t: "回复 CTO 王浩关于灰度计划的问题",       who: "陈悦", due: "今天",       pri: "med",    done: false },
    { id: 4, t: "联系客户法务确认数据脱敏方案",         who: "林宥", due: "本周",       pri: "med",    done: false },
    { id: 5, t: "更新方案 V2 的组织变革章节",           who: "陈悦", due: "下周二",      pri: "low",    done: false },
    { id: 6, t: "提交客户访谈纪要 V3 到知识库",          who: "林宥", due: "今天",       pri: "med",    done: true },
    { id: 7, t: "向苏明同步数据治理 POC 范围",            who: "陈悦", due: "昨天",       pri: "med",    done: true },
    { id: 8, t: "和 王凯 确认数字化办公室协调机制",       who: "陈悦", due: "5 月 22 日", pri: "high",   done: true },
  ];

  return (
    <CxProjectShell activeTab="todos">
      <div style={{ height: "100%", overflow: "hidden", padding: "24px 40px 32px", display: "grid", gridTemplateColumns: "1fr 280px", gap: 24, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <h2 className="ui" style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.015em" }}>待办 · {todos.filter(t => !t.done).length} / {todos.length}</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-mute)" }}>2 项高优 · 3 项今日截止 · 来自项目对话自动抽取</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "6px 12px", fontSize: 12, color: "var(--accent)", border: "1px solid var(--accent-bg)", background: "var(--accent-bg)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}>
                <I name="sparkle" size={11} stroke={1.5}/> 从对话抽取
              </button>
              <button style={{ padding: "6px 12px", fontSize: 12, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>+ 添加</button>
            </div>
          </div>

          {/* Open todos */}
          <CxPanel title="进行中" subtitle={`${todos.filter(t => !t.done).length} 项`}>
            {todos.filter(t => !t.done).map(t => {
              const dueColor = t.due === "今天" || t.due === "今天 17:00" ? "var(--warn)" : t.due === "明天" ? "var(--accent)" : "var(--ink-mute)";
              return (
                <div key={t.id} className="row-hov" style={{ display: "grid", gridTemplateColumns: "20px 1fr 80px 80px 14px", gap: 12, padding: "11px 8px", margin: "0 -8px", borderRadius: "var(--r-sm)", alignItems: "center", borderBottom: "1px solid var(--line-soft)" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${t.pri === "high" ? "var(--accent)" : "var(--line-strong)"}`, flexShrink: 0 }}/>
                  <div className="ui" style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.5 }}>{t.t}</div>
                  <span style={{ fontSize: 11.5, color: dueColor }}>{t.due}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10 }}>{t.who[0]}</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{t.who}</span>
                  </div>
                  <I name="more" size={12} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
                </div>
              );
            })}
          </CxPanel>

          {/* Done */}
          <CxPanel title="本周已完成" subtitle={`${todos.filter(t => t.done).length} 项`}>
            {todos.filter(t => t.done).map(t => (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "20px 1fr 80px 80px", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line-soft)", alignItems: "center" }}>
                <span style={{ width: 14, height: 14, borderRadius: 4, background: "var(--good)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <I name="check" size={9} stroke={2} style={{ color: "var(--bg-elev)" }}/>
                </span>
                <div style={{ fontSize: 13, color: "var(--ink-mute)", textDecoration: "line-through", textDecorationColor: "var(--ink-faint)" }}>{t.t}</div>
                <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{t.due}</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{t.who}</span>
              </div>
            ))}
          </CxPanel>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CxPanel title="本周工作量">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { l: "陈悦", v: 4, c: "var(--accent)" },
                { l: "林宥", v: 2, c: "var(--info)" },
                { l: "苏明", v: 1, c: "var(--good)" },
                { l: "Aria", v: 2, c: "var(--ink-mute)" },
              ].map(p => (
                <div key={p.l} style={{ padding: "10px 12px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)" }}>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{p.l}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                    <span className="num" style={{ fontSize: 20, color: "var(--ink)", fontWeight: 500 }}>{p.v}</span>
                    <span style={{ fontSize: 10.5, color: "var(--ink-mute)" }}>项</span>
                  </div>
                </div>
              ))}
            </div>
          </CxPanel>

          <CxPanel title="待办来源">
            <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>对话抽取</span><span className="num">3</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>会议纪要</span><span className="num">2</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>手动添加</span><span className="num">2</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>里程碑分解</span><span className="num">1</span></div>
            </div>
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  );
}

Object.assign(window, { CxProjectStakeholders, CxProjectMilestones, CxProjectTodos });
