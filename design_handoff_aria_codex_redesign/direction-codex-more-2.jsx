// direction-codex-more-2.jsx — Skill Detail · Welcome · NotFound · Contacts

/* ============================================================
   Skill Detail — opened from skill library, can be run
   ============================================================ */
function CxSkillDetail() {
  return (
    <CxShell activeKey="skills">
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
        {/* Header */}
        <div style={{ padding: "22px 40px 0", flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 10 }}>
            <a style={{ color: "var(--ink-faint)" }}>Skill 库</a>
            <span style={{ margin: "0 6px", color: "var(--ink-faint)" }}>/</span>
            <span style={{ color: "var(--ink-faint)" }}>战略</span>
            <span style={{ margin: "0 6px", color: "var(--ink-faint)" }}>/</span>
            <span>数字化战略分析</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
            <div style={{ display: "flex", gap: 16, minWidth: 0 }}>
              <span style={{ width: 48, height: 48, borderRadius: "var(--r-md)", background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><I name="target" size={18} stroke={1.5}/></span>
              <div style={{ minWidth: 0 }}>
                <h1 className="ui" style={{ margin: 0, fontSize: 24, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>数字化战略分析</h1>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-soft)", maxWidth: 580, lineHeight: 1.6 }}>
                  结合行业洞察 + 客户上下文,产出 业务 / 技术 / 组织 三层战略框架,以及关键风险点提示。
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "7px 12px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}>★ 收藏</button>
              <button style={{ padding: "7px 12px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>编辑模板</button>
              <button style={{ padding: "7px 14px", fontSize: 12.5, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}>
                <I name="sparkle" size={12} stroke={1.5}/> 调用 Skill
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ padding: "0 40px", marginTop: 16, borderBottom: "1px solid var(--line)", display: "flex", flexShrink: 0 }}>
          {[
            { k: "overview", l: "概览", active: true },
            { k: "template", l: "提示词模板" },
            { k: "history", l: "调用历史" },
            { k: "settings", l: "设置" },
          ].map(t => (
            <a key={t.k} style={{ padding: "10px 12px", fontSize: 13, color: t.active ? "var(--ink)" : "var(--ink-mute)", fontWeight: t.active ? 500 : 400, borderBottom: t.active ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1 }}>
              {t.l}
            </a>
          ))}
        </div>

        <div style={{ flex: 1, overflow: "hidden", padding: "22px 40px 32px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
              {[
                { l: "本月调用",   v: "27" },
                { l: "累计调用",   v: "184" },
                { l: "平均耗时",   v: "42s" },
                { l: "好评率",     v: "94%" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "0 20px", borderLeft: i > 0 ? "1px solid var(--line-soft)" : "none" }}>
                  <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 5 }}>{s.l}</div>
                  <span className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500 }}>{s.v}</span>
                </div>
              ))}
            </div>

            {/* What it does */}
            <CxPanel title="它会做什么">
              <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13.5, color: "var(--ink)", lineHeight: 1.85 }}>
                <li>从项目记忆中提取客户背景、痛点、决策链;</li>
                <li>结合行业洞察(预置 + 知识库)生成三层战略框架;</li>
                <li>识别关键风险点,标注在每一层之下;</li>
                <li>输出可继续追问的会话,以及一份可导出的简报。</li>
              </ol>
            </CxPanel>

            {/* Required context */}
            <CxPanel title="需要哪些上下文">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { l: "项目记忆", req: true, has: true, note: "v12 · 已就绪" },
                  { l: "客户记忆", req: true, has: true, note: "v8 · 已就绪" },
                  { l: "近 3 次会议纪要", req: false, has: true, note: "已识别" },
                  { l: "行业洞察资料", req: false, has: true, note: "知识库 38 份" },
                ].map(c => (
                  <div key={c.l} style={{ padding: "10px 12px", background: c.has ? "var(--accent-bg)" : "var(--bg-tint)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 8 }}>
                    {c.has ? <I name="check" size={12} stroke={2} style={{ color: "var(--good)" }}/> : <span style={{ width: 12, height: 12, borderRadius: 99, border: "1.5px solid var(--ink-faint)" }}/>}
                    <div style={{ flex: 1 }}>
                      <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500 }}>{c.l} {c.req && <span style={{ color: "var(--bad)" }}>*</span>}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{c.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CxPanel>

            {/* Example output preview */}
            <CxPanel title="示例输出" subtitle="基于 鼎和保险 项目">
              <div style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.75 }}>
                <p style={{ margin: "0 0 10px" }}>我把战略分成 <span style={{ color: "var(--accent-ink)", fontWeight: 500 }}>业务、技术、组织</span> 三层…</p>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 10, columnGap: 12 }}>
                  {[
                    ["01", "业务层", "围绕续保与理赔两个高频场景,先建立数据闭环。"],
                    ["02", "技术层", "以现有核心系统为锚,搭建轻量中台 + AI 推理层。"],
                    ["03", "组织层", "设立 4 + 2 转型办公室。"],
                  ].map(([n, t, d]) => (
                    <React.Fragment key={n}>
                      <span className="num" style={{ fontSize: 11.5, color: "var(--accent)", paddingTop: 2, fontWeight: 500 }}>{n}</span>
                      <div>
                        <div style={{ fontWeight: 500, color: "var(--ink)" }}>{t}</div>
                        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>{d}</div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </CxPanel>
          </div>

          <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <CxPanel title="最近调用">
              {[
                { p: "鼎和保险 · 数字化转型", w: "陈悦", t: "刚刚" },
                { p: "中信地产 · 智慧园区",   w: "林宥", t: "昨天" },
                { p: "华兴生物 · AI 售前",    w: "陈悦", t: "3 天前" },
                { p: "申通快运 · 中台升级",   w: "苏明", t: "5 天前" },
              ].map((h, i) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: i === 3 ? "none" : "1px solid var(--line-soft)" }}>
                  <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.p}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 1 }}>{h.w} · {h.t}</div>
                </div>
              ))}
            </CxPanel>

            <CxPanel title="基础信息">
              <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>分类</span><span>战略</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>版本</span><span className="num">v3.2</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>作者</span><span>陈悦</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>共享给</span><span>团队全员</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>模型</span><span>gpt-5</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>预算</span><span className="num">¥0.18/次</span></div>
              </div>
            </CxPanel>
          </aside>
        </div>
      </div>
    </CxShell>
  );
}

