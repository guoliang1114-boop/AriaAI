// direction-codex-part1.jsx — Codex style: Shell + Workspace + Chat + Project

/* ----------------- Helpers ----------------- */

// Tree-connector marker: └─ ├─ │
function CxTree({ last = false, vertical = false, indent = 0 }) {
  const g = vertical ? "│  " : (last ? "└─ " : "├─ ");
  return <span className="tree-pre" style={{ paddingLeft: indent * 16 }}>{g}</span>;
}

// "· status" pill — codex-style status indicator
function CxStatus({ tone = "neutral", pulse = false, children }) {
  const tones = {
    neutral: "var(--ink-mute)",
    accent: "var(--accent)",
    good: "var(--good)",
    warn: "var(--warn)",
    bad: "var(--bad)",
    info: "var(--info)",
    mute: "var(--ink-faint)",
  };
  const c = tones[tone] || tones.neutral;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: c, fontFamily: "var(--font-mono)" }}>
      <span className={pulse ? "dot-pulse" : ""} style={{ width: 6, height: 6, borderRadius: 99, background: c, display: "inline-block" }}/>
      {children}
    </span>
  );
}

function CxStatusByKey({ status }) {
  const map = {
    lead:        ["lead",       "mute"],
    opportunity: ["opportunity","warn"],
    won:         ["won",        "good"],
    delivering:  ["delivering", "accent"],
  };
  const [label, tone] = map[status] || ["—", "mute"];
  return <CxStatus tone={tone} pulse={tone === "accent"}>{label}</CxStatus>;
}

// "key = value" line
function CxKV({ k, v, mute = false }) {
  return (
    <div style={{ display: "flex", gap: 12, fontFamily: "var(--font-mono)", fontSize: 12, padding: "2px 0" }}>
      <span style={{ color: "var(--ink-faint)", minWidth: 80 }}>{k}</span>
      <span style={{ color: mute ? "var(--ink-mute)" : "var(--ink-soft)" }}>{v}</span>
    </div>
  );
}

// Section heading — clean, no command tags
function CxHead({ tag, children, action, style = {} }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, ...style }}>
      <h3 className="ui" style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--ink-mute)", letterSpacing: "0.01em" }}>
        {children}
      </h3>
      {action}
    </div>
  );
}

// Brand logo — small dark monogram with mono lowercase 'a'
// Replaces the green dot pattern with a more refined mark
function CxLogo({ size = 22, showWordmark = true, wordmarkSize }) {
  const ws = wordmarkSize || (size > 22 ? 17 : 15);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size, height: size,
        background: "var(--ink)",
        color: "var(--bg-elev)",
        borderRadius: 5,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        fontSize: Math.round(size * 0.58),
        flexShrink: 0,
        lineHeight: 1,
        letterSpacing: "-0.04em",
      }}>a</span>
      {showWordmark && (
        <span className="ui" style={{ fontSize: ws, color: "var(--ink)", fontWeight: 500, letterSpacing: "-0.02em" }}>
          Aria
        </span>
      )}
    </span>
  );
}

