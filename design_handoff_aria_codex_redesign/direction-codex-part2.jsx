// direction-codex-part2.jsx — Skills + Clients + Knowledge + Settings + Login

/* ----------------------------------------------------------
   CX · Skills
   ---------------------------------------------------------- */
function CxSkills() {
  const grouped = SKILLS.reduce((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});
  return (
    <CxShell activeKey="skills">
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 0 }}>
        <aside style={{ padding: "28px 18px 28px 40px", borderRight: "1px solid var(--line)" }}>
          <div style={{ color: "var(--ink-mute)", fontSize: 12, marginBottom: 10 }}>分类</div>
          {[
            { z: "全部", n: SKILLS.length, active: true },
            { z: "战略", n: 2 },
            { z: "销售", n: 1 },
            { z: "售前", n: 2 },
            { z: "交付", n: 2 },
            { z: "客户", n: 1 },
          ].map(c => (
            <a key={c.z} className="row-hov" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", fontSize: 13, color: c.active ? "var(--ink)" : "var(--ink-soft)", borderRadius: "var(--r-sm)", background: c.active ? "var(--bg-tint)" : "transparent", fontWeight: c.active ? 500 : 400, marginBottom: 1 }}>
              <span>{c.z}</span>
              <span className="num" style={{ fontSize: 11.5, color: c.active ? "var(--accent)" : "var(--ink-faint)" }}>{c.n}</span>
            </a>
          ))}

          <div style={{ color: "var(--ink-mute)", fontSize: 12, margin: "26px 0 8px" }}>视图</div>
          <a className="row-hov" style={{ display: "block", padding: "7px 10px", fontSize: 13, color: "var(--ink-soft)", borderRadius: "var(--r-sm)" }}>★ 收藏</a>
          <a className="row-hov" style={{ display: "block", padding: "7px 10px", fontSize: 13, color: "var(--ink-soft)", borderRadius: "var(--r-sm)" }}>● 最近用过</a>
          <a className="row-hov" style={{ display: "block", padding: "7px 10px", fontSize: 13, color: "var(--accent)", borderRadius: "var(--r-sm)" }}>+ 新建</a>

          <div style={{ color: "var(--ink-mute)", fontSize: 12, margin: "26px 0 8px" }}>统计</div>
          <div style={{ padding: "4px 10px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.9 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>总数</span><span className="num" style={{ color: "var(--ink)" }}>8</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>本月调用</span><span className="num" style={{ color: "var(--ink)" }}>124</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>平均/项</span><span className="num" style={{ color: "var(--ink-mute)" }}>15.5</span></div>
          </div>
        </aside>

        <div style={{ padding: "32px 56px 40px", overflow: "hidden", minWidth: 0 }}>
          <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
            <div>
              <h1 className="ui" style={{ margin: 0, fontSize: 28, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>Skill 库</h1>
              <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--ink-mute)", maxWidth: 540, lineHeight: 1.6 }}>
                把重复的工作沉淀成可调用的模板。共 8 个 Skill,本月 124 次调用。
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ padding: "7px 14px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>筛选</button>
              <button style={{ padding: "7px 14px", fontSize: 12.5, color: "var(--bg-elev)", background: "var(--ink)", borderRadius: "var(--r-sm)" }}>+ 新建</button>
            </div>
          </div>

          {Object.entries(grouped).map(([cat, items]) => (
            <section key={cat} style={{ marginBottom: 28 }}>
              <CxHead action={<span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{items.length} 项</span>}>{cat}</CxHead>
              {items.map((s, i, arr) => (
                <a key={s.id} className="row-hov" style={{ display: "grid", gridTemplateColumns: "1fr 90px 80px 14px", padding: "14px 8px", gap: 16, alignItems: "center", borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--line-soft)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 15, fontWeight: 500, color: "var(--ink)" }}>{s.name}</div>
                    <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-mute)", marginTop: 3, lineHeight: 1.55 }}>{s.description}</div>
                  </div>
                  <CxStatus>{s.category}</CxStatus>
                  <span className="num" style={{ fontSize: 12, color: "var(--ink-mute)" }}>{s.uses} 次</span>
                  <I name="arrow-right" size={12} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
                </a>
              ))}
            </section>
          ))}
        </div>
      </div>
    </CxShell>
  );
}

/* ----------------------------------------------------------
   CX · Clients
   ---------------------------------------------------------- */