/* ============================================================
   Welcome / Onboarding
   ============================================================ */
function CxWelcome() {
  return (
    <div className="frame-codex" style={{ flexDirection: "column", overflow: "hidden" }}>
      {/* Top bar */}
      <header style={{ height: 56, padding: "0 36px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <CxLogo size={22}/>
        <a style={{ fontSize: 12.5, color: "var(--ink-mute)" }}>稍后再说 →</a>
      </header>

      {/* Split body */}
      <div style={{ flex: 1, padding: "8px 36px 36px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, minHeight: 0, overflow: "hidden" }}>

        {/* ============= LEFT — personalization form ============= */}
        <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: "36px 40px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ marginBottom: 24 }}>
            <h1 className="ui" style={{ margin: 0, fontSize: 26, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em", lineHeight: 1.3 }}>
              一起花 <span className="num" style={{ color: "var(--accent)" }}>30</span> 秒,把 Aria 调到顺手
            </h1>
            <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--ink-mute)", lineHeight: 1.65 }}>
              全部可选,之后随时可以在「设置 → AI 个人偏好」里调。
            </p>
          </div>

          {/* Field — 称呼 */}
          <div style={{ marginBottom: 20 }}>
            <label className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, display: "block", marginBottom: 8 }}>
              Aria 怎么称呼你
            </label>
            <input
              placeholder="例如:李总、小李、Liang"
              className="codex-input"
              style={{ width: "100%", padding: "10px 14px", fontSize: 13.5, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}
            />
            <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 6 }}>最长 40 个字 · 留空也行,后续可以补</div>
          </div>

          {/* Selects — 4 prefs */}
          {[
            { l: "回复语言",                  v: "未设置(由模型判断)", chips: ["跟你一致", "中文", "English"] },
            { l: "回复语气",                  v: "未设置",                chips: ["直接", "温和", "严谨"] },
            { l: "回复结构",                  v: "未设置",                chips: ["先结论", "分点列举", "随意"] },
            { l: "写入 / 删除前是否再次确认", v: "未设置",                chips: ["写入前", "删除前", "都不需要"] },
          ].map(f => (
            <div key={f.l} style={{ marginBottom: 18 }}>
              <label className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, display: "block", marginBottom: 8 }}>{f.l}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {f.chips.map(c => (
                  <button key={c} style={{ padding: "6px 12px", fontSize: 12.5, color: "var(--ink-soft)", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-pill)" }}>
                    {c}
                  </button>
                ))}
                <button style={{ padding: "6px 10px", fontSize: 12.5, color: "var(--ink-faint)", background: "transparent", borderRadius: "var(--r-pill)" }}>
                  其他 …
                </button>
              </div>
            </div>
          ))}

          {/* Footer */}
          <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>所有设置仅对你自己生效</span>
            <button style={{ padding: "10px 22px", background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 13.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
              完成设置 <I name="arrow-right" size={12} stroke={1.8}/>
            </button>
          </div>
        </div>

        {/* ============= RIGHT — live preview ============= */}
        <div style={{ background: "var(--bg-tint)", border: "1px solid var(--line-soft)", borderRadius: "var(--r-lg)", padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20, overflow: "hidden", position: "relative" }}>
          {/* Faint dot grid */}
          <div style={{
            position: "absolute", inset: 0, opacity: 0.35,
            backgroundImage: "radial-gradient(circle, var(--line-strong) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            maskImage: "radial-gradient(ellipse 80% 80% at 50% 30%, black 30%, transparent 90%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 80% at 50% 30%, black 30%, transparent 90%)",
            pointerEvents: "none",
          }}/>

          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-mute)", position: "relative" }}>
            <I name="chat" size={13} stroke={1.5}/>
            <span style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>Aria 会这样回应你</span>
            <CxStatus tone="accent" pulse>实时</CxStatus>
          </div>

          {/* User bubble */}
          <div style={{ display: "flex", justifyContent: "flex-end", position: "relative" }}>
            <div style={{ maxWidth: "82%", background: "var(--bg-elev)", border: "1px solid var(--line)", padding: "10px 14px", borderRadius: "var(--r-md)", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.6 }}>
              项目预算超了 20%,你怎么看?
            </div>
          </div>

          {/* Aria bubble */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", position: "relative" }}>
            <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--accent)", color: "var(--bg-elev)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <I name="sparkle" size={13} stroke={1.5}/>
            </span>
            <div style={{ flex: 1, maxWidth: "85%", background: "var(--bg-elev)", border: "1px solid var(--line)", padding: "12px 16px", borderRadius: "var(--r-md)" }}>
              <p style={{ margin: 0, fontSize: 14, color: "var(--ink)", lineHeight: 1.75 }}>
                先分两路核:是估算偏低,还是范围悄悄扩了?两种情形的处理路径完全不同<span className="cursor-blink"/>
              </p>
            </div>
          </div>

          {/* Setting → effect chip row */}
          <div style={{ position: "relative", marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { k: "语气 · 直接",       e: "省去客套寒暄,直接给判断" },
              { k: "结构 · 先结论",     e: "结论在前,理由在后" },
              { k: "语言 · 跟你一致",   e: "你用什么语言,它就用什么" },
            ].map(s => (
              <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "var(--ink-mute)" }}>
                <span style={{ padding: "2px 8px", background: "var(--accent-bg)", color: "var(--accent-ink)", borderRadius: "var(--r-sm)", fontWeight: 500 }}>{s.k}</span>
                <I name="arrow-right" size={10} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
                <span>{s.e}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "auto", padding: "10px 14px", background: "color-mix(in oklch, var(--accent-bg) 50%, transparent)", border: "1px dashed color-mix(in oklch, var(--accent) 35%, transparent)", borderRadius: "var(--r-sm)", fontSize: 11.5, color: "var(--ink-mute)", display: "flex", alignItems: "flex-start", gap: 8, position: "relative" }}>
            <I name="sparkle" size={11} stroke={1.5} style={{ color: "var(--accent)", marginTop: 2, flexShrink: 0 }}/>
            <span>这是示范,不是真的对话。改改左侧设置,右边会跟着变 — 你能看到每个偏好对回答的具体影响。</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Not Found / Forbidden — quiet empty states
   ============================================================ */
function CxNotFound() {
  return (
    <CxShell activeKey="workspace">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px", textAlign: "center", overflow: "hidden" }}>
        <div className="num" style={{ fontSize: 110, color: "var(--accent-bg)", fontWeight: 500, letterSpacing: "-0.05em", lineHeight: 1 }}>404</div>
        <h1 className="ui" style={{ margin: "0", fontSize: 24, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em", marginTop: -28 }}>这里什么也没有</h1>
        <p style={{ margin: "12px 0 0", fontSize: 13.5, color: "var(--ink-mute)", maxWidth: 380, lineHeight: 1.65 }}>
          你访问的页面不存在,或已被移除。可能是链接陈旧 — 不用紧张,回到工作台继续。
        </p>
        <div style={{ marginTop: 28, display: "flex", gap: 10 }}>
          <button style={{ padding: "9px 16px", fontSize: 13, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>返回上一页</button>
          <button style={{ padding: "9px 18px", fontSize: 13, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>回到工作台</button>
        </div>

        <div style={{ marginTop: 56, display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>或者搜索你要找的内容</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", fontSize: 13, border: "1px solid var(--line)", borderRadius: 99, color: "var(--ink-mute)", width: 300, background: "var(--bg-elev)" }}>
            <I name="search" size={13} stroke={1.5}/>
            <span>搜索项目、对话、Skill</span>
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--ink-faint)" }}>⌘K</span>
          </div>
        </div>
      </div>
    </CxShell>
  );
}

/* ============================================================
   Contacts — directory across clients
   ============================================================ */
function CxContacts() {
  const contacts = [
    { n: "王浩", r: "CTO", client: "鼎和保险", lvl: "决策", phone: "已记录", email: "已记录", last: "5 天前" },
    { n: "张丽", r: "COO", client: "鼎和保险", lvl: "决策", phone: "已记录", email: "已记录", last: "5 天前" },
    { n: "周静", r: "CTO", client: "申通快运", lvl: "决策", phone: "已记录", email: "已记录", last: "今天" },
    { n: "李远", r: "CFO", client: "鼎和保险", lvl: "影响", phone: "未记录", email: "已记录", last: "未直接接触" },
    { n: "陈炜", r: "数字化总监", client: "中信地产", lvl: "决策", phone: "已记录", email: "已记录", last: "昨天" },
    { n: "罗琪", r: "CTO", client: "华兴生物", lvl: "决策", phone: "已记录", email: "已记录", last: "3 天前" },
    { n: "刘洁", r: "数据治理负责人", client: "鼎和保险", lvl: "执行", phone: "未记录", email: "已记录", last: "1 周前" },
    { n: "马川", r: "信息化总监", client: "金辉医疗", lvl: "决策", phone: "已记录", email: "已记录", last: "2 周前" },
  ];
  return (
    <CxShell activeKey="contacts">
      <div style={{ flex: 1, padding: "32px 56px 40px", overflow: "hidden", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
          <div>
            <h1 className="ui" style={{ margin: 0, fontSize: 28, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>联系人</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--ink-mute)" }}>跨客户的联系人通讯录 · {contacts.length} 人</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", fontSize: 13, border: "1px solid var(--line)", borderRadius: "var(--r-sm)", color: "var(--ink-mute)", width: 220 }}>
              <I name="search" size={13} stroke={1.5}/> <span>搜索姓名 / 客户</span>
            </div>
            <button style={{ padding: "7px 14px", fontSize: 12.5, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>+ 新建联系人</button>
          </div>
        </div>

        {/* Filter */}
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          {["全部", "决策", "影响", "执行", "本周联系", "未直接接触"].map((t, i) => (
            <button key={t} style={{ padding: "5px 12px", borderRadius: "var(--r-sm)", background: i === 0 ? "var(--ink)" : "transparent", color: i === 0 ? "var(--bg-elev)" : "var(--ink-soft)", border: i === 0 ? "1px solid var(--ink)" : "1px solid var(--line)", fontSize: 12 }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 0.7fr 0.6fr 0.6fr 0.7fr 14px", padding: "10px 8px", fontSize: 11.5, color: "var(--ink-faint)" }}>
          <span>姓名 · 角色</span><span>客户</span><span>层级</span><span>电话</span><span>邮箱</span><span>最近联系</span><span/>
        </div>
        {contacts.map(c => (
          <a key={c.n + c.client} className="row-hov" style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 0.7fr 0.6fr 0.6fr 0.7fr 14px", padding: "13px 8px", gap: 14, alignItems: "center", borderTop: "1px solid var(--line-soft)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
              <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 500, flexShrink: 0 }}>{c.n[0]}</span>
              <div style={{ minWidth: 0 }}>
                <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{c.n}</div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{c.r}</div>
              </div>
            </div>
            <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{c.client}</div>
            <CxStatus tone={c.lvl === "决策" ? "accent" : c.lvl === "影响" ? "neutral" : "mute"}>{c.lvl}</CxStatus>
            <span style={{ fontSize: 11.5, color: c.phone === "已记录" ? "var(--good)" : "var(--ink-faint)" }}>{c.phone}</span>
            <span style={{ fontSize: 11.5, color: c.email === "已记录" ? "var(--good)" : "var(--ink-faint)" }}>{c.email}</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{c.last}</span>
            <I name="arrow-right" size={12} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
          </a>
        ))}
      </div>
    </CxShell>
  );
}

/* ============================================================
   Service Down — 503 / temporarily unavailable
   ============================================================ */
function CxServiceDown() {
  return (
    <div className="frame-codex" style={{ flexDirection: "column", overflow: "hidden" }}>
      <header style={{ height: 56, padding: "0 36px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, borderBottom: "1px solid var(--line)" }}>
        <CxLogo size={22}/>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <CxStatus tone="bad" pulse>系统维护中</CxStatus>
          <a style={{ fontSize: 12.5, color: "var(--ink-mute)" }}>状态页 →</a>
        </div>
      </header>

      <div style={{ flex: 1, padding: "60px 60px 40px", overflow: "hidden", display: "flex", justifyContent: "center", position: "relative" }}>
        {/* Faint dot grid */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.35,
          backgroundImage: "radial-gradient(circle, var(--line-strong) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 90%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 90%)",
          pointerEvents: "none",
        }}/>

        <div style={{ maxWidth: 680, width: "100%", position: "relative" }}>
          {/* Big 503 */}
          <div className="num" style={{ fontSize: 96, color: "var(--accent-bg)", fontWeight: 500, letterSpacing: "-0.05em", lineHeight: 1 }}>503</div>

          <h1 className="ui" style={{ margin: "8px 0 0", fontSize: 28, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>服务暂时不可用</h1>
          <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.7, maxWidth: 480 }}>
            我们正在做一次例行维护,通常 5–15 分钟内恢复。已经在路上的对话和未保存的草稿都已经替你存好,登录后会自动恢复。
          </p>

          {/* Auto retry */}
          <div style={{ marginTop: 24, padding: "12px 16px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 26, height: 26, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <I name="clock" size={13} stroke={1.5}/>
            </span>
            <div style={{ flex: 1 }}>
              <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>正在尝试重新连接</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>每 15 秒自动重试 · 下次重试 <span className="num">12</span> 秒后</div>
            </div>
            <button style={{ padding: "6px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>立即重试</button>
          </div>

          {/* System component status */}
          <div style={{ marginTop: 24 }}>
            <div className="ui" style={{ fontSize: 11.5, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>各组件状态</div>
            <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
              {[
                { l: "Web 前端",      v: "正常", tone: "good" },
                { l: "API 服务",      v: "维护中 · 5 分钟内", tone: "bad", note: "数据库索引升级" },
                { l: "AI 模型代理",   v: "降级运行 · 仅备用模型", tone: "warn" },
                { l: "向量检索",      v: "正常", tone: "good" },
                { l: "记忆任务队列",  v: "暂停 · 待 API 恢复后自动继续", tone: "warn" },
                { l: "文件存储",      v: "正常", tone: "good" },
              ].map((s, i, arr) => (
                <div key={s.l} style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", padding: "12px 18px", gap: 14, alignItems: "center", borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--line-soft)" }}>
                  <span className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{s.l}</span>
                  <CxStatus tone={s.tone} pulse={s.tone === "warn" || s.tone === "bad"}>{s.v}</CxStatus>
                  {s.note ? <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{s.note}</span> : <span/>}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ marginTop: 24, display: "flex", gap: 10, alignItems: "center" }}>
            <button style={{ padding: "9px 18px", fontSize: 13, color: "var(--bg-elev)", background: "var(--ink)", borderRadius: "var(--r-sm)" }}>查看完整状态页 →</button>
            <button style={{ padding: "9px 18px", fontSize: 13, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>订阅恢复通知</button>
            <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink-faint)" }}>事故编号 <span className="num" style={{ color: "var(--ink-mute)" }}>INC-2026-0528-A1</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CxSkillDetail, CxWelcome, CxNotFound, CxContacts, CxServiceDown });
