// direction-codex-more.jsx — Secondary pages
// NewProject · ClientDetail · SkillDetail · Welcome · NotFound · Contacts

/* ============================================================
   New Project — wizard with AI assist panel
   ============================================================ */
function CxNewProject() {
  return (
    <CxShell activeKey="projects">
      <div style={{ height: "100%", overflow: "hidden", padding: "28px 56px 40px", display: "grid", gridTemplateColumns: "1fr 340px", gap: 32, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8 }}>
              <a style={{ color: "var(--ink-faint)" }}>项目</a>
              <span style={{ margin: "0 6px", color: "var(--ink-faint)" }}>/</span>
              <span>新建</span>
            </div>
            <h1 className="ui" style={{ margin: 0, fontSize: 28, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>新建项目</h1>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--ink-mute)", lineHeight: 1.6, maxWidth: 540 }}>
              先填关键信息 — Aria 会自动生成项目记忆初稿、识别相关客户记忆、推荐适用的 Skill。
            </p>
          </div>

          {/* Steps indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            {[
              { n: "01", l: "基础信息", active: true },
              { n: "02", l: "客户与阶段" },
              { n: "03", l: "团队成员" },
              { n: "04", l: "确认" },
            ].map((s, i, arr) => (
              <React.Fragment key={s.n}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: s.active ? "var(--ink)" : "var(--ink-mute)" }}>
                  <span className="num" style={{ width: 22, height: 22, borderRadius: 99, background: s.active ? "var(--accent)" : "transparent", color: s.active ? "var(--bg-elev)" : "var(--ink-mute)", border: s.active ? "none" : "1px solid var(--line-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 500 }}>{s.n}</span>
                  {s.l}
                </div>
                {i < arr.length - 1 && <div style={{ flex: 1, height: 1, background: "var(--line)" }}/>}
              </React.Fragment>
            ))}
          </div>

          {/* Form panels */}
          <CxPanel title="基础信息">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 5 }}>项目名称 *</label>
                <input defaultValue="鼎和保险 · 数字化转型咨询" className="codex-input" style={{ width: "100%", padding: "8px 12px", fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}/>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 5 }}>项目编号</label>
                <input defaultValue="DH-2026-001" className="codex-input num" style={{ width: "100%", padding: "8px 12px", fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}/>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 5 }}>项目简述 · 一句话</label>
                <textarea rows={2} defaultValue="围绕续保与理赔两个高频场景搭建数据闭环,Q3 完成首批试点。" className="codex-input" style={{ width: "100%", padding: "8px 12px", fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", resize: "none", fontFamily: "var(--font-ui)" }}/>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 5 }}>预估金额</label>
                <input defaultValue="¥280 万" className="codex-input num" style={{ width: "100%", padding: "8px 12px", fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}/>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 5 }}>预计签约</label>
                <input defaultValue="2026-08-31" className="codex-input num" style={{ width: "100%", padding: "8px 12px", fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}/>
              </div>
            </div>
          </CxPanel>

          <CxPanel title="客户与阶段">
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 5 }}>关联客户 *</label>
                <div style={{ padding: "8px 12px", border: "1px solid var(--accent)", borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent-ink)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>● 鼎和保险股份有限公司 (CL-001)</span>
                  <button style={{ fontSize: 11, color: "var(--accent)" }}>更换</button>
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  <I name="sparkle" size={10} stroke={1.5} style={{ color: "var(--accent)" }}/>
                  Aria 找到了客户记忆 v8 · 包含 5 个关键联系人和 3 个偏好,新建后会自动带入项目
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--ink-soft)", display: "block", marginBottom: 5 }}>项目阶段</label>
                <select className="codex-input" defaultValue="opportunity" style={{ width: "100%", padding: "8px 12px", fontSize: 13, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", appearance: "none" }}>
                  <option value="lead">未洽谈</option>
                  <option value="opportunity">机会期</option>
                  <option value="delivering">交付中</option>
                  <option value="won">已签约</option>
                </select>
              </div>
            </div>
          </CxPanel>

          <CxPanel title="项目团队">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { n: "陈悦", r: "项目经理", owner: true },
                { n: "林宥", r: "解决方案" },
                { n: "苏明", r: "数据顾问" },
              ].map(p => (
                <div key={p.n} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)" }}>
                  <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}>{p.n[0]}</span>
                  <div style={{ flex: 1 }}>
                    <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{p.n}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{p.r}</div>
                  </div>
                  {p.owner && <CxStatus tone="accent">负责人</CxStatus>}
                  <button style={{ color: "var(--ink-faint)", fontSize: 12 }}>×</button>
                </div>
              ))}
              <button style={{ padding: "8px 12px", fontSize: 12.5, color: "var(--ink-mute)", border: "1px dashed var(--line-strong)", borderRadius: "var(--r-sm)" }}>+ 添加成员</button>
            </div>
          </CxPanel>

          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8 }}>
            <button style={{ padding: "9px 16px", fontSize: 13, color: "var(--ink-mute)" }}>取消</button>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ padding: "9px 16px", fontSize: 13, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>保存为草稿</button>
              <button style={{ padding: "9px 18px", fontSize: 13, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}>
                创建项目 <I name="arrow-right" size={11} stroke={1.8}/>
              </button>
            </div>
          </div>
        </div>

        {/* AI Assist panel */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 24, height: 24, borderRadius: "var(--r-sm)", background: "var(--accent)", color: "var(--bg-elev)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><I name="sparkle" size={12} stroke={1.5}/></span>
              <h3 className="ui" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>Aria 协助</h3>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.65 }}>
              已识别客户 <strong style={{ color: "var(--accent-ink)" }}>鼎和保险</strong>,正在生成:
            </p>
            <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.85 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <I name="check" size={11} stroke={2} style={{ color: "var(--good)" }}/>
                <span>项目记忆初稿 (基于客户记忆 v8)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <I name="check" size={11} stroke={2} style={{ color: "var(--good)" }}/>
                <span>找到 3 个相关 Skill 推荐</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <CxStatus tone="accent" pulse>···</CxStatus>
                <span>正在汇总过往相似项目经验</span>
              </div>
            </div>
          </div>

          <CxPanel title="推荐 Skill" subtitle="根据客户行业 + 项目阶段">
            {[
              { t: "数字化战略分析", desc: "保险/金融行业首选", n: "27 次" },
              { t: "会前简报",       desc: "机会期项目必备",   n: "23 次" },
              { t: "RFP 拆解",       desc: "如客户后续发布 RFP", n: "18 次" },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i === 2 ? "none" : "1px solid var(--line-soft)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500 }}>{s.t}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>{s.desc} · {s.n}</div>
                </div>
                <button style={{ fontSize: 11, color: "var(--accent)", padding: "2px 8px", border: "1px solid var(--accent-bg)", background: "var(--accent-bg)", borderRadius: "var(--r-sm)", height: 22 }}>+ 关联</button>
              </div>
            ))}
          </CxPanel>

          <CxPanel title="相似项目" subtitle="供参考决策">
            {[
              { t: "申通快运 · 中台升级", note: "保险数据治理参考" },
              { t: "金辉医疗 · 知识库迁移", note: "类似数据闭环案例" },
            ].map((p, i) => (
              <a key={i} className="row-hov" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 8px", margin: "0 -8px", borderRadius: "var(--r-sm)", fontSize: 12 }}>
                <div>
                  <div className="ui" style={{ color: "var(--ink)" }}>{p.t}</div>
                  <div style={{ color: "var(--ink-mute)", fontSize: 11, marginTop: 1 }}>{p.note}</div>
                </div>
                <I name="arrow-up-right" size={11} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
              </a>
            ))}
          </CxPanel>
        </aside>
      </div>
    </CxShell>
  );
}