function CxClients() {
  return (
    <CxShell activeKey="clients">
      <div style={{ flex: 1, padding: "32px 56px 40px", overflow: "hidden", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28 }}>
          <div>
            <h1 className="ui" style={{ margin: 0, fontSize: 28, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>客户</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--ink-mute)" }}>6 个客户 · 4 活跃 · 1 关注 · 1 沉睡</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", fontSize: 13, border: "1px solid var(--line)", borderRadius: "var(--r-sm)", color: "var(--ink-mute)", width: 220 }}>
              <I name="search" size={13} stroke={1.5}/> <span>搜索客户</span>
              <span style={{ marginLeft: "auto", color: "var(--ink-faint)", fontSize: 11 }}>⌘F</span>
            </div>
            <button style={{ padding: "7px 14px", fontSize: 12.5, color: "var(--bg-elev)", background: "var(--ink)", borderRadius: "var(--r-sm)" }}>+ 新建客户</button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", marginBottom: 22 }}>
          {[
            { l: "总数",   v: "6", tone: "neutral" },
            { l: "活跃",   v: "4", tone: "good" },
            { l: "关注",   v: "1", tone: "warn" },
            { l: "沉睡",   v: "1", tone: "mute" },
          ].map((s, i) => (
            <div key={i} style={{ padding: "0 22px", borderLeft: i > 0 ? "1px solid var(--line-soft)" : "none" }}>
              <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 6 }}>{s.l}</div>
              <span className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500 }}>{s.v}</span>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ display: "grid", gridTemplateColumns: "1.8fr 0.7fr 0.6fr 0.6fr 0.7fr 100px 14px", padding: "10px 8px", fontSize: 11.5, color: "var(--ink-faint)" }}>
          <span>客户</span><span>行业</span><span>地区</span><span>项目数</span><span>最近联系</span><span>状态</span><span/>
        </div>
        {CLIENTS.map((c) => (
          <a key={c.id} className="row-hov" style={{ display: "grid", gridTemplateColumns: "1.8fr 0.7fr 0.6fr 0.6fr 0.7fr 100px 14px", padding: "14px 8px", gap: 12, alignItems: "center", borderTop: "1px solid var(--line-soft)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
              <span style={{ width: 32, height: 32, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{c.short.slice(0, 1)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="ui" style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>{c.short}</div>
              </div>
            </div>
            <div className="ui" style={{ fontSize: 13, color: "var(--ink-soft)" }}>{c.industry}</div>
            <div className="ui" style={{ fontSize: 13, color: "var(--ink-soft)" }}>{c.region}</div>
            <div className="num" style={{ fontSize: 13, color: "var(--ink)" }}>{c.projects}</div>
            <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{c.lastContact}</div>
            <div>
              {c.health === "active"  && <CxStatus tone="good">活跃</CxStatus>}
              {c.health === "watch"   && <CxStatus tone="warn">关注</CxStatus>}
              {c.health === "dormant" && <CxStatus tone="mute">沉睡</CxStatus>}
            </div>
            <I name="arrow-right" size={12} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
          </a>
        ))}
      </div>
    </CxShell>
  );
}

/* ----------------------------------------------------------
   CX · Knowledge
   ---------------------------------------------------------- */
function CxKnowledge() {
  const docs = [
    { title: "保险行业数字化转型白皮书 2025", type: "PDF", size: "8.4 MB", tags: ["行业", "保险"], time: "1 周前" },
    { title: "鼎和保险 续保业务深度访谈记录", type: "DOC", size: "1.2 MB", tags: ["访谈", "鼎和保险"], time: "3 天前" },
    { title: "中台架构参考实践 v3", type: "PDF", size: "5.7 MB", tags: ["技术", "中台"], time: "2 周前" },
    { title: "申通快运 项目周报合集 Q2", type: "DOC", size: "3.1 MB", tags: ["周报", "申通"], time: "今天" },
    { title: "AI 售前评估方法论 v2", type: "MD", size: "120 KB", tags: ["方法论"], time: "昨天" },
    { title: "华兴生物 决策链补充材料", type: "PDF", size: "640 KB", tags: ["客户", "华兴"], time: "5 天前" },
  ];
  return (
    <CxShell activeKey="knowledge">
      <div style={{ flex: 1, padding: "32px 56px 40px", overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 260px", columnGap: 48, minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ marginBottom: 26 }}>
            <h1 className="ui" style={{ margin: 0, fontSize: 28, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>知识库</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--ink-mute)" }}>147 份文档 · 3.2 GB 已索引 · 14 分钟前同步</p>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            {["全部", "行业资料", "客户访谈", "技术参考", "方法论", "周报"].map((t, i) => (
              <button key={t} style={{ padding: "5px 12px", borderRadius: "var(--r-sm)", background: i === 0 ? "var(--ink)" : "transparent", color: i === 0 ? "var(--bg-elev)" : "var(--ink-soft)", border: i === 0 ? "1px solid var(--ink)" : "1px solid var(--line)", fontSize: 12.5 }}>
                {t}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "48px 1fr 80px 70px 14px", padding: "8px 6px", fontSize: 11.5, color: "var(--ink-faint)" }}>
            <span>类型</span><span>标题与标签</span><span>大小</span><span>更新</span><span/>
          </div>
          {docs.map((d, i) => (
            <a key={i} className="row-hov" style={{ display: "grid", gridTemplateColumns: "48px 1fr 80px 70px 14px", padding: "14px 6px", gap: 12, alignItems: "center", borderTop: "1px solid var(--line-soft)" }}>
              <span style={{ fontSize: 10.5, color: "var(--ink-mute)", letterSpacing: "0.04em" }}>{d.type}</span>
              <div style={{ minWidth: 0 }}>
                <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2, display: "flex", gap: 10 }}>
                  {d.tags.map(t => <span key={t}>· {t}</span>)}
                </div>
              </div>
              <span className="num" style={{ fontSize: 12, color: "var(--ink-mute)" }}>{d.size}</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{d.time}</span>
              <I name="arrow-right" size={12} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
            </a>
          ))}
        </div>

        <aside style={{ borderLeft: "1px solid var(--line)", paddingLeft: 32 }}>
          <CxHead>索引状态</CxHead>
          <div style={{ marginBottom: 24 }}>
            <div className="num" style={{ fontSize: 36, color: "var(--ink)", lineHeight: 1, fontWeight: 500 }}>147</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 6 }}>份文档 · 3.2 GB</div>
            <div style={{ marginTop: 8 }}><CxStatus tone="good">已同步</CxStatus> <span style={{ color: "var(--ink-faint)", fontSize: 11 }}>14 分钟前</span></div>
          </div>

          <CxHead>分布</CxHead>
          {[
            ["行业资料", 38, "var(--bad)"],
            ["客户访谈", 64, "var(--info)"],
            ["技术参考", 27, "var(--ink-soft)"],
            ["方法论",   18, "var(--accent)"],
          ].map(([k, v, color]) => (
            <div key={k} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                <span style={{ color: "var(--ink-soft)" }}>{k}</span>
                <span className="num" style={{ color: "var(--ink-mute)" }}>{v}</span>
              </div>
              <div style={{ height: 2, background: "var(--bg-sunken)" }}>
                <div style={{ height: "100%", width: `${(v / 70) * 100}%`, background: color }}/>
              </div>
            </div>
          ))}

          <CxHead style={{ marginTop: 28 }}>最近入库</CxHead>
          {[
            { t: "申通快运 Q2 周报",  time: "今天" },
            { t: "鼎和续保 访谈",     time: "昨天" },
            { t: "售前评估方法论 v2", time: "昨天" },
          ].map((r, i) => (
            <div key={i} style={{ display: "flex", padding: "5px 0", fontSize: 12, color: "var(--ink-soft)" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.t}</span>
              <span style={{ color: "var(--ink-faint)" }}>{r.time}</span>
            </div>
          ))}
        </aside>
      </div>
    </CxShell>
  );
}

/* ----------------------------------------------------------
   CX · Settings — Memory Operations
   ---------------------------------------------------------- */
function CxSettings() {
  return (
    <CxShell activeKey="workspace">
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 0 }}>
        <aside style={{ padding: "28px 18px 28px 40px", borderRight: "1px solid var(--line)" }}>
          <h2 className="ui" style={{ margin: "0 0 18px", fontSize: 18, fontWeight: 500 }}>设置</h2>
          {[
            { z: "个人资料" },
            { z: "AI 模型" },
            { z: "项目记忆" },
            { z: "客户记忆" },
            { z: "Memory Operations", active: true },
            { z: "API 限额" },
            { z: "用户管理" },
            { z: "迁移状态" },
            { z: "服务器" },
            { z: "语言" },
            { z: "关于" },
          ].map(s => (
            <a key={s.z} className="row-hov" style={{ display: "block", padding: "7px 10px", fontSize: 13, color: s.active ? "var(--ink)" : "var(--ink-soft)", borderRadius: "var(--r-sm)", background: s.active ? "var(--bg-tint)" : "transparent", fontWeight: s.active ? 500 : 400, position: "relative", marginBottom: 1 }}>
              {s.active && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 2, background: "var(--accent)", borderRadius: 99 }}/>}
              {s.z}
            </a>
          ))}
        </aside>

        <div style={{ padding: "32px 56px 40px", overflow: "hidden" }}>
          <div style={{ marginBottom: 24 }}>
            <h1 className="ui" style={{ margin: 0, fontSize: 28, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>Memory Operations</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--ink-mute)", lineHeight: 1.6 }}>查看记忆任务的运行状态、失败明细、预算消耗 — 仅管理员可见</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", marginBottom: 26 }}>
            {[
              { l: "队列中",    v: "8",     tone: "warn",    note: "近 1 小时 +2" },
              { l: "本月运行",  v: "1,247", tone: "neutral", note: "累计" },
              { l: "失败",      v: "3",     tone: "bad",     note: "待复查" },
              { l: "预算余额",  v: "62%",   tone: "good",    note: "¥24 / ¥40" },
            ].map((s, i) => (
              <div key={i} style={{ padding: "0 22px", borderLeft: i > 0 ? "1px solid var(--line-soft)" : "none" }}>
                <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 6 }}>{s.l}</div>
                <div className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500 }}>{s.v}</div>
                <div style={{ marginTop: 5 }}><CxStatus tone={s.tone}>{s.note}</CxStatus></div>
              </div>
            ))}
          </div>

          <CxHead action={
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>全部</button>
              <button style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--bad)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>仅失败</button>
            </div>
          }>最近任务 · 24 小时</CxHead>

          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 140px 70px 90px", padding: "10px 6px", fontSize: 11.5, color: "var(--ink-faint)" }}>
            <span>任务</span><span>目标</span><span>状态</span><span>耗时</span><span>时间</span>
          </div>
          {[
            { type: "项目记忆 · 摘要",   target: "鼎和保险 · 数字化转型咨询", status: "成功",   dur: "12s",  time: "刚刚",     tone: "good" },
            { type: "客户记忆 · 沉淀",   target: "鼎和保险股份有限公司",       status: "运行中", dur: "8s+",  time: "进行中",   tone: "accent", pulse: true },
            { type: "项目记忆 · 摘要",   target: "申通快运 · 中台升级",         status: "成功",   dur: "9s",   time: "2 分钟前", tone: "good" },
            { type: "客户记忆 · 沉淀",   target: "中信地产",                    status: "失败",   dur: "4s",   time: "5 分钟前", tone: "bad" },
            { type: "项目记忆 · 摘要",   target: "金辉医疗 · 知识库迁移",       status: "成功",   dur: "15s",  time: "10 分钟前",tone: "good" },
            { type: "文档 · 嵌入",       target: "申通快运 Q2 周报",            status: "成功",   dur: "22s",  time: "14 分钟前",tone: "good" },
          ].map((t, i) => (
            <a key={i} className="row-hov" style={{ display: "grid", gridTemplateColumns: "140px 1fr 140px 70px 90px", padding: "12px 6px", gap: 12, alignItems: "center", borderTop: "1px solid var(--line-soft)" }}>
              <span className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)", fontWeight: 500 }}>{t.type}</span>
              <span className="ui" style={{ fontSize: 13.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.target}</span>
              <CxStatus tone={t.tone} pulse={t.pulse}>{t.status}</CxStatus>
              <span className="num" style={{ fontSize: 12, color: "var(--ink-mute)" }}>{t.dur}</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)", textAlign: "right" }}>{t.time}</span>
            </a>
          ))}

          {/* Failed detail */}
          <div style={{ marginTop: 24, padding: "16px 20px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderLeft: "2px solid var(--bad)", borderRadius: "var(--r-sm)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <CxStatus tone="bad">失败详情</CxStatus>
              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>客户记忆沉淀 · 中信地产 · 5 分钟前</span>
            </div>
            <p className="ui" style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.6 }}>
              任务在 30 秒后超时,可能由于客户数据量较大或外部接口响应缓慢。可重试或调高超时阈值。
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ padding: "5px 14px", fontSize: 12.5, color: "var(--bg-elev)", background: "var(--ink)", borderRadius: "var(--r-sm)" }}>重试</button>
              <button style={{ padding: "5px 14px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>查看日志</button>
              <button style={{ padding: "5px 14px", fontSize: 12.5, color: "var(--ink-mute)" }}>忽略</button>
            </div>
          </div>
        </div>
      </div>
    </CxShell>
  );
}