/* ----------------- Shell ----------------- */
function CxShell({ activeKey = "workspace", children }) {
  return (
    <div className="frame-codex" style={{ flexDirection: "column" }}>
      {/* Top bar — clean, just brand + nav + utilities */}
      <header style={{ height: 52, padding: "0 28px", display: "flex", alignItems: "center", gap: 28, borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <CxLogo size={22}/>
        </div>

        <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {NAV.map(n => {
            const active = n.key === activeKey;
            return (
              <a key={n.key} className="row-hov" style={{ padding: "6px 12px", borderRadius: "var(--r-sm)", fontSize: 13.5, color: active ? "var(--ink)" : "var(--ink-mute)", background: active ? "var(--bg-tint)" : "transparent", fontWeight: active ? 500 : 400 }}>
                {n.zh}
              </a>
            );
          })}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", fontSize: 13, border: "1px solid var(--line)", borderRadius: "var(--r-sm)", color: "var(--ink-mute)", width: 240 }}>
            <I name="search" size={13} stroke={1.5}/>
            <span>搜索项目、对话、技能</span>
            <span style={{ marginLeft: "auto", color: "var(--ink-faint)", fontSize: 11 }}>⌘K</span>
          </div>
          <button style={{ width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--ink-mute)" }}><I name="bell" size={15} stroke={1.5}/></button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}>陈</span>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Optional left rail — just for chat-style sub-nav (each page owns its own if needed) */}
        <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {children}
        </main>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------
   CX · Workspace
   ---------------------------------------------------------- */
function CxWorkspace() {
  return (
    <CxShell activeKey="workspace">
      <div style={{ flex: 1, padding: "36px 56px 40px", overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 300px", columnGap: 56, minWidth: 0 }}>
        {/* Left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 40, minWidth: 0 }}>
          {/* Greet */}
          <div>
            <div style={{ fontSize: 12.5, color: "var(--ink-mute)", marginBottom: 10 }}>
              2026 年 5 月 28 日 · 周四
            </div>
            <h1 className="ui" style={{ margin: 0, fontSize: 32, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              下午好,陈悦
            </h1>
            <p style={{ marginTop: 14, fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.7, maxWidth: 580 }}>
              今天有 <span style={{ color: "var(--ink)" }}>4 项待办</span>(其中 2 项高优)、<span style={{ color: "var(--ink)" }}>5 个进行中项目</span>、本周 3 个客户跟进。建议先做 <a style={{ color: "var(--accent)", borderBottom: "1px solid currentColor", paddingBottom: 1 }}>鼎和保险的会前简报</a>。
            </p>
          </div>

          {/* Quick skills */}
          <section>
            <CxHead action={<a style={{ fontSize: 12, color: "var(--ink-mute)" }}>查看全部 →</a>}>
              常用 Skill
            </CxHead>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              {[
                { title: "数字化战略分析", desc: "三层战略框架 · 行业洞察", n: 27, icon: "target" },
                { title: "会前简报", desc: "10 分钟生成一页纸", n: 23, icon: "calendar" },
                { title: "RFP 拆解", desc: "评分维度 · 响应大纲", n: 18, icon: "file" },
              ].map((q, i) => (
                <button key={i} className="row-hov" style={{ padding: "18px 18px", textAlign: "left", background: "var(--bg-elev)", borderRadius: "var(--r-md)", display: "flex", flexDirection: "column", gap: 10, minHeight: 140, border: "1px solid var(--line)" }}>
                  <div style={{ width: 30, height: 30, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <I name={q.icon} size={14} stroke={1.5}/>
                  </div>
                  <div className="ui" style={{ fontSize: 15.5, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.01em" }}>{q.title}</div>
                  <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-mute)", lineHeight: 1.55 }}>{q.desc}</div>
                  <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--ink-faint)" }}>
                    <span className="num">本月 {q.n} 次</span>
                    <span style={{ color: "var(--accent)" }}>调用 →</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Projects */}
          <section style={{ minHeight: 0 }}>
            <CxHead action={<a style={{ fontSize: 12, color: "var(--ink-mute)" }}>查看全部 →</a>}>
              进行中项目 · 5
            </CxHead>
            <div style={{ fontSize: 11, color: "var(--ink-faint)", padding: "6px 4px 8px", borderBottom: "1px solid var(--line)", display: "grid", gridTemplateColumns: "1fr 110px 100px 110px 14px", gap: 14 }}>
              <span>项目</span><span>状态</span><span>金额</span><span>记忆</span><span/>
            </div>
            {PROJECTS.slice(0, 5).map((p, i) => (
              <a key={p.id} className="row-hov" style={{ display: "grid", gridTemplateColumns: "1fr 110px 100px 110px 14px", padding: "13px 4px", gap: 14, alignItems: "center", borderBottom: i === 4 ? "none" : "1px solid var(--line-soft)" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.005em" }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>
                    {p.clientShort} · {p.owner} · {p.updated}
                  </div>
                </div>
                <CxStatusByKey status={p.status}/>
                <span className="num" style={{ fontSize: 13, color: "var(--ink-soft)" }}>{p.amount ? "¥" + (p.amount / 10000).toFixed(0) + "万" : "—"}</span>
                <CxStatus tone={p.memory.fresh ? "good" : "warn"}>{p.memory.fresh ? `已同步 · v${p.memory.v}` : "记忆过期"}</CxStatus>
                <I name="arrow-right" size={12} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
              </a>
            ))}
          </section>
        </div>

        {/* Right */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 36, minWidth: 0, borderLeft: "1px solid var(--line)", paddingLeft: 36 }}>
          <div>
            <CxHead action={<CxStatus tone="warn">2 项高优</CxStatus>}>今日待办 · 4</CxHead>
            {TODOS.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0" }}>
                <span style={{ width: 14, height: 14, marginTop: 3, borderRadius: 3, border: "1px solid var(--line-strong)", flexShrink: 0 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.45 }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>
                    {t.project} · {t.due}
                  </div>
                </div>
                {t.priority === "high" && <span style={{ width: 5, height: 5, borderRadius: 99, background: "var(--accent)", marginTop: 9, flexShrink: 0 }}/>}
              </div>
            ))}
          </div>

          <div>
            <CxHead action={<span style={{ fontSize: 11, color: "var(--ink-faint)" }}>未来 7 天</span>}>即将里程碑</CxHead>
            {MILESTONES.slice(0, 3).map((m) => (
              <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "8px 0" }}>
                <span className="num" style={{ fontSize: 12, color: "var(--accent)", paddingTop: 1, minWidth: 36 }}>{m.date}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.45 }}>{m.title}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>{m.project}</div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <CxHead action={<a style={{ fontSize: 11, color: "var(--accent)" }}>全部 →</a>}>最近对话</CxHead>
            {CONVERSATIONS.slice(0, 3).map((c) => (
              <a key={c.id} className="row-hov" style={{ display: "block", padding: "8px 8px", marginLeft: -8, borderRadius: "var(--r-sm)" }}>
                <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>{c.time}</div>
              </a>
            ))}
          </div>
        </aside>
      </div>
    </CxShell>
  );
}

/* ----------------------------------------------------------
   CX · Chat
   ---------------------------------------------------------- */
function CxChat() {
  return (
    <CxShell activeKey="chat">
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr 280px", minHeight: 0 }}>
        {/* Conversation list */}
        <aside style={{ borderRight: "1px solid var(--line)", padding: "20px 14px", overflow: "hidden", display: "flex", flexDirection: "column", gap: 6 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
            <I name="plus" size={13} stroke={1.5}/> 新建对话
            <span style={{ marginLeft: "auto", fontSize: 10.5, opacity: 0.6 }}>⌘N</span>
          </button>

          <div style={{ color: "var(--ink-faint)", fontSize: 11, padding: "6px 10px" }}>今天</div>
          {CONVERSATIONS.slice(0, 3).map((c, i) => (
            <a key={c.id} className="row-hov" style={{ display: "block", padding: "8px 10px", borderRadius: "var(--r-sm)", background: i === 0 ? "var(--bg-tint)" : "transparent", position: "relative" }}>
              {i === 0 && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 2, background: "var(--accent)", borderRadius: 99 }}/>}
              <div style={{ fontSize: 13, color: i === 0 ? "var(--ink)" : "var(--ink-soft)", fontWeight: i === 0 ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
              <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>{c.time}</div>
            </a>
          ))}

          <div style={{ color: "var(--ink-faint)", fontSize: 11, padding: "14px 10px 4px" }}>更早</div>
          {CONVERSATIONS.slice(3).map(c => (
            <a key={c.id} className="row-hov" style={{ display: "block", padding: "8px 10px", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 13, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
              <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>{c.time}</div>
            </a>
          ))}
        </aside>

        {/* Thread column */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Title strip */}
          <div style={{ padding: "18px 40px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ minWidth: 0 }}>
              <h2 className="ui" style={{ margin: 0, fontSize: 17, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.015em" }}>鼎和保险 · 数字化转型框架草稿</h2>
              <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 4, display: "flex", alignItems: "center", gap: 10 }}>
                <span>项目对话</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>gpt-5</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>12 条消息</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                <CxStatus tone="accent" pulse>正在回复</CxStatus>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "6px 12px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>导出</button>
              <button style={{ padding: "6px 10px", color: "var(--ink-mute)" }}><I name="more" size={14} stroke={1.5}/></button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, padding: "28px 40px", overflow: "hidden", display: "flex", flexDirection: "column", gap: 32 }}>
            {/* User */}
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span style={{ width: 30, height: 30, borderRadius: 99, background: "var(--bg-tint)", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, flexShrink: 0 }}>陈</span>
              <div style={{ flex: 1, paddingTop: 4, maxWidth: 640 }}>
                <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 6 }}>陈悦 · 14:32</div>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.75, color: "var(--ink)" }}>
                  帮我把鼎和保险的数字化转型咨询拆成一个三层战略框架,引用最近三次会议纪要,并提示风险点。
                </p>
              </div>
            </div>

            {/* Assistant */}
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span style={{ width: 30, height: 30, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <I name="sparkle" size={14} stroke={1.5}/>
              </span>
              <div style={{ flex: 1, paddingTop: 4, maxWidth: 680 }}>
                <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--accent-ink)", fontWeight: 500 }}>Aria</span>
                  <span>14:32 · gpt-5</span>
                  <span style={{ color: "var(--ink-faint)" }}>·</span>
                  <span>调用了 <span style={{ color: "var(--accent)" }}>数字化战略分析</span></span>
                </div>

                {/* Quiet tool-call summary — not raw command output */}
                <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
                  <div style={{ color: "var(--ink-mute)", marginBottom: 4 }}>检索了项目记忆与文档</div>
                  <div style={{ display: "flex", gap: 16, color: "var(--ink-faint)", fontSize: 11.5 }}>
                    <span>· 关键词「续保」 7 条</span>
                    <span>· 关键词「理赔」 5 条</span>
                    <span>· 2 份相关文档</span>
                  </div>
                </div>

                <p style={{ margin: "0 0 14px", fontSize: 14.5, lineHeight: 1.75, color: "var(--ink)" }}>
                  我把战略分成 <span style={{ color: "var(--accent-ink)", fontWeight: 500 }}>业务、技术、组织</span> 三层,基于过去三次会议纪要<sup style={{ color: "var(--accent)", fontSize: 11, marginLeft: 1 }}>[1][2][3]</sup>:
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 14, columnGap: 14, marginBottom: 14 }}>
                  {[
                    ["01", "业务层", "围绕续保与理赔两个高频场景,先建立数据闭环。"],
                    ["02", "技术层", "以现有核心系统为锚,搭建轻量中台与 AI 推理层。"],
                    ["03", "组织层", "设立 4 人 + 2 顾问的转型办公室,直接向 COO 汇报。"],
                  ].map(([n, t, d]) => (
                    <React.Fragment key={n}>
                      <span className="num" style={{ fontSize: 12, color: "var(--accent)", paddingTop: 3, fontWeight: 500 }}>{n}</span>
                      <div>
                        <div style={{ fontSize: 14.5, fontWeight: 500, color: "var(--ink)" }}>{t}</div>
                        <div style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.7, marginTop: 3 }}>{d}</div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>

                <p style={{ margin: "12px 0 0", fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.7 }}>
                  主要风险点 — 数据治理基础薄弱、组织变革阻力。建议在 POC 阶段锁定 CTO 王浩与 COO 张丽两位关键决策人<span className="cursor-blink"/>
                </p>
              </div>
            </div>
          </div>

          {/* Composer */}
          <div style={{ padding: "0 40px 22px" }}>
            <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "14px 16px" }}>
              <div className="ui" style={{ fontSize: 14, color: "var(--ink-faint)", minHeight: 42 }}>继续向 Aria 提问…</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line-soft)", fontSize: 12, color: "var(--ink-mute)" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <button style={{ display: "flex", alignItems: "center", gap: 5 }}><I name="paperclip" size={13} stroke={1.5}/> 附件</button>
                  <button style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--accent-ink)" }}>@ 鼎和保险</button>
                  <button style={{ display: "flex", alignItems: "center", gap: 5 }}>/ Skill</button>
                </div>
                <button style={{ padding: "5px 14px", background: "var(--accent)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                  发送 <I name="arrow-right" size={11} stroke={1.8}/>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Side — context & citations */}
        <aside style={{ borderLeft: "1px solid var(--line)", padding: "20px 22px", overflow: "hidden", display: "flex", flexDirection: "column", gap: 26 }}>
          <div>
            <CxHead>当前上下文</CxHead>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.85 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>项目</span><span>鼎和保险</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>记忆</span><span>v12 · <CxStatus tone="good">已同步</CxStatus></span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>文档</span><span className="num">12 份已索引</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>模型</span><span>gpt-5</span></div>
            </div>
          </div>

          <div>
            <CxHead>引用 · 3 条</CxHead>
            {[
              { n: 1, title: "战略对齐会纪要", src: "项目记忆 · 2026-05-22", score: 0.94, snippet: "Q3 完成首批数据闭环试点,理赔优先。" },
              { n: 2, title: "续保业务深度访谈", src: "文档 · 2026-05-15", score: 0.87, snippet: "续保到期前 30 天为关键触达窗口,转化率 38%。" },
              { n: 3, title: "项目记忆 v12", src: "记忆 · 2026-05-26", score: 0.81, snippet: "CTO 王浩主导技术评估,COO 张丽业务推动。" },
            ].map(r => (
              <div key={r.n} style={{ paddingTop: 12, marginTop: 12, borderTop: "1px solid var(--line-soft)" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}><span style={{ color: "var(--accent)" }}>[{r.n}]</span> {r.src}</span>
                  <span className="num" style={{ fontSize: 11, color: "var(--ink-faint)" }}>{r.score}</span>
                </div>
                <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, marginBottom: 4 }}>{r.title}</div>
                <p style={{ margin: 0, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.6 }}>"{r.snippet}"</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </CxShell>
  );
}

/* ----------------------------------------------------------
   CX · Project Detail
   ---------------------------------------------------------- */
function CxProjectDetail() {
  return (
    <CxShell activeKey="projects">
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
        {/* Breadcrumb + tabs */}
        <div style={{ padding: "0 40px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", flexShrink: 0, height: 42 }}>
          <div style={{ fontSize: 12, color: "var(--ink-mute)", marginRight: "auto" }}>
            <a style={{ color: "var(--ink-faint)" }}>项目</a>
            <span style={{ margin: "0 8px", color: "var(--ink-faint)" }}>/</span>
            <span style={{ color: "var(--ink-soft)" }}>鼎和保险</span>
          </div>
          <div style={{ display: "flex", gap: 0 }}>
            {PROJECT_TABS.slice(0, 8).map((t, i) => (
              <a key={t.key} style={{ padding: "12px 14px", fontSize: 13, color: i === 0 ? "var(--ink)" : "var(--ink-mute)", fontWeight: i === 0 ? 500 : 400, borderBottom: i === 0 ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1 }}>
                {t.zh}
              </a>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, padding: "32px 40px 40px", overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 300px", columnGap: 48, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 36, minWidth: 0 }}>
            {/* Hero */}
            <div>
              <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <CxStatusByKey status="opportunity"/>
                <span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>更新于 2 小时前</span>
                <span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>记忆 v12</span>
                <span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>12 份文档</span>
              </div>
              <h1 className="ui" style={{ margin: 0, fontSize: 30, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>鼎和保险 · 数字化转型咨询</h1>
              <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.7, maxWidth: 640 }}>
                围绕续保与理赔两个高频场景搭建数据闭环,Q3 完成首批试点。客户决策方:CTO 王浩。
              </p>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "18px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
              {[
                { l: "合同金额",   v: "¥280", u: "万",   note: "预估" },
                { l: "Skill 调用", v: "47",   u: "次",   note: "本月" },
                { l: "对话条数",   v: "128",  u: "",     note: "累计" },
                { l: "里程碑",     v: "3",    u: "/ 8",  note: "已完成" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "0 22px", borderLeft: i > 0 ? "1px solid var(--line-soft)" : "none" }}>
                  <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 8 }}>{s.l}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <span className="num" style={{ fontSize: 26, fontWeight: 500, color: "var(--ink)" }}>{s.v}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{s.u}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 4 }}>{s.note}</div>
                </div>
              ))}
            </div>

            {/* Memory excerpt — clean key/value */}
            <section>
              <CxHead action={<a style={{ fontSize: 12, color: "var(--accent)" }}>编辑槽位 →</a>}>
                项目记忆摘要 · v12 · 自动汇总
              </CxHead>
              <div>
                {[
                  { k: "客户背景",  v: "鼎和保险股份有限公司,深圳总部,3 万员工,2025 总保费收入 480 亿。" },
                  { k: "核心痛点",  v: "续保转化下滑、理赔体验差、数据散落在 5 个核心系统。" },
                  { k: "我方方案",  v: "三层框架(业务/技术/组织),先做续保 + 理赔数据闭环。" },
                  { k: "决策链",    v: "CTO 王浩(技术拍板)· COO 张丽(业务背书)· 数字化办公室 王凯。" },
                  { k: "下一步",    v: "Q3 第一周交付 POC 评估报告;第三周提案 V2。" },
                ].map((s, i, arr) => (
                  <div key={s.k} style={{ display: "grid", gridTemplateColumns: "110px 1fr", padding: "13px 0", gap: 24, alignItems: "flex-start", borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--line-soft)" }}>
                    <div style={{ fontSize: 12.5, color: "var(--ink-mute)", paddingTop: 1 }}>{s.k}</div>
                    <div style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.7 }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Rail */}
          <aside style={{ display: "flex", flexDirection: "column", gap: 32, borderLeft: "1px solid var(--line)", paddingLeft: 32 }}>
            <div>
              <CxHead>里程碑 · 3 / 8</CxHead>
              {MILESTONES.map(m => (
                <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "8px 0" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, marginTop: 6, background: m.status === "done" ? "var(--good)" : m.status === "in-progress" ? "var(--accent)" : "transparent", border: `1.5px solid ${m.status === "done" ? "var(--good)" : m.status === "in-progress" ? "var(--accent)" : "var(--line-strong)"}`, flexShrink: 0 }}/>
                  <span className="num" style={{ fontSize: 11.5, color: "var(--accent)", paddingTop: 1, minWidth: 36 }}>{m.date}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.45 }}>{m.title}</div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <CxHead>团队 · 3 人</CxHead>
              {[
                { n: "陈悦", r: "项目经理" },
                { n: "林宥", r: "解决方案" },
                { n: "苏明", r: "数据顾问" },
              ].map(p => (
                <div key={p.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                  <span style={{ width: 26, height: 26, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>{p.n[0]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 13, color: "var(--ink)" }}>{p.n}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{p.r}</div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <CxHead>最近动态</CxHead>
              <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.85 }}>
                <div><span style={{ color: "var(--ink-mute)", marginRight: 6 }}>14:18</span>陈悦更新了项目记忆 v12</div>
                <div><span style={{ color: "var(--ink-mute)", marginRight: 6 }}>11:02</span>Aria 调用了 会前简报 Skill</div>
                <div><span style={{ color: "var(--ink-mute)", marginRight: 6 }}>09:30</span>林宥上传了 2 份文档</div>
                <div><span style={{ color: "var(--ink-mute)", marginRight: 6 }}>昨天</span>Aria 完成了记忆增量索引</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </CxShell>
  );
}

Object.assign(window, { CxShell, CxStatus, CxStatusByKey, CxHead, CxKV, CxTree, CxWorkspace, CxChat, CxProjectDetail });
