// direction-codex-settings.jsx — All settings pages
// 11 pages sharing CxSettingsShell

const SETTINGS_NAV = [
  { k: "profile",      l: "个人资料",          group: "personal" },
  { k: "appearance",   l: "外观",              group: "personal" },
  { k: "language",     l: "语言",              group: "personal" },
  { k: "ai",           l: "AI 模型",           group: "ai" },
  { k: "proj-mem",     l: "项目记忆",          group: "ai" },
  { k: "client-mem",   l: "客户记忆",          group: "ai" },
  { k: "mem-ops",      l: "记忆任务中心",      group: "ai" },
  { k: "api",          l: "API 限流",          group: "admin" },
  { k: "migrations",   l: "迁移状态",          group: "admin" },
  { k: "messages",     l: "消息管理",          group: "admin" },
  { k: "server",       l: "服务器配置",        group: "admin" },
  { k: "users",        l: "用户管理",          group: "admin" },
  { k: "about",        l: "关于",              group: "personal" },
];

function CxSettingsShell({ activeKey, title, subtitle, actions, children }) {
  const groups = {
    personal: "个人",
    ai: "AI 与记忆",
    admin: "管理员",
  };
  const navByGroup = SETTINGS_NAV.reduce((acc, n) => {
    (acc[n.group] = acc[n.group] || []).push(n);
    return acc;
  }, {});

  return (
    <CxShell activeKey="workspace">
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "240px 1fr", minHeight: 0, overflow: "hidden" }}>
        <aside style={{ padding: "24px 16px 24px 40px", borderRight: "1px solid var(--line)", overflow: "hidden" }}>
          <h2 className="ui" style={{ margin: "0 0 18px", fontSize: 18, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.015em" }}>设置</h2>
          {["personal", "ai", "admin"].map(g => (
            <div key={g} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 10px 6px" }}>{groups[g]}</div>
              {navByGroup[g].map(n => (
                <a key={n.k} className="row-hov" style={{ display: "block", padding: "7px 10px", fontSize: 13, color: n.k === activeKey ? "var(--ink)" : "var(--ink-soft)", borderRadius: "var(--r-sm)", background: n.k === activeKey ? "var(--bg-tint)" : "transparent", fontWeight: n.k === activeKey ? 500 : 400, position: "relative", marginBottom: 1 }}>
                  {n.k === activeKey && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 2, background: "var(--accent)", borderRadius: 99 }}/>}
                  {n.l}
                </a>
              ))}
            </div>
          ))}
        </aside>

        <div style={{ padding: "32px 48px 40px", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 20 }}>
            <div>
              <h1 className="ui" style={{ margin: 0, fontSize: 26, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>{title}</h1>
              {subtitle && <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--ink-mute)", lineHeight: 1.6, maxWidth: 600 }}>{subtitle}</p>}
            </div>
            {actions && <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>{actions}</div>}
          </div>
          {children}
        </div>
      </div>
    </CxShell>
  );
}

