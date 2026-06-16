// direction-codex-projects.jsx — Projects index. Classified into 商务阶段 (5-stage pipeline) + 交付阶段 (delivery + archived list).

function CxProjects() {
  const CATS = {
    presale: { z: "商务阶段", tone: "accent", lead: "从线索发现到合同签约 — 商务推进管线",
      stages: [
        { key: "lead",        z: "线索发现", sub: "初步接触 · 需求挖掘" },
        { key: "qualify",     z: "商机确认", sub: "需求明确 · 预算确认" },
        { key: "proposal",    z: "方案投标", sub: "方案设计 · 投标应标" },
        { key: "negotiation", z: "商务谈判", sub: "价格商议 · 条款确定" },
        { key: "contract",    z: "合同签订", sub: "合同签署 · 正式立项" },
      ]},
    delivery: { z: "交付阶段", tone: "good", lead: "交付中与已归档的项目 — 关注进度、健康度与结果" },
  };
  const P = [
    { name: "华兴生物 · AI 售前评估",  client: "华兴生物", owner: "陈悦", cat: "presale", stage: "lead",        amt: 0,   stale: false, updated: "3 天前", next: "首次需求沟通" },
    { name: "顺驰物流 · 智能调度调研",  client: "顺驰物流", owner: "苏明", cat: "presale", stage: "lead",        amt: 0,   stale: false, updated: "5 天前", next: "需求摸底" },
    { name: "东阿阿胶 · 新业务策略",    client: "东阿阿胶", owner: "林宥", cat: "presale", stage: "qualify",     amt: 320, stale: false, updated: "今天",   next: "战略对齐会" },
    { name: "浩瀚科技 · RFP 应答",      client: "浩瀚科技", owner: "苏明", cat: "presale", stage: "qualify",     amt: 260, stale: false, updated: "今早",   next: "招标文件澄清" },
    { name: "鼎和保险 · 数字化转型咨询",client: "鼎和保险", owner: "陈悦", cat: "presale", stage: "proposal",    amt: 280, stale: false, updated: "2 小时前",next: "Q3 W1 POC 报告" },
    { name: "瑞康医药 · 数据中台 POC",  client: "瑞康医药", owner: "陈悦", cat: "presale", stage: "proposal",    amt: 380, stale: true,  updated: "2 天前", next: "POC 指标对齐" },
    { name: "中信地产 · 智慧园区",      client: "中信地产", owner: "林宥", cat: "presale", stage: "proposal",    amt: 420, stale: true,  updated: "昨天",   next: "方案 V2 提交" },
    { name: "明德制造 · 智能质检",      client: "明德制造", owner: "苏明", cat: "presale", stage: "negotiation", amt: 300, stale: false, updated: "今天",   next: "商务终审 · 报价确认" },
    { name: "长虹电器 · 数据治理平台",  client: "长虹电器", owner: "陈悦", cat: "presale", stage: "contract",    amt: 520, stale: false, updated: "今天",   next: "合同用印 · 法务复核" },
    { name: "金辉医疗 · 知识库迁移",    client: "金辉医疗", owner: "苏明", cat: "delivery", stage: "live", amt: 180, stale: false, updated: "1 周前", done: 1, total: 8, health: "ok",    ms: "项目启动会",   msdate: "06/14" },
    { name: "联泰集团 · 智能客服",      client: "联泰集团", owner: "陈悦", cat: "delivery", stage: "live", amt: 240, stale: false, updated: "3 天前", done: 2, total: 10,health: "watch", ms: "现状调研访谈", msdate: "06/20" },
    { name: "申通快运 · 中台升级",      client: "申通快运", owner: "苏明", cat: "delivery", stage: "live", amt: 640, stale: false, updated: "今天",   done: 5, total: 9, health: "ok",    ms: "灰度上线评审", msdate: "06/12" },
    { name: "合规审查优化项目",         client: "正大集团", owner: "林宥", cat: "delivery", stage: "live", amt: 150, stale: true,  updated: "4 天前", done: 4, total: 7, health: "risk",  ms: "方案评审",     msdate: "逾期 2 天" },
    { name: "鼎和保险 · 续保数据闭环",  client: "鼎和保险", owner: "陈悦", cat: "delivery", stage: "live", amt: 280, stale: false, updated: "昨天",   done: 6, total: 9, health: "ok",    ms: "数据治理验收", msdate: "06/18" },
    { name: "星河零售 · 会员中台",      client: "星河零售", owner: "陈悦", cat: "delivery", stage: "archived", amt: 360, outcome: "won",  closed: "2026-03" },
    { name: "长风物流 · 调度优化",      client: "长风物流", owner: "苏明", cat: "delivery", stage: "archived", amt: 200, outcome: "won",  closed: "2026-02" },
    { name: "恒益银行 · 风控咨询",      client: "恒益银行", owner: "林宥", cat: "delivery", stage: "archived", amt: 0,   outcome: "lost", closed: "2026-01" },
  ];

  const [cat, setCat] = React.useState("presale");
  const fmtAmt = a => a > 0 ? "¥" + a + "万" : "—";
  const sumAmt = list => { const t = list.reduce((s, p) => s + (p.amt || 0), 0); return t > 0 ? "¥" + t.toLocaleString() + "万" : "—"; };
  const pct = p => Math.round((p.done || 0) / (p.total || 1) * 100);
  const inCat = c => P.filter(p => p.cat === c);
  const presaleStageList = k => P.filter(p => p.cat === "presale" && p.stage === k);
  const active = P.filter(p => p.cat === "delivery" && p.stage === "live");
  const archived = P.filter(p => p.cat === "delivery" && p.stage === "archived");
  const pipeAmt = P.filter(p => p.cat === "presale").reduce((s, p) => s + p.amt, 0);
  const staleN = P.filter(p => p.stale).length;
  const healthMap = { ok: ["正常", "good"], watch: ["需关注", "warn"], risk: ["风险", "bad"] };
  const healthColor = h => h === "risk" ? "var(--bad)" : h === "watch" ? "var(--warn)" : "var(--good)";

  const tabIcon = { presale: "trending", delivery: "truck" };

  const Card = ({ p }) => (
    <a className="row-hov" style={{ display: "block", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "13px 14px", cursor: "pointer", textDecoration: "none" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span className="ui" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.name}</span>
        {p.stale && <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--warn)", flexShrink: 0, marginTop: 6, boxShadow: "0 0 0 3px color-mix(in oklch, var(--warn) 22%, transparent)" }}/>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--ink-mute)", marginTop: 6 }}>
        <span style={{ width: 18, height: 18, borderRadius: 99, background: "var(--bg-tint)", border: "1px solid var(--line)", color: "var(--ink-mute)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 600, flexShrink: 0 }}>{p.client.slice(0, 1)}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.owner} · {p.updated}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--line-soft)" }}>
        <span className="num" style={{ fontSize: 13.5, fontWeight: 500, color: p.amt ? "var(--ink)" : "var(--ink-faint)" }}>{fmtAmt(p.amt)}</span>
        <span style={{ fontSize: 11, color: "var(--ink-mute)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{p.next}</span>
      </div>
    </a>
  );

  return (
    <CxShell activeKey="projects">
      <div style={{ flex: 1, padding: "24px 32px 0", overflow: "hidden", minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h1 className="ui" style={{ margin: 0, fontSize: 22, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>项目空间</h1>
            <div style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-mute)", display: "flex", alignItems: "center", gap: 9 }}>
              <span>{active.length + P.filter(p => p.cat === "presale").length} 个活跃项目</span><span style={{ color: "var(--ink-faint)" }}>·</span>
              <span>在谈管线 <span className="num" style={{ color: "var(--ink-soft)" }}>¥{pipeAmt.toLocaleString()}万</span></span><span style={{ color: "var(--ink-faint)" }}>·</span>
              <span style={{ color: "var(--warn)", display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor" }}/>{staleN} 个记忆待刷新</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", fontSize: 12.5, color: "var(--ink-soft)" }}>
              <I name="building" size={13} stroke={1.5} style={{ color: "var(--ink-mute)" }}/> 全部客户 <I name="chevron-down" size={10} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12.5, border: "1px solid var(--line)", borderRadius: "var(--r-sm)", color: "var(--ink-faint)", width: 160 }}>
              <I name="search" size={12} stroke={1.5}/> <span>搜索项目</span>
            </div>
            <button style={{ padding: "8px 15px", fontSize: 12.5, fontWeight: 600, color: "var(--bg-elev)", background: "var(--ink)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}>
              <I name="plus" size={12} stroke={1.8}/> 新建项目
            </button>
          </div>
        </div>

        {/* Category tabs */}
        <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          {Object.entries(CATS).map(([k, c]) => (
            <button key={k} onClick={() => setCat(k)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 18px 14px",
              borderBottom: cat === k ? `2px solid var(--${c.tone === "accent" ? "accent" : "good"})` : "2px solid transparent",
              marginBottom: -1, color: cat === k ? "var(--ink)" : "var(--ink-mute)",
            }}>
              <span style={{ fontSize: 14.5, fontWeight: 500, letterSpacing: "-0.01em" }}>{c.z}</span>
              <span className="num" style={{ fontSize: 11, color: cat === k ? "var(--ink-soft)" : "var(--ink-faint)", background: "var(--bg-tint)", padding: "1px 8px", borderRadius: 99 }}>{inCat(k).length}</span>
            </button>
          ))}
        </div>

        {/* Category meta */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 2px 4px", flexShrink: 0, fontSize: 12, color: "var(--ink-mute)" }}>
          <span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>{CATS[cat].lead}</span>
          <span style={{ flex: 1 }}/>
          {cat === "presale" ? (
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span className="num" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{sumAmt(P.filter(p => p.cat === "presale"))}</span><span style={{ fontSize: 11, color: "var(--ink-faint)" }}>在谈金额</span></span>
          ) : (
            <>
              <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span className="num" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{active.length}</span><span style={{ fontSize: 11, color: "var(--ink-faint)" }}>交付中</span></span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span className="num" style={{ fontSize: 14, color: "var(--bad)", fontWeight: 500 }}>{active.filter(p => p.health === "risk").length}</span><span style={{ fontSize: 11, color: "var(--ink-faint)" }}>风险</span></span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span className="num" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{archived.length}</span><span style={{ fontSize: 11, color: "var(--ink-faint)" }}>已归档</span></span>
            </>
          )}
        </div>

        {/* Content */}
        {cat === "presale" ? (
          <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", columnGap: 12, padding: "10px 0 22px" }}>
            {CATS.presale.stages.map(s => {
              const list = presaleStageList(s.key);
              return (
                <div key={s.key} style={{ minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
                  <div style={{ padding: "11px 13px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--accent)", flexShrink: 0 }}/>
                      <span className="ui" style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)" }}>{s.z}</span>
                      <span className="num" style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--ink-faint)", background: "var(--bg-tint)", padding: "1px 7px", borderRadius: 99 }}>{list.length}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 5, paddingLeft: 15 }}>
                      <span style={{ fontSize: 10.5, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sub}</span>
                      <span className="num" style={{ fontSize: 10.5, color: "var(--ink-mute)", flexShrink: 0 }}>{sumAmt(list)}</span>
                    </div>
                  </div>
                  <div style={{ flex: 1, overflow: "auto", padding: 11, display: "flex", flexDirection: "column", gap: 10 }}>
                    {list.length ? list.map((p, i) => <Card key={i} p={p}/>) : <div style={{ fontSize: 11.5, color: "var(--ink-faint)", textAlign: "center", padding: "18px 0" }}>—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "12px 0 26px" }}>
            {/* 交付中 */}
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 6px 10px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}><span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--good)" }}/>交付中</span>
              <span className="num" style={{ fontSize: 11, color: "var(--ink-faint)" }}>{active.length}</span>
              <span style={{ flex: 1, height: 1, background: "var(--line)" }}/>
              <span className="num" style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{sumAmt(active)}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,2.4fr) 84px minmax(120px,1.3fr) 84px 92px minmax(150px,1.6fr)", gap: 18, padding: "4px 14px 6px", fontSize: 10.5, color: "var(--ink-faint)" }}>
              <span>项目 / 客户</span><span>状态</span><span>进度</span><span>健康</span><span>金额</span><span>下一里程碑</span>
            </div>
            {active.map((p, i) => {
              const [hl, ht] = healthMap[p.health];
              return (
                <a key={i} className="row-hov" style={{ display: "grid", gridTemplateColumns: "minmax(220px,2.4fr) 84px minmax(120px,1.3fr) 84px 92px minmax(150px,1.6fr)", gap: 18, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--line-soft)", borderRadius: "var(--r-md)", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <span style={{ width: 36, height: 36, borderRadius: 9, background: "var(--bg-tint)", border: "1px solid var(--line)", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{p.client.slice(0, 1)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span className="ui" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        {p.stale && <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--warn)", flexShrink: 0 }}/>}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>{p.client} · {p.owner}</div>
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 99, color: "var(--good)", background: "color-mix(in oklch, var(--good) 13%, transparent)", justifySelf: "start" }}>交付中</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }}><span className="num" style={{ color: "var(--ink-soft)" }}>{p.done}/{p.total}</span><span className="num" style={{ color: "var(--ink-faint)" }}>{pct(p)}%</span></div>
                    <div style={{ height: 5, borderRadius: 99, background: "var(--bg-tint)", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: pct(p) + "%", background: healthColor(p.health), borderRadius: 99 }}/></div>
                  </div>
                  <CxStatus tone={ht}>{hl}</CxStatus>
                  <span className="num" style={{ fontSize: 13, color: "var(--ink-soft)" }}>{fmtAmt(p.amt)}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: "var(--ink-faint)", fontSize: 10.5 }}>下一里程碑 </span>{p.ms}<span className="num" style={{ color: "var(--ink-faint)", fontSize: 10.5 }}> · {p.msdate}</span></span>
                </a>
              );
            })}

            {/* 已归档 */}
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 6px 10px", marginTop: 18 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}><span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--ink-faint)" }}/>已归档</span>
              <span className="num" style={{ fontSize: 11, color: "var(--ink-faint)" }}>{archived.length}</span>
              <span style={{ flex: 1, height: 1, background: "var(--line)" }}/>
            </div>
            {archived.map((p, i) => {
              const won = p.outcome === "won";
              return (
                <a key={i} className="row-hov" style={{ display: "grid", gridTemplateColumns: "minmax(220px,2.4fr) 84px minmax(120px,1.3fr) 84px 92px minmax(150px,1.6fr)", gap: 18, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--line-soft)", borderRadius: "var(--r-md)", cursor: "pointer", opacity: 0.8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <span style={{ width: 36, height: 36, borderRadius: 9, background: "var(--bg-tint)", border: "1px solid var(--line)", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{p.client.slice(0, 1)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="ui" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>{p.client} · {p.owner}</div>
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 99, justifySelf: "start", color: won ? "var(--good)" : "var(--ink-mute)", background: won ? "color-mix(in oklch, var(--good) 13%, transparent)" : "var(--bg-tint)" }}>{won ? "赢单交付" : "输单流失"}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>已归档</span>
                  <span/>
                  <span className="num" style={{ fontSize: 13, color: "var(--ink-soft)" }}>{fmtAmt(p.amt)}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-soft)" }}><span style={{ color: "var(--ink-faint)", fontSize: 10.5 }}>结案 </span>{p.closed}</span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </CxShell>
  );
}

Object.assign(window, { CxProjects });