/* ============================================================
   Client Detail
   ============================================================ */
function CxClientDetail() {
  return (
    <CxShell activeKey="clients">
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" }}>
        {/* Hero */}
        <div style={{ padding: "22px 40px 0", flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 10 }}>
            <a style={{ color: "var(--ink-faint)" }}>客户</a>
            <span style={{ margin: "0 6px", color: "var(--ink-faint)" }}>/</span>
            <span>鼎和保险</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
            <div style={{ display: "flex", gap: 16, minWidth: 0 }}>
              <span style={{ width: 56, height: 56, borderRadius: "var(--r-md)", background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 500, flexShrink: 0 }}>鼎</span>
              <div style={{ minWidth: 0 }}>
                <h1 className="ui" style={{ margin: 0, fontSize: 24, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>鼎和保险股份有限公司</h1>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, fontSize: 12, color: "var(--ink-mute)" }}>
                  <span>保险 · 财产险</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                  <span>深圳</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                  <span>3 万员工</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                  <CxStatus tone="good">活跃 · 2 天前联系</CxStatus>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "7px 12px", fontSize: 12.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>编辑客户档案</button>
              <button style={{ padding: "7px 14px", fontSize: 12.5, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)" }}>+ 新建项目</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ padding: "0 40px", marginTop: 16, borderBottom: "1px solid var(--line)", display: "flex", flexShrink: 0 }}>
          {[
            { k: "overview", l: "概览", active: true },
            { k: "memory", l: "客户记忆" },
            { k: "contacts", l: "联系人" },
            { k: "projects", l: "项目" },
            { k: "history", l: "互动历史" },
          ].map(t => (
            <a key={t.k} style={{ padding: "10px 12px", fontSize: 13, color: t.active ? "var(--ink)" : "var(--ink-mute)", fontWeight: t.active ? 500 : 400, borderBottom: t.active ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1 }}>
              {t.l}
            </a>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", padding: "22px 40px 32px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", padding: "16px 0", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
              {[
                { l: "进行中项目", v: "3" },
                { l: "签约项目",   v: "1" },
                { l: "累计金额",   v: "¥420万" },
                { l: "关联联系人", v: "5" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "0 20px", borderLeft: i > 0 ? "1px solid var(--line-soft)" : "none" }}>
                  <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 5 }}>{s.l}</div>
                  <span className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500 }}>{s.v}</span>
                </div>
              ))}
            </div>

            <CxPanel title="客户记忆摘要" subtitle="v8 · 2 天前由 Aria 自动汇总" action={<a style={{ fontSize: 11.5, color: "var(--accent)" }}>查看完整 →</a>}>
              {[
                ["组织结构", "总公司位于深圳,5 个区域分公司。技术、业务、风控三大板块并行。"],
                ["关键人物", "CTO 王浩 · COO 张丽 · 数字化办公室主任 王凯 · CFO 李远。"],
                ["合作历史", "2024 年起合作,已完成 1 个 IT 咨询项目。整体满意度评分 4.6/5。"],
                ["决策偏好", "倾向先做小范围验证,谨慎推进;关注合规、风控与业务连续性。"],
                ["关注议题", "数字化转型 · 续保业务增长 · 数据治理 · AI 应用试点。"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "90px 1fr", padding: "10px 0", borderBottom: "1px solid var(--line-soft)", gap: 20, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 12, color: "var(--ink-mute)" }}>{k}</div>
                  <div style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.65 }}>{v}</div>
                </div>
              ))}
            </CxPanel>

            <CxPanel title="进行中项目" action={<a style={{ fontSize: 11.5, color: "var(--accent)" }}>全部 →</a>}>
              {[
                { t: "鼎和保险 · 数字化转型咨询", s: "机会期", amount: "¥280万", date: "2026-08 预计签约", tone: "warn" },
                { t: "续保业务 POC 试点",        s: "评估中", amount: "—",       date: "Q3 启动",      tone: "neutral" },
                { t: "知识库迁移调研",            s: "立项中", amount: "—",       date: "待定",         tone: "mute" },
              ].map((p, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 100px 120px 14px", padding: "12px 0", gap: 14, alignItems: "center", borderBottom: i === 2 ? "none" : "1px solid var(--line-soft)" }}>
                  <div className="ui" style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500 }}>{p.t}</div>
                  <CxStatus tone={p.tone}>{p.s}</CxStatus>
                  <span className="num" style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{p.amount}</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>{p.date}</span>
                  <I name="arrow-right" size={12} stroke={1.5} style={{ color: "var(--ink-faint)" }}/>
                </div>
              ))}
            </CxPanel>
          </div>

          <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <CxPanel title="关键联系人">
              {[
                { n: "王浩", r: "CTO", phone: "已记录" },
                { n: "张丽", r: "COO", phone: "已记录" },
                { n: "王凯", r: "数字化办公室主任", phone: "已记录" },
                { n: "李远", r: "CFO", phone: "未记录" },
                { n: "张博", r: "续保业务负责人", phone: "已记录" },
              ].map(c => (
                <div key={c.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                  <span style={{ width: 26, height: 26, borderRadius: 99, background: "var(--bg-tint)", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 500 }}>{c.n[0]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)" }}>{c.n}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{c.r}</div>
                  </div>
                  <span style={{ fontSize: 10.5, color: c.phone === "已记录" ? "var(--good)" : "var(--ink-faint)" }}>{c.phone}</span>
                </div>
              ))}
            </CxPanel>

            <CxPanel title="最近互动">
              <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.85 }}>
                <div><span style={{ color: "var(--ink-mute)", marginRight: 6 }}>2 天前</span>陈悦 · 项目例会</div>
                <div><span style={{ color: "var(--ink-mute)", marginRight: 6 }}>1 周前</span>林宥 · 数据治理沟通</div>
                <div><span style={{ color: "var(--ink-mute)", marginRight: 6 }}>2 周前</span>陈悦 · 方案 V1 提交</div>
                <div><span style={{ color: "var(--ink-mute)", marginRight: 6 }}>3 周前</span>客户主动来电 · 沟通续保问题</div>
              </div>
            </CxPanel>
          </aside>
        </div>
      </div>
    </CxShell>
  );
}

Object.assign(window, { CxNewProject, CxClientDetail });