// Reusable form row
function CxFormRow({ label, hint, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", padding: "16px 0", borderBottom: "1px solid var(--line-soft)", gap: 28, alignItems: "flex-start" }}>
      <div>
        <div className="ui" style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function CxInput(props) {
  return <input {...props} className={"codex-input " + (props.className || "")} style={{ width: "100%", padding: "8px 12px", fontSize: 13.5, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", ...(props.style || {}) }}/>;
}

function CxSwitch({ on }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", width: 34, height: 19, padding: 2, borderRadius: 99, background: on ? "var(--accent)" : "var(--line-strong)", transition: "background 0.15s" }}>
      <span style={{ width: 15, height: 15, borderRadius: 99, background: "var(--bg-elev)", transform: on ? "translateX(15px)" : "translateX(0)", transition: "transform 0.15s" }}/>
    </span>
  );
}

/* ============= 1. Profile ============= */
function CxSettingsProfile() {
  return (
    <CxSettingsShell activeKey="profile" title="个人资料" subtitle="这些信息会出现在团队视图中,以及对话发送者标识。"
      actions={
        <>
          <button style={{ padding: "8px 14px", fontSize: 13, color: "var(--ink-mute)" }}>取消</button>
          <button style={{ padding: "8px 18px", fontSize: 13, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>保存修改</button>
        </>
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 22, padding: "20px 0", borderBottom: "1px solid var(--line-soft)" }}>
        <span style={{ width: 64, height: 64, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 500 }}>陈</span>
        <div>
          <button style={{ padding: "7px 14px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>上传头像</button>
          <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 6 }}>PNG / JPG · 最大 2 MB</div>
        </div>
      </div>
      <CxFormRow label="姓名"><CxInput defaultValue="陈悦"/></CxFormRow>
      <CxFormRow label="邮箱" hint="登录用,变更需邮件验证"><CxInput defaultValue="chenyue@aria.team"/></CxFormRow>
      <CxFormRow label="电话" hint="可选 · 用于关键告警通知"><CxInput defaultValue="138-****-5678"/></CxFormRow>
      <CxFormRow label="团队" hint="影响项目和 Skill 库的可见范围"><CxInput defaultValue="解决方案咨询组"/></CxFormRow>
      <CxFormRow label="职位"><CxInput defaultValue="高级解决方案顾问"/></CxFormRow>
      <CxFormRow label="对话签名" hint="对话发送时附加的个人签名"><textarea rows={2} defaultValue="陈悦 · 解决方案咨询组" style={{ width: "100%", padding: "8px 12px", fontSize: 13.5, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", resize: "none", fontFamily: "var(--font-ui)" }}/></CxFormRow>
    </CxSettingsShell>
  );
}

/* ============= 2. Language ============= */
function CxSettingsLanguage() {
  return (
    <CxSettingsShell activeKey="language" title="语言与时区" subtitle="界面语言、日期与时间显示。仅影响当前账户。">
      <CxFormRow label="界面语言">
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { v: "zh", l: "中文" , active: true},
            { v: "en", l: "English" },
            { v: "ja", l: "日本語" },
          ].map(o => (
            <label key={o.v} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", border: `1px solid ${o.active ? "var(--accent)" : "var(--line)"}`, background: o.active ? "var(--accent-bg)" : "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 13, color: o.active ? "var(--accent-ink)" : "var(--ink-soft)", cursor: "pointer" }}>
              <span style={{ width: 12, height: 12, borderRadius: 99, border: `1.5px solid ${o.active ? "var(--accent)" : "var(--line-strong)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {o.active && <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--accent)" }}/>}
              </span>
              {o.l}
            </label>
          ))}
        </div>
      </CxFormRow>
      <CxFormRow label="时区"><CxInput defaultValue="Asia/Shanghai (UTC+8)"/></CxFormRow>
      <CxFormRow label="日期格式" hint="影响列表和详情页中的日期显示">
        <div style={{ display: "flex", gap: 8 }}>
          {["YYYY-MM-DD", "YYYY 年 MM 月 DD 日", "MM/DD/YYYY"].map((d, i) => (
            <button key={d} style={{ padding: "7px 14px", fontSize: 12.5, color: i === 0 ? "var(--ink)" : "var(--ink-mute)", border: `1px solid ${i === 0 ? "var(--accent)" : "var(--line)"}`, background: i === 0 ? "var(--accent-bg)" : "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>
              {d}
            </button>
          ))}
        </div>
      </CxFormRow>
      <CxFormRow label="周起始"><div style={{ display: "flex", gap: 8 }}>{["周一", "周日"].map((d, i) => <button key={d} style={{ padding: "7px 14px", fontSize: 12.5, color: i === 0 ? "var(--ink)" : "var(--ink-mute)", border: `1px solid ${i === 0 ? "var(--accent)" : "var(--line)"}`, background: i === 0 ? "var(--accent-bg)" : "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>{d}</button>)}</div></CxFormRow>
    </CxSettingsShell>
  );
}

/* ============= 3. AI Models ============= */
function CxSettingsAI() {
  return (
    <CxSettingsShell activeKey="ai" title="AI 模型" subtitle="管理对话所用模型、温度、最大 tokens 与降级策略。变更对全员生效。">
      <section style={{ marginBottom: 28 }}>
        <h3 className="ui" style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "var(--ink-mute)" }}>默认模型</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[
            { name: "gpt-5",       desc: "首选 · 长上下文 256k", status: "在用", tone: "good", active: true },
            { name: "claude-4.5",  desc: "备用 · 降级优先",       status: "待命", tone: "mute" },
            { name: "qwen-3 max",  desc: "国内场景备份",          status: "待命", tone: "mute" },
          ].map(m => (
            <div key={m.name} style={{ padding: "16px 18px", background: m.active ? "var(--accent-bg)" : "var(--bg-elev)", border: `1px solid ${m.active ? "var(--accent)" : "var(--line)"}`, borderRadius: "var(--r-md)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span className="ui" style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{m.name}</span>
                <CxStatus tone={m.tone}>{m.status}</CxStatus>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-mute)" }}>{m.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="ui" style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "var(--ink-mute)" }}>生成参数</h3>
        <CxFormRow label="Temperature" hint="0 = 确定性输出 · 1 = 创造性输出">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <input type="range" min="0" max="100" defaultValue="60" style={{ flex: 1 }}/>
            <span className="num" style={{ fontSize: 13, color: "var(--ink)", width: 36, textAlign: "right" }}>0.6</span>
          </div>
        </CxFormRow>
        <CxFormRow label="Top P" hint="采样概率阈值"><CxInput defaultValue="0.95" className="num"/></CxFormRow>
        <CxFormRow label="Max Tokens" hint="单次响应上限"><CxInput defaultValue="8000" className="num"/></CxFormRow>
        <CxFormRow label="降级策略" hint="主模型失败时的自动切换">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {["主模型失败 · 自动切到备用", "超时 30 秒 · 自动重试 1 次", "错误码 429 · 等待 5 秒重试"].map((s, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink)" }}>
                <CxSwitch on={i < 2}/>
                {s}
              </label>
            ))}
          </div>
        </CxFormRow>
      </section>
    </CxSettingsShell>
  );
}

/* ============= 4. Project Memory Settings ============= */
function CxSettingsProjMem() {
  return (
    <CxSettingsShell activeKey="proj-mem" title="项目记忆 · 配置" subtitle="项目记忆的槽位模板、自动汇总频率和保留策略。">
      <section style={{ marginBottom: 28 }}>
        <h3 className="ui" style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "var(--ink-mute)" }}>槽位模板 · 默认 5 槽</h3>
        <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
          {[
            { k: "客户背景", desc: "客户基本信息、规模、行业上下文", req: true },
            { k: "核心痛点", desc: "客户面临的关键问题",                  req: true },
            { k: "我方方案", desc: "我方提出的解决思路与框架",            req: true },
            { k: "决策链",    desc: "客户内部的关键决策人和影响人",        req: true },
            { k: "下一步",    desc: "短期内的关键动作与节点",              req: false },
          ].map((s, i, arr) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 60px 30px", padding: "12px 18px", gap: 14, alignItems: "center", borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--line-soft)" }}>
              <span className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{s.k}</span>
              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{s.desc}</span>
              {s.req ? <CxStatus tone="accent">必填</CxStatus> : <CxStatus tone="mute">可选</CxStatus>}
              <button style={{ color: "var(--ink-faint)", fontSize: 13 }}>⋯</button>
            </div>
          ))}
        </div>
        <button style={{ marginTop: 10, fontSize: 12.5, color: "var(--accent)" }}>+ 添加自定义槽位</button>
      </section>

      <section>
        <h3 className="ui" style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "var(--ink-mute)" }}>自动行为</h3>
        <CxFormRow label="自动汇总频率" hint="项目记忆自动重新汇总的时机">
          <div style={{ display: "flex", gap: 8 }}>
            {["每次对话结束", "每日凌晨", "手动触发"].map((o, i) => (
              <button key={o} style={{ padding: "7px 14px", fontSize: 12.5, color: i === 0 ? "var(--ink)" : "var(--ink-mute)", border: `1px solid ${i === 0 ? "var(--accent)" : "var(--line)"}`, background: i === 0 ? "var(--accent-bg)" : "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>{o}</button>
            ))}
          </div>
        </CxFormRow>
        <CxFormRow label="新鲜度阈值" hint="超过该时长未更新即标记「过期」">
          <CxInput defaultValue="48 小时" style={{ maxWidth: 200 }}/>
        </CxFormRow>
        <CxFormRow label="版本保留">
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink)" }}>
            <CxSwitch on={true}/>
            保留所有历史版本(可供对比与回滚)
          </div>
        </CxFormRow>
      </section>
    </CxSettingsShell>
  );
}

/* ============= 5. Client Memory Settings ============= */
function CxSettingsClientMem() {
  return (
    <CxSettingsShell activeKey="client-mem" title="客户记忆 · 配置" subtitle="跨项目沉淀的客户档案 — 关键人物、组织结构、合作偏好。">
      <section style={{ marginBottom: 28 }}>
        <h3 className="ui" style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "var(--ink-mute)" }}>结构模板</h3>
        <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
          {[
            { k: "组织结构", desc: "公司基本信息、规模、业务板块" },
            { k: "关键人物", desc: "决策人、影响人、对接人,带联系方式" },
            { k: "合作历史", desc: "过往项目、合作满意度评分" },
            { k: "决策偏好", desc: "采购模式、决策周期、关注议题" },
            { k: "禁忌点",   desc: "敏感话题、负面历史、需要回避的内容" },
          ].map((s, i, arr) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr 30px", padding: "12px 18px", gap: 14, alignItems: "center", borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--line-soft)" }}>
              <span className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{s.k}</span>
              <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{s.desc}</span>
              <button style={{ color: "var(--ink-faint)", fontSize: 13 }}>⋯</button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <CxFormRow label="自动从项目沉淀" hint="项目结束后自动提炼客户信息到客户记忆">
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink)" }}>
            <CxSwitch on={true}/>
            启用 · 仅提炼通过审核的内容
          </div>
        </CxFormRow>
        <CxFormRow label="冲突处理" hint="当不同项目沉淀出矛盾信息时">
          <div style={{ display: "flex", gap: 8 }}>
            {["保留最新", "标记冲突待审", "保留全部"].map((o, i) => (
              <button key={o} style={{ padding: "7px 14px", fontSize: 12.5, color: i === 1 ? "var(--ink)" : "var(--ink-mute)", border: `1px solid ${i === 1 ? "var(--accent)" : "var(--line)"}`, background: i === 1 ? "var(--accent-bg)" : "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>{o}</button>
            ))}
          </div>
        </CxFormRow>
        <CxFormRow label="共享范围"><CxInput defaultValue="团队全员可见"/></CxFormRow>
      </section>
    </CxSettingsShell>
  );
}

/* ============= 6. Memory Operations (refactor existing) ============= */
function CxSettingsMemOps() {
  return (
    <CxSettingsShell activeKey="mem-ops" title="Memory Operations" subtitle="查看记忆任务的运行状态、失败明细、预算消耗 — 仅管理员可见。">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", marginBottom: 26 }}>
        {[
          { l: "队列中", v: "8", tone: "warn", note: "近 1 小时 +2" },
          { l: "本月运行", v: "1,247", tone: "neutral", note: "累计" },
          { l: "失败", v: "3", tone: "bad", note: "待复查" },
          { l: "预算余额", v: "62%", tone: "good", note: "¥24 / ¥40" },
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
        { type: "项目记忆 · 摘要", target: "鼎和保险 · 数字化转型咨询", status: "成功", dur: "12s", time: "刚刚", tone: "good" },
        { type: "客户记忆 · 沉淀", target: "鼎和保险股份有限公司", status: "运行中", dur: "8s+", time: "进行中", tone: "accent", pulse: true },
        { type: "项目记忆 · 摘要", target: "申通快运 · 中台升级", status: "成功", dur: "9s", time: "2 分钟前", tone: "good" },
        { type: "客户记忆 · 沉淀", target: "中信地产", status: "失败", dur: "4s", time: "5 分钟前", tone: "bad" },
        { type: "项目记忆 · 摘要", target: "金辉医疗 · 知识库迁移", status: "成功", dur: "15s", time: "10 分钟前", tone: "good" },
      ].map((t, i) => (
        <div key={i} className="row-hov" style={{ display: "grid", gridTemplateColumns: "140px 1fr 140px 70px 90px", padding: "12px 6px", gap: 12, alignItems: "center", borderTop: "1px solid var(--line-soft)" }}>
          <span className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)", fontWeight: 500 }}>{t.type}</span>
          <span className="ui" style={{ fontSize: 13.5, color: "var(--ink)" }}>{t.target}</span>
          <CxStatus tone={t.tone} pulse={t.pulse}>{t.status}</CxStatus>
          <span className="num" style={{ fontSize: 12, color: "var(--ink-mute)" }}>{t.dur}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)", textAlign: "right" }}>{t.time}</span>
        </div>
      ))}
    </CxSettingsShell>
  );
}

/* ============= API Limits — based on real source: rate-limit & model pressure monitor ============= */
function CxSettingsAPI() {
  return (
    <CxSettingsShell activeKey="api" title="API 限流提醒" subtitle="集中展示模型 API 的 429、rate limit、超时和预热预算压力。判断是该等待恢复、降低并发,还是检查 API Key 与模型配置。"
      actions={<button style={{ padding: "8px 14px", fontSize: 13, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}><I name="sparkle" size={11} stroke={1.5}/> 刷新</button>}
    >
      {/* Hero strip — API health monitor */}
      <div style={{ background: "linear-gradient(135deg, var(--bg-tint) 0%, var(--bg-elev) 100%)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CxStatus tone="good" pulse>API 健康观察 · 每 15 秒自动刷新</CxStatus>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink-mute)" }}>最后更新 12 秒前</span>
        </div>
      </div>

      {/* 4 stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
        {[
          { l: "限流告警", v: "2", note: "最近 429 / rate limit", tone: "bad", icon: "target" },
          { l: "重试中任务", v: "4", note: "等待再次执行的记忆任务", tone: "warn", icon: "clock" },
          { l: "项目预热预算", v: "12 / 20", note: "剩余 / 每日额度", tone: "warn", icon: "zap" },
          { l: "模型压力事件", v: "7", note: "限流 + 超时 + LLM 失败合计", tone: "warn", icon: "sparkle" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "16px 18px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><I name={s.icon} size={13} stroke={1.5}/></span>
              <CxStatus tone={s.tone}>{s.tone === "bad" ? "需关注" : s.tone === "warn" ? "压力中" : "正常"}</CxStatus>
            </div>
            <div className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500 }}>{s.v}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 4, fontWeight: 500 }}>{s.l}</div>
            <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 3 }}>{s.note}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>
        {/* Main — recent failures list */}
        <div>
          <div style={{ marginBottom: 14 }}>
            <h3 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>最近限流提醒 · 6 条</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-mute)", lineHeight: 1.55 }}>这些任务已经被归类为 API 限流 — 建议稍后重试或降低批量预热节奏。</p>
          </div>
          {[
            { scope: "项目", name: "鼎和保险 · 数字化转型咨询", category: "rate_limit", stage: "memory.summarize", msg: "429 Too Many Requests · provider returned engine_overloaded", retries: 2, when: "刚刚" },
            { scope: "项目", name: "中信地产 · 智慧园区",       category: "rate_limit", stage: "memory.embed",      msg: "429 rate limit · daily quota exceeded · suggest backoff",   retries: 1, when: "3 分钟前" },
            { scope: "客户", name: "鼎和保险股份有限公司",     category: "timeout",    stage: "client.distill",   msg: "Request timed out after 30s · upstream pressure",            retries: 2, when: "8 分钟前" },
            { scope: "客户", name: "中信地产",                  category: "llm",        stage: "client.distill",   msg: "kimi: timeout · 上游 LLM 响应缓慢",                            retries: 1, when: "14 分钟前" },
            { scope: "项目", name: "金辉医疗 · 知识库迁移",     category: "rate_limit", stage: "memory.summarize", msg: "claude: 429 rate_limit_error · please retry",                  retries: 0, when: "22 分钟前" },
            { scope: "项目", name: "申通快运 · 中台升级",       category: "timeout",    stage: "memory.embed",      msg: "Connection timeout · embedding model unavailable",             retries: 1, when: "1 小时前" },
          ].map((f, i) => (
            <a key={i} className="row-hov" style={{ display: "block", padding: "14px 16px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <CxStatus tone={f.category === "rate_limit" ? "bad" : "warn"}>{f.category === "rate_limit" ? "API 限流" : f.category === "timeout" ? "超时" : "模型压力"}</CxStatus>
                <span style={{ fontSize: 11, color: "var(--ink-mute)", padding: "2px 8px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>{f.scope}</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{f.stage}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-faint)" }}>{f.when}</span>
              </div>
              <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>{f.name}</div>
              <p style={{ margin: "4px 0 8px", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.55, fontFamily: "var(--font-mono)" }}>{f.msg}</p>
              <div style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>已重试 <span className="num" style={{ color: f.retries > 0 ? "var(--warn)" : "var(--ink)" }}>{f.retries}</span> 次</div>
            </a>
          ))}
        </div>

        {/* Side — recommended actions + budgets */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <CxPanel title="处理建议">
            <a className="row-hov" style={{ display: "flex", gap: 10, padding: "10px", margin: "0 -10px", borderRadius: "var(--r-sm)", alignItems: "flex-start" }}>
              <I name="target" size={13} stroke={1.5} style={{ color: "var(--warn)", marginTop: 2, flexShrink: 0 }}/>
              <div>
                <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500 }}>先暂停批量预热</div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 3, lineHeight: 1.55 }}>限流出现时优先减少并发和重试风暴,再手动处理高优任务</div>
              </div>
            </a>
            <a className="row-hov" style={{ display: "flex", gap: 10, padding: "10px", margin: "0 -10px", borderRadius: "var(--r-sm)", alignItems: "flex-start" }}>
              <I name="sparkle" size={13} stroke={1.5} style={{ color: "var(--accent)", marginTop: 2, flexShrink: 0 }}/>
              <div>
                <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500 }}>检查模型与 API Key</div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 3, lineHeight: 1.55 }}>如果持续,检查供应商额度、模型可用性与 API Key 状态</div>
              </div>
            </a>
          </CxPanel>

          {/* Budget strips */}
          <CxPanel title="项目记忆预热预算">
            <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8 }}>已用 <span className="num">8</span> / <span className="num">20</span>,剩余 <span className="num">12</span></div>
            <div style={{ height: 6, background: "var(--bg-sunken)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: "40%", height: "100%", background: "var(--good)" }}/>
            </div>
            <div style={{ marginTop: 8 }}><CxStatus tone="good">健康</CxStatus></div>
          </CxPanel>

          <CxPanel title="客户记忆预热预算">
            <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8 }}>已用 <span className="num">17</span> / <span className="num">20</span>,剩余 <span className="num">3</span></div>
            <div style={{ height: 6, background: "var(--bg-sunken)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: "85%", height: "100%", background: "var(--warn)" }}/>
            </div>
            <div style={{ marginTop: 8 }}><CxStatus tone="warn">接近上限</CxStatus></div>
          </CxPanel>
        </aside>
      </div>
    </CxSettingsShell>
  );
}

/* ============= 8. Users ============= */
function CxSettingsUsers() {
  const users = [
    { n: "陈悦", e: "chenyue@aria.team", role: "管理员", team: "解决方案", last: "刚刚", you: true },
    { n: "林宥", e: "linyou@aria.team",  role: "成员",   team: "解决方案", last: "30 分钟前" },
    { n: "苏明", e: "suming@aria.team",  role: "成员",   team: "数据顾问", last: "今天 09:14" },
    { n: "周静", e: "zhoujing@aria.team", role: "成员",   team: "解决方案", last: "昨天" },
    { n: "韦琪", e: "weiqi@aria.team",   role: "只读",   team: "财务",     last: "3 天前" },
    { n: "马川", e: "machuan@aria.team", role: "管理员", team: "运营",     last: "1 周前" },
  ];
  return (
    <CxSettingsShell activeKey="users" title="用户管理" subtitle={`${users.length} 个成员 · 2 个管理员 · 1 个只读`}
      actions={<button style={{ padding: "8px 14px", fontSize: 13, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>+ 邀请成员</button>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 0.8fr 0.8fr 80px 14px", padding: "10px 12px", fontSize: 11.5, color: "var(--ink-faint)", borderBottom: "1px solid var(--line)" }}>
        <span>姓名 / 邮箱</span><span>团队</span><span>角色</span><span>最近活跃</span><span>状态</span><span/>
      </div>
      {users.map(u => (
        <div key={u.e} className="row-hov" style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 0.8fr 0.8fr 80px 14px", padding: "13px 12px", gap: 12, alignItems: "center", borderBottom: "1px solid var(--line-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 30, height: 30, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}>{u.n[0]}</span>
            <div>
              <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{u.n} {u.you && <span style={{ fontSize: 10.5, color: "var(--ink-mute)", marginLeft: 4 }}>(你)</span>}</div>
              <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{u.e}</div>
            </div>
          </div>
          <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{u.team}</span>
          <CxStatus tone={u.role === "管理员" ? "accent" : u.role === "只读" ? "mute" : "neutral"}>{u.role}</CxStatus>
          <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{u.last}</span>
          <CxStatus tone="good">激活</CxStatus>
          <button style={{ color: "var(--ink-faint)" }}>⋯</button>
        </div>
      ))}
    </CxSettingsShell>
  );
}

/* ============= 9. Migrations ============= */
function CxSettingsMigrations() {
  return (
    <CxSettingsShell activeKey="migrations" title="迁移状态" subtitle="数据库迁移历史 · 当前版本与 schema 健康度。"
      actions={<button style={{ padding: "8px 14px", fontSize: 13, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>检查更新</button>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)", marginBottom: 22 }}>
        <div style={{ padding: "0 22px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 6 }}>当前 Schema</div>
          <span className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500 }}>v0.42</span>
          <div style={{ marginTop: 5 }}><CxStatus tone="good">最新</CxStatus></div>
        </div>
        <div style={{ padding: "0 22px", borderLeft: "1px solid var(--line-soft)" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 6 }}>已应用迁移</div>
          <span className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500 }}>42</span>
          <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--ink-mute)" }}>0 待应用</div>
        </div>
        <div style={{ padding: "0 22px", borderLeft: "1px solid var(--line-soft)" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 6 }}>最近迁移</div>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>add_anchors_table</span>
          <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--ink-mute)" }}>3 天前</div>
        </div>
      </div>

      <h3 className="ui" style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "var(--ink-mute)" }}>历史</h3>
      {[
        { v: "v0.42", n: "add_anchors_table", d: "新增项目锚点表",                  t: "3 天前",  s: "成功" },
        { v: "v0.41", n: "expand_memory_slots", d: "扩展项目记忆槽位 · 5 → 12",      t: "1 周前",  s: "成功" },
        { v: "v0.40", n: "add_skill_history", d: "新增 Skill 调用历史表",             t: "2 周前",  s: "成功" },
        { v: "v0.39", n: "client_memory_v2", d: "客户记忆 v2 数据结构",               t: "3 周前",  s: "成功" },
        { v: "v0.38", n: "budget_tracking", d: "新增预算追踪",                        t: "4 周前",  s: "成功" },
      ].map((m, i) => (
        <div key={m.v} style={{ display: "grid", gridTemplateColumns: "60px 1fr 80px 90px", padding: "12px 8px", gap: 14, alignItems: "center", borderBottom: i === 4 ? "none" : "1px solid var(--line-soft)" }}>
          <span className="num" style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{m.v}</span>
          <div>
            <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{m.n}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>{m.d}</div>
          </div>
          <CxStatus tone="good">{m.s}</CxStatus>
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)", textAlign: "right" }}>{m.t}</span>
        </div>
      ))}
    </CxSettingsShell>
  );
}

/* ============= 10. Server ============= */
function CxSettingsServer() {
  return (
    <CxSettingsShell activeKey="server" title="服务器" subtitle="部署模式、资源使用、健康检查。仅超级管理员可见。">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 26 }}>
        {[
          { l: "服务状态",  v: "运行中", note: "uptime 47 天",  tone: "good" },
          { l: "CPU 使用",  v: "32%",   note: "8 vCPU",       tone: "good" },
          { l: "内存",      v: "62%",   note: "20 / 32 GB",   tone: "warn" },
          { l: "磁盘",      v: "41%",   note: "164 / 400 GB", tone: "good" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "16px 18px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
            <div style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{s.l}</div>
            <div className="num" style={{ fontSize: 24, color: "var(--ink)", fontWeight: 500, marginTop: 4 }}>{s.v}</div>
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>{s.note}</span>
              <CxStatus tone={s.tone}>正常</CxStatus>
            </div>
          </div>
        ))}
      </div>

      <h3 className="ui" style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "var(--ink-mute)" }}>部署</h3>
      <CxFormRow label="部署模式"><CxInput defaultValue="自托管 · Docker Compose"/></CxFormRow>
      <CxFormRow label="数据库" hint="主库 · PostgreSQL 16"><CxInput defaultValue="postgres://aria.internal:5432/aria"/></CxFormRow>
      <CxFormRow label="向量存储"><CxInput defaultValue="Qdrant · 内嵌"/></CxFormRow>
      <CxFormRow label="对象存储"><CxInput defaultValue="MinIO · 本地"/></CxFormRow>
      <CxFormRow label="健康检查频率"><CxInput defaultValue="每 30 秒"/></CxFormRow>
      <CxFormRow label="备份策略" hint="数据库与文件备份频率">
        <div style={{ display: "flex", gap: 8 }}>
          {["每日凌晨", "每 6 小时", "实时"].map((o, i) => (
            <button key={o} style={{ padding: "7px 14px", fontSize: 12.5, color: i === 0 ? "var(--ink)" : "var(--ink-mute)", border: `1px solid ${i === 0 ? "var(--accent)" : "var(--line)"}`, background: i === 0 ? "var(--accent-bg)" : "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>{o}</button>
          ))}
        </div>
      </CxFormRow>
    </CxSettingsShell>
  );
}

/* ============= About — overview + changelog + license + migration status ============= */
function CxSettingsAbout() {
  const [tab, setTab] = React.useState("overview");
  return (
    <CxSettingsShell activeKey="about" title="关于 AriaAI" subtitle="版本信息与技术说明"
      actions={<button style={{ padding: "8px 12px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}>
        <I name="paperclip" size={11} stroke={1.5}/> 复制版本信息
      </button>}
    >
      {/* Tab switcher */}
      <div style={{ display: "flex", padding: 3, background: "var(--bg-tint)", borderRadius: "var(--r-sm)", border: "1px solid var(--line-soft)", marginBottom: 22, maxWidth: 540 }}>
        {[
          { k: "overview",  l: "概览" },
          { k: "changelog", l: "更新日志" },
          { k: "license",   l: "许可说明" },
        ].map(t => {
          const active = tab === t.k;
          return (
            <button key={t.k} onClick={() => setTab(t.k)} style={{ flex: 1, padding: "6px 10px", borderRadius: "var(--r-sm)", background: active ? "var(--bg-elev)" : "transparent", border: active ? "1px solid var(--line)" : "1px solid transparent", fontSize: 13, color: active ? "var(--ink)" : "var(--ink-mute)", fontWeight: active ? 500 : 400 }}>
              {t.l}
            </button>
          );
        })}
      </div>

      {tab === "overview" && <CxAboutOverview/>}
      {tab === "changelog" && <CxAboutChangelog/>}
      {tab === "license" && <CxAboutLicense/>}
    </CxSettingsShell>
  );
}

function CxAboutOverview() {
  return (
    <>
      {/* Hero card */}
      <div style={{ background: "linear-gradient(135deg, var(--bg-tint) 0%, var(--bg-elev) 100%)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "22px 24px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <span style={{ width: 52, height: 52, borderRadius: "var(--r-md)", background: "var(--ink)", color: "var(--bg-elev)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 600 }}>A</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2 className="ui" style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.015em" }}>AriaAI</h2>
              <span className="num" style={{ fontSize: 11, color: "var(--accent-ink)", background: "var(--accent-bg)", padding: "2px 8px", borderRadius: "var(--r-pill)", fontWeight: 500 }}>V0.0.3</span>
              <CxStatus tone="good" pulse>系统在线</CxStatus>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 6 }}>智能咨询助手</div>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-mute)", lineHeight: 1.65, maxWidth: 620 }}>
              当前版本页汇总产品版本、打包时间、API 状态与基础技术栈,方便发布留档与环境核对。
            </p>
          </div>
        </div>
      </div>

      {/* 4 stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
        {[
          { l: "版本",    v: "V0.0.3",    note: "前端发布版本", icon: "file" },
          { l: "API 版本", v: "0.4.2",    note: "接口已连接",  icon: "sparkle" },
          { l: "构建日期", v: "2026-05-28", note: "打包时间 14:32", icon: "calendar" },
          { l: "环境",    v: "production", note: "生产环境",   icon: "lock" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "16px 18px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{s.l}</span>
              <span style={{ color: "var(--accent)" }}><I name={s.icon} size={13} stroke={1.5}/></span>
            </div>
            <div className="num" style={{ fontSize: 18, color: "var(--ink)", fontWeight: 500 }}>{s.v}</div>
            <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 4 }}>{s.note}</div>
          </div>
        ))}
      </div>

      {/* 2 cols: Release notes + Tech stack */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16, marginBottom: 22 }}>
        <CxPanel title="版本说明" subtitle="V0.0.3 发布版本">
          <div style={{ padding: "12px 14px", background: "var(--accent-bg)", borderRadius: "var(--r-sm)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--accent-ink)", fontWeight: 500, marginBottom: 8 }}>
              <I name="sparkle" size={11} stroke={1.5}/> V0.0.3
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink)", lineHeight: 1.7 }}>
              本版本聚焦 Skill 体系治理、Harness 架构设计和记忆系统升级,为 AriaAI 从项目助手向可控、可沉淀、可审计的项目 AI 工作台演进奠定架构基础。
            </p>
          </div>
        </CxPanel>

        <CxPanel title="技术栈" subtitle="当前版本主要依赖的核心技术">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["React", "TypeScript", "Vite", "Tailwind CSS", "FastAPI", "PostgreSQL", "SQLModel", "Claude API", "Moonshot AI"].map(t => (
              <span key={t} style={{ fontSize: 11.5, color: "var(--ink-soft)", padding: "3px 10px", border: "1px solid var(--line)", background: "var(--bg)", borderRadius: "var(--r-pill)" }}>{t}</span>
            ))}
          </div>
        </CxPanel>
      </div>

      {/* Migration status — merged from former Migrations tab */}
      <CxPanel title="数据库迁移状态" subtitle="只读 · 部署校验与数据库类失败排查"
        action={<a style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>刷新 →</a>}
        style={{ marginBottom: 22 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "color-mix(in oklch, var(--good) 8%, transparent)", border: "1px solid color-mix(in oklch, var(--good) 25%, transparent)", borderRadius: "var(--r-sm)", marginBottom: 14 }}>
          <I name="check" size={14} stroke={2} style={{ color: "var(--good)" }}/>
          <div>
            <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>迁移状态正常</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 1 }}>当前数据库由 Alembic 管理,且没有待执行迁移</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[
            ["模式",       "alembic", "ok"],
            ["当前版本",   "0a8f3c2", "neutral"],
            ["最新版本",   "0a8f3c2", "neutral"],
            ["待执行",     "0",      "ok"],
          ].map(([k, v, tone]) => (
            <div key={k} style={{ padding: "10px 12px", background: tone === "ok" ? "color-mix(in oklch, var(--good) 5%, transparent)" : "var(--bg-tint)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 10.5, color: "var(--ink-mute)" }}>{k}</div>
              <div className="num" style={{ fontSize: 14, color: "var(--ink)", marginTop: 4, fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>
      </CxPanel>

      {/* Quick links */}
      <CxPanel title="常用链接" subtitle="跳转到仓库、支持与反馈入口" style={{ marginBottom: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { t: "GitHub",   d: "查看代码仓库与版本历史",  icon: "file" },
            { t: "文档",     d: "查看产品说明与部署资料",  icon: "book" },
            { t: "邮件支持", d: "support@ariaai.com",       icon: "mail" },
            { t: "反馈建议", d: "提交问题与体验建议",      icon: "chat" },
          ].map(l => (
            <a key={l.t} className="row-hov" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)" }}>
              <I name={l.icon} size={13} stroke={1.5} style={{ color: "var(--accent)", flexShrink: 0 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{l.t}</div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.d}</div>
              </div>
              <I name="arrow-up-right" size={11} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
            </a>
          ))}
        </div>
      </CxPanel>

      <div style={{ paddingTop: 18, borderTop: "1px solid var(--line-soft)", fontSize: 11.5, color: "var(--ink-faint)", display: "flex", justifyContent: "space-between" }}>
        <span>Made with ♡ by AriaAI Team</span>
        <span>© 2026 AriaAI · 保留所有权利</span>
      </div>
    </>
  );
}

function CxAboutChangelog() {
  const entries = [
    { v: "0.0.3", date: "2026-05-28", latest: true, summary: "V0.0.3 发布:Skill 体系治理、Harness 架构与记忆系统升级", changes: [
      "Skill 体系评估与优化路线图 · 完成 48 个 Skill 全量评估",
      "Skill 编写规范 v1.0 · 强制目录结构、YAML 头部、9 章节模板",
      "Model + Harness 架构设计 · AI Run Harness,统一事件协议",
      "记忆系统从两层升级为四层 · 引入用户记忆和证据溯源机制",
      "审计与鉴证、税务与法律服务线加入 Skill 能力分类",
    ]},
    { v: "0.0.2", date: "2026-04-23", summary: "V0.0.2 发布:Skill、项目记忆、客户干系人与 PPT 交付体验升级", changes: [
      "数字化战略 Skill 强制使用模板生成 PPT,保留品牌视觉",
      "Skill 执行清单优化为可查看步骤日志,长任务支持后台恢复",
      "能力页新增「顾问基础能力」服务线",
      "项目/客户记忆和任务中心持续增强",
    ]},
    { v: "0.0.1", date: "2026-04-19", summary: "首个正式记录版本,统一产品版本显示", changes: [
      "Web 版本统一记录为 V0.0.1",
      "About 页面直接展示当前打包版本与发布时间",
      "为后端 health 接口补充 API version 返回值",
    ]},
  ];
  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <h3 className="ui" style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.01em" }}>更新日志</h3>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-mute)" }}>记录每个正式版本的重要变更。</p>
      </div>
      <div style={{ position: "relative", paddingLeft: 20 }}>
        <div style={{ position: "absolute", left: 5, top: 8, bottom: 8, width: 1, background: "var(--line)" }}/>
        {entries.map((e, i) => (
          <div key={e.v} style={{ position: "relative", marginBottom: 18 }}>
            <span style={{ position: "absolute", left: -20, top: 14, width: 11, height: 11, borderRadius: 99, background: i === 0 ? "var(--accent)" : "var(--bg-elev)", border: `1.5px solid ${i === 0 ? "var(--accent)" : "var(--line-strong)"}` }}/>
            <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span className="num" style={{ fontSize: 13, padding: "3px 10px", background: "var(--accent-bg)", color: "var(--accent-ink)", borderRadius: "var(--r-sm)", fontWeight: 500 }}>V{e.v}</span>
                <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{e.date}</span>
                {e.latest && <CxStatus tone="good">最新</CxStatus>}
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink)", lineHeight: 1.65 }}>{e.summary}</p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {e.changes.map((c, j) => (
                  <li key={j} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.55 }}>
                    <I name="chevron-right" size={11} stroke={1.6} style={{ color: "var(--accent)", marginTop: 3, flexShrink: 0 }}/>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function CxAboutLicense() {
  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <h3 className="ui" style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.01em" }}>许可说明</h3>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-mute)" }}>当前产品许可与第三方依赖许可概览。</p>
      </div>

      <CxPanel title="AriaAI 使用许可" style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.8 }}>
          <p style={{ margin: "0 0 10px" }}>Copyright © 2026 AriaAI · 保留所有权利。</p>
          <p style={{ margin: "0 0 10px" }}>本软件为专有软件与保密资产。未经授权,不得以任何形式复制、转让或分发。</p>
          <p style={{ margin: 0 }}>软件按「现状」提供,不附带任何明示或暗示担保,包括适销性、特定用途适用性及非侵权担保。</p>
        </div>
      </CxPanel>

      <h4 className="ui" style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "var(--ink-mute)" }}>第三方许可证</h4>
      {[
        { n: "React",        l: "MIT License" },
        { n: "Tailwind CSS", l: "MIT License" },
        { n: "Lucide Icons", l: "ISC License" },
        { n: "FastAPI",      l: "MIT License" },
      ].map((p, i, arr) => (
        <div key={p.n} style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", marginBottom: 6 }}>
          <span className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{p.n}</span>
          <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{p.l}</span>
        </div>
      ))}
    </>
  );
}

Object.assign(window, {
  CxSettingsShell, CxFormRow, CxInput, CxSwitch,
  CxSettingsProfile, CxSettingsLanguage, CxSettingsAI,
  CxSettingsProjMem, CxSettingsClientMem, CxSettingsMemOps,
  CxSettingsAPI, CxSettingsUsers, CxSettingsMigrations, CxSettingsServer, CxSettingsAbout,
});
