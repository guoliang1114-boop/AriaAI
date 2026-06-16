// direction-codex-settings-v2.jsx — overrides for memory pages + new Messages page
// Based on actual product screenshots: project-memory, client-memory, memory-ops, messages, server

/* ============= Project Memory · 项目记忆管理 ============= */
function CxSettingsProjMem() {
  return (
    <CxSettingsShell activeKey="proj-mem"
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><I name="sparkle" size={14} stroke={1.5}/></span>
        项目记忆管理
      </span>}
      subtitle="集中查看项目记忆状态、后台队列和常用 AI 摘要预热进度。"
      actions={<>
        <button style={{ padding: "8px 14px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}><I name="sparkle" size={11} stroke={1.5}/> 批量更新待刷新记忆</button>
        <button style={{ padding: "8px 14px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}><I name="zap" size={11} stroke={1.5}/> 补齐未整理记忆</button>
      </>}
    >
      {/* Background task queue */}
      <CxPanel
        title="后台任务队列"
        subtitle="查看当前排队中的记忆重建和摘要预热任务。"
        action={<button style={{ padding: "6px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}><I name="sparkle" size={11} stroke={1.5}/> 刷新队列</button>}
        style={{ marginBottom: 20 }}
      >
        <div style={{ padding: "20px 16px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)", textAlign: "center", fontSize: 13, color: "var(--ink-mute)" }}>
          当前没有排队中的项目记忆任务。
        </div>
      </CxPanel>

      {/* 4 stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { l: "全部项目", v: "28", active: true },
          { l: "可直接使用", v: "28" },
          { l: "建议更新", v: "0" },
          { l: "尚未整理", v: "0" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "16px 20px", background: s.active ? "var(--accent-bg)" : "var(--bg-elev)", border: `1px solid ${s.active ? "var(--accent)" : "var(--line)"}`, borderRadius: "var(--r-md)" }}>
            <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{s.l}</div>
            <div className="num" style={{ fontSize: 28, color: "var(--ink)", fontWeight: 500, marginTop: 6 }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", color: "var(--ink-mute)", fontSize: 13, marginBottom: 16 }}>
        <I name="search" size={13} stroke={1.5}/>
        <span>搜索项目名称、客户或摘要…</span>
      </div>

      {/* Project list */}
      {[
        { tag: "可直接使用", client: "广州岭南商旅投资集团有限公司", status: "空闲", title: "集团大会员数字化平台蓝图与运营模式设计", time: "2026/05/28 21:26", excerpt: "核心目标是以会员全生命周期价值提升为导向,设计集团大会员数字化平台蓝图与数据驱动运营模式 - 当前处于 Lead 意向阶段,已完成客户战略沟通故事线、初步方案文档和方案沟通 PPT 的准备" },
        { tag: "可直接使用", client: "东阿阿胶股份有限公司", status: "空闲", title: "东阿阿胶新业务进入机会和策略", time: "2026/05/24 09:15", excerpt: "围绕东阿阿胶的新业务进入策略与机会评估,识别滋补品类、电商渠道与品牌年轻化三大切入方向" },
        { tag: "可直接使用", client: "KPMG Advisory (毕马威管理咨询)", status: "空闲", title: "毕马威 数字化转型咨询协同方案", time: "2026/05/23 17:42", excerpt: "结合毕马威方法论体系,搭建跨行业数字化转型咨询协同方案,聚焦 Skill 库共享与可复用资产" },
      ].map((p, i) => (
        <div key={i} style={{ padding: "16px 20px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <CxStatus tone="good">{p.tag}</CxStatus>
            <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{p.client}</span>
            <span style={{ fontSize: 11, color: "var(--ink-soft)", padding: "2px 8px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "inline-flex", alignItems: "center", gap: 4 }}><I name="sparkle" size={9} stroke={1.5}/> {p.status}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button style={{ padding: "5px 12px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 4 }}><I name="sparkle" size={10} stroke={1.5}/> 更新记忆</button>
              <button style={{ padding: "5px 12px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 4 }}><I name="arrow-up-right" size={10} stroke={1.5}/> 查看详情</button>
            </div>
          </div>
          <div className="ui" style={{ fontSize: 14.5, color: "var(--ink)", fontWeight: 500, marginBottom: 4 }}>{p.title}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 8 }}>最近同步:{p.time}</div>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.65 }}>{p.excerpt}</p>
        </div>
      ))}
    </CxSettingsShell>
  );
}

/* ============= Client Memory · 客户记忆管理 ============= */
function CxSettingsClientMem() {
  return (
    <CxSettingsShell activeKey="client-mem"
      title={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><I name="user" size={14} stroke={1.5}/></span>
        客户记忆管理
      </span>}
      subtitle="集中查看客户级长期记忆状态,统一补齐缺失内容并刷新建议更新的客户记忆。"
      actions={<>
        <button style={{ padding: "8px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}><I name="target" size={11} stroke={1.5}/> 补齐缺失记忆</button>
        <button style={{ padding: "8px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}><I name="sparkle" size={11} stroke={1.5}/> 刷新待更新记忆</button>
        <button style={{ padding: "8px 12px", fontSize: 12, color: "var(--bg-elev)", background: "var(--accent)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}><I name="zap" size={11} stroke={1.5}/> 预生成常用 AI 摘要</button>
      </>}
    >
      {/* 4 stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { l: "全部客户", v: "14", active: true },
          { l: "可直接使用", v: "14" },
          { l: "建议更新", v: "0" },
          { l: "尚未整理", v: "0" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "16px 20px", background: s.active ? "var(--accent-bg)" : "var(--bg-elev)", border: `1px solid ${s.active ? "var(--accent)" : "var(--line)"}`, borderRadius: "var(--r-md)" }}>
            <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{s.l}</div>
            <div className="num" style={{ fontSize: 28, color: "var(--ink)", fontWeight: 500, marginTop: 6 }}>{s.v}</div>
          </div>
        ))}
      </div>

      <CxPanel
        title="后台任务队列"
        subtitle="查看正在排队的客户记忆重建任务,并可直接取消或立即执行。"
        action={<button style={{ padding: "6px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}><I name="sparkle" size={11} stroke={1.5}/> 刷新队列</button>}
      >
        {[
          { n: "KPMG Advisory (毕马威管理咨询)", cat: "Management Consulting / Professional Services", type: "摘要预热", v: "3", st: "已同步", time: "2026/05/28 22:49" },
          { n: "The Estée Lauder Companies – Asia Pacific Travel Retail", cat: "Luxury Beauty & Cosmetics / Travel Retail", type: "摘要预热", v: "5", st: "已同步", time: "2026/05/28 22:49" },
          { n: "万华化学集团股份有限公司", cat: "Chemical Manufacturing", type: "摘要预热", v: "2", st: "已同步", time: "2026/05/28 22:50" },
          { n: "三一集团有限公司", cat: "工程机械制造 / Heavy Equipment Manufacturing", type: "摘要预热", v: "4", st: "已同步", time: "2026/05/28 22:51" },
        ].map((c, i) => (
          <div key={i} style={{ padding: "14px 16px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <I name="clock" size={11} stroke={1.5} style={{ color: "var(--accent)" }}/>
                  <span className="ui" style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500 }}>{c.n}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-mute)", marginLeft: 17 }}>{c.cat}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 4 }}><I name="arrow-right" size={9} stroke={2}/> 立即执行</button>
                <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>✕ 取消</button>
                <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 4 }}><I name="arrow-up-right" size={9} stroke={1.5}/> 查看</button>
              </div>
            </div>
            <div style={{ marginLeft: 17, marginTop: 8, display: "flex", gap: 12, fontSize: 11, color: "var(--ink-mute)", flexWrap: "wrap" }}>
              <CxStatus tone="accent">{c.type}</CxStatus>
              <span>版本 <span className="num">{c.v}</span></span>
              <span>状态: {c.st}</span>
              <span>计划执行: <span className="num">{c.time}</span></span>
            </div>
          </div>
        ))}
      </CxPanel>
    </CxSettingsShell>
  );
}

/* ============= Memory Operations · 记忆任务中心 ============= */
function CxSettingsMemOps() {
  return (
    <CxSettingsShell activeKey="mem-ops" title="记忆任务中心" subtitle="统一查看项目与客户记忆的重建、摘要预热、重试和失败情况。"
      actions={<button style={{ padding: "8px 14px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}><I name="sparkle" size={11} stroke={1.5}/> 刷新任务</button>}
    >
      {/* 9 stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 8, marginBottom: 20 }}>
        {[
          { l: "进行中/排队", v: "13", note: "当前排队或进行中的后台任务" },
          { l: "记忆重建", v: "0", note: "项目与客户记忆重建队列" },
          { l: "摘要预热", v: "13", note: "常用摘要缓存预热任务" },
          { l: "重试中的任务", v: "0", note: "已经至少重试过一次" },
          { l: "失败告警", v: "7", note: "未知 6", tone: "warn" },
          { l: "最近成功", v: "24", note: "最近完成的记忆任务" },
          { l: "需人工处理", v: "6", note: "数据库、数据缺失或未知失败", tone: "warn" },
          { l: "项目预热预算", v: "14/200", note: "剩余 186" },
          { l: "客户预热预算", v: "0/200", note: "剩余 200" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "12px 12px", background: s.tone === "warn" ? "color-mix(in oklch, var(--warn) 8%, var(--bg-elev))" : "var(--bg-elev)", border: `1px solid ${s.tone === "warn" ? "color-mix(in oklch, var(--warn) 30%, transparent)" : "var(--line)"}`, borderRadius: "var(--r-md)" }}>
            <div style={{ fontSize: 11, color: s.tone === "warn" ? "var(--warn)" : "var(--ink-mute)", fontWeight: 500 }}>{s.l}</div>
            <div className="num" style={{ fontSize: 20, color: s.tone === "warn" ? "var(--warn)" : "var(--ink)", fontWeight: 500, marginTop: 4 }}>{s.v}</div>
            <div style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 4, lineHeight: 1.4 }}>{s.note}</div>
          </div>
        ))}
      </div>

      {/* Failure alert summary */}
      <div style={{ padding: "16px 20px", background: "color-mix(in oklch, var(--warn) 5%, var(--bg-elev))", border: "1px solid color-mix(in oklch, var(--warn) 25%, transparent)", borderRadius: "var(--r-md)", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <I name="target" size={13} stroke={1.5} style={{ color: "var(--warn)" }}/>
              <h3 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--warn)" }}>失败告警汇总</h3>
            </div>
            <p style={{ margin: "4px 0 0 19px", fontSize: 12, color: "var(--ink-soft)" }}>按风险优先级汇总当前需要关注的记忆任务问题。</p>
          </div>
          <button style={{ padding: "6px 12px", fontSize: 11.5, color: "var(--warn)", border: "1px solid color-mix(in oklch, var(--warn) 35%, transparent)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}><I name="filter" size={10} stroke={1.5}/> 查看全部失败</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { t: "需要人工处理的失败", d: "6 条数据库、数据缺失或未知失败,不建议直接盲目重试。", btn: "查看人工处理项" },
            { t: "主要失败类型:未知", d: "最近失败中有 6 条属于这一类,建议优先清理。", btn: "筛选该类型" },
          ].map((c, i) => (
            <div key={i} style={{ padding: "12px 14px", background: "var(--bg-elev)", border: "1px solid color-mix(in oklch, var(--bad) 25%, transparent)", borderRadius: "var(--r-sm)" }}>
              <div className="ui" style={{ fontSize: 13, color: "var(--bad)", fontWeight: 500 }}>{c.t}</div>
              <p style={{ margin: "6px 0 10px", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.55 }}>{c.d}</p>
              <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--bad)", border: "1px solid color-mix(in oklch, var(--bad) 30%, transparent)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}><I name="arrow-up-right" size={9} stroke={1.5}/> {c.btn}</button>
            </div>
          ))}
        </div>
      </div>

      {/* Filter row */}
      <div style={{ display: "flex", gap: 8, padding: "10px 14px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)", marginBottom: 16, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", fontSize: 12, color: "var(--ink-mute)", flex: 1 }}>
          <I name="search" size={11} stroke={1.5}/> <span>搜索项目、客户、触</span>
        </div>
        {["全部范围", "全部任务类型", "全部重试状态", "全部失败类型", "全部处理方式"].map(t => (
          <button key={t} style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-soft)", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 4 }}>{t} <I name="chevron-down" size={9} stroke={1.5}/></button>
        ))}
        <button style={{ padding: "5px 12px", fontSize: 11.5, color: "var(--warn)", border: "1px solid color-mix(in oklch, var(--warn) 35%, transparent)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}><I name="filter" size={10} stroke={1.5}/> 显示失败记录</button>
      </div>

      {/* Failed records + detail panel */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        <div>
          {[
            { scope: "客户", n: "KPMG Advisory (毕马威管理咨询)", sub: "Management Consulting / Professional Services", type: "摘要预热", lang: "zh", v: "3", retry: "0/3", trig: "batch_warm", time: "2026年5月28日 22:49" },
            { scope: "客户", n: "The Estée Lauder Companies – Asia Pacific", sub: "Luxury Beauty / Travel Retail", type: "摘要预热", lang: "zh", v: "5", retry: "1/3", trig: "manual", time: "2026年5月28日 22:30" },
          ].map((f, i) => (
            <div key={i} style={{ padding: "14px 16px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{f.scope} / {f.n}</div>
                <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>计划执行<br/><span className="num">{f.time}</span></span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 8 }}>{f.sub}</div>
              <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--ink-mute)" }}>
                <span style={{ padding: "2px 6px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)" }}>{f.type}</span>
                <span>{f.lang}</span>
                <span>版本 <span className="num">{f.v}</span></span>
                <span>重试 <span className="num">{f.retry}</span></span>
                <span>触发: {f.trig}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "16px 18px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
          <h4 className="ui" style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>失败明细</h4>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-mute)", lineHeight: 1.6 }}>从左侧选择一条失败记录,这里会显示原始错误、分类判断和建议动作。</p>
        </div>
      </div>
    </CxSettingsShell>
  );
}

/* ============= Messages · 消息管理 ============= */
function CxSettingsMessages() {
  return (
    <CxSettingsShell activeKey="messages" title={null} subtitle={null}>
      <div style={{ marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent)", marginBottom: 8 }}>
            <I name="bell" size={13} stroke={1.5}/>
            <span style={{ fontSize: 12, fontWeight: 500 }}>消息管理</span>
          </div>
          <h1 className="ui" style={{ margin: 0, fontSize: 22, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>发布系统消息并查看阅读情况</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-mute)" }}>管理员可以在这里发布系统通知,用户会在右上角看到未读提醒并进入消息中心查看。</p>
        </div>
        <button style={{ padding: "8px 14px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}><I name="sparkle" size={11} stroke={1.5}/> 刷新列表</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Left: form */}
        <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <span style={{ width: 32, height: 32, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><I name="send" size={14} stroke={1.5}/></span>
            <div>
              <div className="ui" style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>发布新消息</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 1 }}>建议标题简洁,正文说明动作或背景。</div>
            </div>
          </div>

          <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>标题</label>
          <input placeholder="例如:本周系统维护安排" className="codex-input" style={{ width: "100%", padding: "10px 14px", fontSize: 13.5, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", marginBottom: 16 }}/>

          <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>正文</label>
          <textarea placeholder="输入消息正文…" rows={5} style={{ width: "100%", padding: "10px 14px", fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", marginBottom: 16, resize: "none", fontFamily: "var(--font-ui)" }}/>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>消息级别</label>
              <button style={{ width: "100%", padding: "9px 14px", fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--ink)" }}>
                普通通知 <I name="chevron-down" size={11} stroke={1.5} style={{ color: "var(--ink-mute)" }}/>
              </button>
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>跳转链接</label>
              <input placeholder="/projects 或 /settings/memory" className="codex-input" style={{ width: "100%", padding: "9px 14px", fontSize: 12.5, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}/>
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)", fontSize: 13, color: "var(--ink)", cursor: "pointer", marginBottom: 18 }}>
            <span style={{ width: 16, height: 16, borderRadius: 3, background: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <I name="check" size={10} stroke={2.4} style={{ color: "var(--bg-elev)" }}/>
            </span>
            立即发布给所有用户
          </label>

          <button style={{ padding: "10px 22px", background: "var(--accent)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
            <I name="send" size={12} stroke={1.5}/> 发布消息
          </button>
        </div>

        {/* Right: stats + message list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { l: "消息总数", v: "8" },
              { l: "已发布",   v: "8" },
              { l: "累计已读", v: "40" },
            ].map((s, i) => (
              <div key={i} style={{ padding: "14px 16px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
                <div style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{s.l}</div>
                <div className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500, marginTop: 4 }}>{s.v}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: "16px 20px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
              <I name="check" size={13} stroke={1.8} style={{ color: "var(--good)" }}/>
              <span className="ui" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>消息列表</span>
            </div>

            <div style={{ padding: "12px 14px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 10, padding: "2px 6px", background: "color-mix(in oklch, var(--info) 14%, transparent)", color: "var(--info)", borderRadius: 3, fontWeight: 500 }}>success</span>
                <CxStatus tone="good">已发布</CxStatus>
                <span className="num" style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>2026/05/28 19:12</span>
              </div>
              <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500, marginBottom: 8 }}>V0.0.3 版本上线</div>
              <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.7 }}>AriaAI V0.0.3 已正式发布,本次更新聚焦 Skill 体系治理、Harness 架构设计与记忆系统升级。</p>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.7 }}>
                <div style={{ color: "var(--ink)", fontWeight: 500 }}>核心更新:</div>
                <div style={{ marginTop: 6 }}><strong>1. Skill 体系治理</strong></div>
                <div style={{ paddingLeft: 12, fontSize: 12, color: "var(--ink-mute)" }}>• 完成 48 个 Skill 全量评估与质量分级(标杆级 7 个 / 可用级 7 个 / 骨架级 34 个)</div>
                <div style={{ paddingLeft: 12, fontSize: 12, color: "var(--ink-mute)" }}>• 发布《Skill 编写规范 v1.0》,建立强制目录结构、YAML 头部标准、9 章节模板</div>
                <div style={{ marginTop: 6 }}><strong>2. Model + Harness 架构设计</strong></div>
                <div style={{ paddingLeft: 12, fontSize: 12, color: "var(--ink-mute)" }}>• 引入 AI Run Harness,统一事件协议、状态机和分层职责边界</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CxSettingsShell>
  );
}

/* ============= Server Config · 服务器配置 ============= */
function CxSettingsServer() {
  return (
    <CxSettingsShell activeKey="server" title="服务器配置" subtitle="配置 AriaAI 后端服务器连接">
      {/* Connection status */}
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", marginBottom: 20, gap: 14 }}>
        <span style={{ width: 36, height: 36, borderRadius: "var(--r-sm)", background: "color-mix(in oklch, var(--good) 14%, transparent)", color: "var(--good)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><I name="zap" size={16} stroke={1.5}/></span>
        <div style={{ flex: 1 }}>
          <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>已连接</div>
          <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2 }} className="num">v0.0.3</div>
        </div>
        <button style={{ fontSize: 12.5, color: "var(--accent)", display: "flex", alignItems: "center", gap: 5 }}><I name="sparkle" size={11} stroke={1.5}/> 刷新</button>
      </div>

      <CxPanel
        title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><I name="paperclip" size={13} stroke={1.5} style={{ color: "var(--accent)" }}/> 服务器地址</span>}
        style={{ marginBottom: 16 }}
      >
        <div style={{ padding: "12px 16px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)", marginBottom: 14, fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.9 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>当前生效来源</span><span>默认值</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>当前生效地址</span><span className="num">/api</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-mute)" }}>后端存储值</span><span style={{ color: "var(--ink-faint)" }}>未设置</span></div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input defaultValue="/api" className="codex-input num" style={{ flex: 1, padding: "10px 14px", fontSize: 13.5, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}/>
          <button style={{ padding: "10px 16px", fontSize: 13, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}><I name="sparkle" size={11} stroke={1.5}/> 测试</button>
        </div>

        <div style={{ padding: "10px 14px", background: "color-mix(in oklch, var(--good) 8%, transparent)", border: "1px solid color-mix(in oklch, var(--good) 25%, transparent)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--good)" }}>
          <I name="check" size={12} stroke={2}/> 连接成功
        </div>
      </CxPanel>

      <CxPanel title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><I name="chevron-right" size={11} stroke={1.5} style={{ color: "var(--accent)" }}/> 快速选择</span>} style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            { l: "本地开发",  icon: "settings" },
            { l: "局域网",    icon: "target" },
            { l: "生产环境",  icon: "lock" },
          ].map(o => (
            <button key={o.l} className="row-hov" style={{ padding: "14px 16px", background: "var(--bg-tint)", border: "1px solid var(--line-soft)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 10 }}>
              <I name={o.icon} size={13} stroke={1.5} style={{ color: "var(--ink-soft)" }}/>
              <span className="ui" style={{ fontSize: 13, color: "var(--ink)" }}>{o.l}</span>
            </button>
          ))}
        </div>
      </CxPanel>

      <CxPanel title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><I name="lock" size={13} stroke={1.5} style={{ color: "var(--accent)" }}/> 连接安全</span>}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.7 }}>本地开发使用 HTTP,生产环境建议使用 HTTPS 加密连接。所有 API 请求都需要身份验证。</p>
      </CxPanel>
    </CxSettingsShell>
  );
}

Object.assign(window, { CxSettingsProjMem, CxSettingsClientMem, CxSettingsMemOps, CxSettingsMessages, CxSettingsServer });

/* ============= Appearance · 外观 ============= */
function CxSettingsAppearance() {
  const [theme, setTheme] = React.useState("light");
  const [density, setDensity] = React.useState("regular");
  const [radius, setRadius] = React.useState("soft");
  const [accent, setAccent] = React.useState("moss");

  const SwatchRow = ({ value, onChange, options, render }) => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {options.map(o => {
        const active = value === o.k;
        return (
          <button key={o.k} onClick={() => onChange(o.k)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "9px 14px",
              background: active ? "var(--accent-bg)" : "var(--bg)",
              border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
              borderRadius: "var(--r-sm)",
              color: active ? "var(--accent-ink)" : "var(--ink-soft)",
              fontSize: 13, fontWeight: active ? 500 : 400,
              cursor: "pointer",
            }}>
            {render ? render(o, active) : (
              <>
                {active && <I name="check" size={11} stroke={2}/>}
                {o.l}
              </>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <CxSettingsShell activeKey="appearance" title="外观" subtitle="主题、强调色、密度和圆角 — 改动只影响当前账户,所有页面立即生效。也可以在右上角 Tweaks 面板里调。">
      <div style={{ padding: "10px 14px", background: "var(--accent-bg)", border: "1px solid color-mix(in oklch, var(--accent) 25%, transparent)", borderRadius: "var(--r-sm)", fontSize: 12.5, color: "var(--accent-ink)", marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
        <I name="sparkle" size={12} stroke={1.5}/>
        这里展示的是当前外观状态。要切换,可以打开右上角「Tweaks · 调节」面板。
      </div>

      {/* Theme */}
      <CxFormRow label="主题" hint="深色模式更适合长时间阅读和会议场景">
        <SwatchRow value={theme} onChange={setTheme}
          options={[
            { k: "light",  l: "浅色" },
            { k: "dark",   l: "深色" },
            { k: "auto",   l: "跟随系统" },
          ]}
          render={(o, active) => (
            <>
              <span style={{
                width: 36, height: 24, borderRadius: 4,
                background: o.k === "dark" ? "#15130F" : o.k === "auto" ? "linear-gradient(to right, var(--bg) 50%, #15130F 50%)" : "var(--bg-elev)",
                border: `1px solid ${active ? "var(--accent)" : "var(--line-strong)"}`,
                display: "inline-block",
              }}/>
              {o.l}
            </>
          )}
        />
      </CxFormRow>

      {/* Accent */}
      <CxFormRow label="强调色" hint="出现在状态点、链接、CTA 与高亮上 — 整体克制使用">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { k: "moss",   l: "苔绿",  h: 150, c: 0.07 },
            { k: "amber",  l: "琥珀",  h: 75,  c: 0.12 },
            { k: "azure",  l: "天蓝",  h: 235, c: 0.10 },
            { k: "rose",   l: "玫瑰",  h: 15,  c: 0.12 },
          ].map(o => {
            const active = accent === o.k;
            return (
              <button key={o.k} onClick={() => setAccent(o.k)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  padding: 4, cursor: "pointer",
                }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: `oklch(0.5 ${o.c} ${o.h})`,
                  boxShadow: active ? `0 0 0 2px var(--bg), 0 0 0 4px oklch(0.5 ${o.c} ${o.h})` : "0 0 0 1px var(--line)",
                  transition: "box-shadow .15s",
                }}/>
                <span style={{ fontSize: 11, color: active ? "var(--ink)" : "var(--ink-mute)" }}>{o.l}</span>
              </button>
            );
          })}
        </div>
      </CxFormRow>

      {/* Density */}
      <CxFormRow label="信息密度" hint="紧凑显示更多信息,宽松呼吸感更好">
        <SwatchRow value={density} onChange={setDensity}
          options={[
            { k: "compact", l: "紧凑" },
            { k: "regular", l: "中等" },
            { k: "comfy",   l: "宽松" },
          ]}
        />
      </CxFormRow>

      {/* Radius */}
      <CxFormRow label="圆角" hint="影响卡片、按钮、徽章的整体气质">
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { k: "sharp", l: "锐利", r: 0 },
            { k: "soft",  l: "柔和", r: 6 },
            { k: "round", l: "圆润", r: 14 },
          ].map(o => {
            const active = radius === o.k;
            return (
              <button key={o.k} onClick={() => setRadius(o.k)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  padding: 4, cursor: "pointer",
                }}>
                <span style={{
                  width: 56, height: 36,
                  borderRadius: o.r,
                  background: active ? "var(--accent-bg)" : "var(--bg-elev)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                  display: "inline-block",
                }}/>
                <span style={{ fontSize: 12, color: active ? "var(--ink)" : "var(--ink-mute)" }}>{o.l}</span>
              </button>
            );
          })}
        </div>
      </CxFormRow>

      {/* Preview */}
      <div style={{ marginTop: 28 }}>
        <h3 className="ui" style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "var(--ink-mute)" }}>预览</h3>
        <div style={{ padding: "16px 20px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <CxStatus tone="accent" pulse>示例徽章</CxStatus>
              <h4 className="ui" style={{ margin: "8px 0 0", fontSize: 16, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.01em" }}>鼎和保险 · 数字化转型咨询</h4>
            </div>
            <button style={{ padding: "8px 16px", background: "var(--accent)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 13, fontWeight: 500 }}>主操作</button>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.65 }}>
            根据上面的选择,这块预览的卡片圆角、徽章形状、按钮密度都会跟着变化。
          </p>
        </div>
      </div>
    </CxSettingsShell>
  );
}

Object.assign(window, { CxSettingsAppearance });