/* ----------------------------------------------------------
   CX · Login
   ---------------------------------------------------------- */
function CxLogin() {
  return (
    <div className="frame-codex" style={{ flexDirection: "row" }}>
      {/* Left — quiet hero with breathing room */}
      <div style={{
        flex: 1.1,
        background: "var(--bg-elev)",
        padding: "44px 56px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        borderRight: "1px solid var(--line)",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Faint dot grid */}
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(circle, var(--line-strong) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          opacity: 0.4,
          pointerEvents: "none",
          maskImage: "radial-gradient(ellipse 80% 60% at 70% 50%, black 30%, transparent 90%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 70% 50%, black 30%, transparent 90%)",
          animation: "codex-drift 22s ease-in-out infinite",
        }}/>

        {/* Floating accent orbs — subtle ambient motion */}
        <span style={{ position: "absolute", top: "18%", right: "20%", width: 240, height: 240, borderRadius: 9999, background: "radial-gradient(circle, color-mix(in oklch, var(--accent) 18%, transparent) 0%, transparent 70%)", animation: "codex-float-a 14s ease-in-out infinite", pointerEvents: "none", filter: "blur(2px)" }}/>
        <span style={{ position: "absolute", bottom: "12%", right: "55%", width: 180, height: 180, borderRadius: 9999, background: "radial-gradient(circle, color-mix(in oklch, var(--accent) 12%, transparent) 0%, transparent 70%)", animation: "codex-float-b 18s ease-in-out infinite", pointerEvents: "none", filter: "blur(2px)" }}/>

        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink)", fontWeight: 500, fontSize: 16, position: "relative" }}>
          <CxLogo size={26} wordmarkSize={18}/>
        </div>

        <div style={{ position: "relative", maxWidth: 480 }}>
          <div style={{ fontSize: 12, color: "var(--accent)", marginBottom: 22, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 18, height: 1, background: "var(--accent)" }}/>
            为咨询团队而做 · 2026
          </div>

          <h1 className="ui" style={{
            margin: 0,
            fontSize: 44,
            fontWeight: 400,
            lineHeight: 1.18,
            letterSpacing: "-0.025em",
            color: "var(--ink)",
          }}>
            一个安静的<br/>
            AI 协作工作台。
          </h1>

          <p style={{
            margin: "20px 0 0",
            fontSize: 14,
            color: "var(--ink-soft)",
            lineHeight: 1.75,
            maxWidth: 380,
          }}>
            把项目记忆、客户上下文、Skill 工作流,做成稳定的产品能力 — 给咨询、售前与交付团队使用。
          </p>
        </div>

        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, color: "var(--ink-faint)" }}>
          <span>v2.4.0 · for consulting teams</span>
          <span>© 2026 Aria</span>
        </div>
      </div>

      {/* Right — form */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "44px 60px", background: "var(--bg)" }}>
        <div style={{ maxWidth: 340, margin: "0 auto", width: "100%" }}>
          <h1 className="ui" style={{ margin: 0, fontSize: 26, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>欢迎回来</h1>
          <p style={{ margin: "8px 0 30px", fontSize: 13, color: "var(--ink-mute)" }}>登录到 Aria 工作台</p>

          <label style={{ fontSize: 12.5, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>邮箱</label>
          <input defaultValue="chenyue@aria.team" className="codex-input" style={{ width: "100%", padding: "10px 12px", fontSize: 13.5, background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", marginBottom: 18 }}/>

          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>密码</label>
            <a style={{ fontSize: 11.5, color: "var(--accent)" }}>忘记密码 ?</a>
          </div>
          <input type="password" defaultValue="••••••••••" className="codex-input" style={{ width: "100%", padding: "10px 12px", fontSize: 13.5, background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", marginBottom: 24 }}/>

          <button style={{ width: "100%", padding: "11px", background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 13.5, fontWeight: 500 }}>
            登录
          </button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CxSkills, CxClients, CxKnowledge, CxSettings, CxLogin });
