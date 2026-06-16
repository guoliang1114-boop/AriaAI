// direction-codex-project-2.jsx — Briefing + Memory + Anchors tabs

/* ============================================================
   2) Briefing — 30-second meeting card
   ============================================================ */
function CxProjectBriefing() {
  return (
    <CxProjectShell activeTab="briefing">
      <div style={{ height: "100%", overflow: "hidden", padding: "24px 40px 32px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 20, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {/* Meeting card header */}
          <div style={{ background: "linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "20px 24px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 6 }}>下次例会 · 6 月 3 日 周三 14:00 · 与 鼎和保险 数字化办公室</div>
                <h2 className="ui" style={{ margin: 0, fontSize: 22, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>30 秒会前卡</h2>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-soft)" }}>打开就看四件事 — 说什么、避开什么、确认什么、过去的教训</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ padding: "7px 12px", fontSize: 12.5, color: "var(--ink-soft)", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}>
                  <I name="sparkle" size={12} stroke={1.5}/> 生成话术
                </button>
                <button style={{ padding: "7px 12px", fontSize: 12.5, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}>
                  <I name="chat" size={12} stroke={1.5}/> 去对话准备
                </button>
              </div>
            </div>
          </div>

          {/* Four cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              {
                title: "建议说什么",
                en: "Say",
                tone: "good",
                items: [
                  "聚焦续保数据闭环的 Q3 试点目标:从 38% 提到 50% 转化率",
                  "提出我方建议的 4+2 组织架构:4 名核心 + 2 名顾问",
                  "用最近一次理赔体验访谈数据,说明数据闭环的紧迫性",
                ],
              },
              {
                title: "尽量避开",
                en: "Avoid",
                tone: "warn",
                items: [
                  "理赔系统改造的具体技术方案(客户内部尚未对齐)",
                  "明确报价 — 待方案 V2 评审后再谈",
                  "组织变革的人员调整细节",
                ],
              },
              {
                title: "需要确认",
                en: "Confirm",
                tone: "neutral",
                items: [
                  "客户能否在 6 月前提供过去 12 个月的脱敏续保数据",
                  "POC 评估的成功标准与时间节点",
                  "组织变革方案是否需要董事会层面背书",
                ],
              },
              {
                title: "历史经验",
                en: "Lessons",
                tone: "info",
                items: [
                  "同行业类似项目:数据治理通常需要预留 2-3 个月清洗期",
                  "鼎和过往合作:CTO 王浩偏好先做小范围验证再扩展",
                  "保险行业数字化:监管报告口径需要在方案设计时就考虑",
                ],
              },
            ].map((card) => {
              const toneColor = {
                good: "var(--good)", warn: "var(--warn)", neutral: "var(--ink-soft)", info: "var(--info)",
              }[card.tone];
              return (
                <section key={card.title} style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: toneColor }}/>
                    <h3 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{card.title}</h3>
                    <span style={{ fontSize: 11, color: "var(--ink-faint)", marginLeft: 4 }}>{card.en}</span>
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                    {card.items.map((item, i) => (
                      <li key={i} style={{ display: "flex", gap: 10, fontSize: 13, color: "var(--ink)", lineHeight: 1.6 }}>
                        <span className="num" style={{ fontSize: 11, color: toneColor, paddingTop: 2, fontWeight: 600 }}>{String(i + 1).padStart(2, "0")}</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          {/* AI script */}
          <CxPanel
            title="开场话术(AI 生成)"
            subtitle="基于上面四张卡片自动生成 · 可直接复制使用"
            action={<button style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}><I name="sparkle" size={11} stroke={1.5}/> 重新生成</button>}
          >
            <div style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.8, background: "var(--bg-tint)", padding: "14px 16px", borderRadius: "var(--r-sm)" }}>
              <p style={{ margin: "0 0 12px" }}>
                "<strong style={{ color: "var(--accent-ink)" }}>王总、张总</strong>,今天我们想花 30 分钟,跟两位同步一下 Q3 续保数据闭环试点的整体推进思路,顺便确认几个关键节点 ——"
              </p>
              <p style={{ margin: "0 0 12px" }}>
                "<strong>首先</strong>,我们对续保业务做了一轮深度访谈,发现现在转化率 38% 的痛点主要集中在 30 天关键触达窗口缺数据。我们想先用一个轻量化的数据闭环 POC,把这个窗口的转化率提到 50%……"
              </p>
              <p style={{ margin: 0, color: "var(--ink-mute)" }}>
                "<strong>接下来想跟两位确认</strong>:6 月之前我们能否拿到过去 12 个月的脱敏续保数据?以及 POC 评估的成功标准,大家觉得应该看哪些指标?<span className="cursor-blink"/>"
              </p>
            </div>
          </CxPanel>
        </div>

        {/* Side */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CxPanel title="关键干系人" subtitle="到场预测">
            {[
              { n: "王浩", r: "CTO", note: "决策 · 偏好小范围验证", attend: true },
              { n: "张丽", r: "COO", note: "决策 · 业务背书", attend: true },
              { n: "王凯", r: "数字化办公室", note: "影响 · 推动", attend: true },
              { n: "李远", r: "财务总监", note: "可能列席", attend: false },
            ].map(p => (
              <div key={p.n} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line-soft)" }}>
                <span style={{ width: 28, height: 28, borderRadius: 99, background: p.attend ? "var(--accent-bg)" : "var(--bg-tint)", color: p.attend ? "var(--accent-ink)" : "var(--ink-mute)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>{p.n[0]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{p.n}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>· {p.r}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>{p.note}</div>
                </div>
                {p.attend ? <CxStatus tone="good">到场</CxStatus> : <CxStatus tone="mute">可能</CxStatus>}
              </div>
            ))}
          </CxPanel>

          <CxPanel title="近期节奏">
            {[
              { d: "6/03", t: "客户例会", note: "本次准备", hi: true },
              { d: "6/05", t: "POC 启动评审", note: "里程碑" },
              { d: "6/10", t: "提案 V2 内部对齐", note: "团队" },
              { d: "6/17", t: "客户中期复盘", note: "建议" },
            ].map(m => (
              <div key={m.d + m.t} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                <span className="num" style={{ fontSize: 11.5, color: m.hi ? "var(--accent)" : "var(--ink-mute)", paddingTop: 1, minWidth: 32 }}>{m.d}</span>
                <div style={{ flex: 1 }}>
                  <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: m.hi ? 500 : 400 }}>{m.t}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>{m.note}</div>
                </div>
                {m.hi && <CxStatus tone="accent" pulse>下次</CxStatus>}
              </div>
            ))}
          </CxPanel>

          <CxPanel title="资料依据" subtitle="本次卡片来源">
            {[
              { l: "项目记忆 v12", n: "5 个片段", src: "memory" },
              { l: "续保访谈纪要",  n: "2 次访谈", src: "doc" },
              { l: "上次例会纪要",  n: "1 篇",     src: "memory" },
              { l: "客户记忆",      n: "3 个偏好", src: "client" },
            ].map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: i === 3 ? "none" : "1px solid var(--line-soft)" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                  <I name={d.src === "memory" ? "sparkle" : d.src === "doc" ? "file" : "user"} size={12} stroke={1.5} style={{ color: "var(--accent)", flexShrink: 0 }}/>
                  <span style={{ fontSize: 12.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.l}</span>
                </div>
                <span style={{ fontSize: 11, color: "var(--ink-mute)", flexShrink: 0 }}>{d.n}</span>
              </div>
            ))}
          </CxPanel>
        </aside>
      </div>
    </CxProjectShell>
  );
}

/* ============================================================
   3) Memory — structured editable project memory
   ============================================================ */
function CxProjectMemory() {
  return (
    <CxProjectShell activeTab="memory">
      <div style={{ height: "100%", overflow: "hidden", padding: "24px 40px 32px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {/* Memory header strip */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div>
                <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>项目记忆 v12</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>陈悦 在 2 小时前更新 · 由 11 次对话 + 12 份文档汇总</div>
              </div>
              <CxStatus tone="good">已同步</CxStatus>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "6px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>历史版本</button>
              <button style={{ padding: "6px 12px", fontSize: 12, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>对比 v11</button>
              <button style={{ padding: "6px 12px", fontSize: 12, color: "var(--bg-elev)", background: "var(--accent)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 5 }}>
                <I name="sparkle" size={11} stroke={1.5}/> 重新汇总
              </button>
            </div>
          </div>

          {/* Pinned Anchors (merged from former Anchors tab) */}
          <div style={{ background: "linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--accent)", fontSize: 13 }}>★</span>
                <h3 className="ui" style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>固定锚点 · 6 项</h3>
                <span style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>会优先参与 AI 总结、风险判断与会前简报</span>
              </div>
              <button style={{ fontSize: 11.5, color: "var(--accent)" }}>+ 添加</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              {[
                {
                  title: "风险锚点",
                  tone: "bad",
                  items: [
                    "理赔系统改造涉及核心交易",
                    "数据治理委员会未成立",
                    "脱敏方案需法务评审",
                  ],
                },
                {
                  title: "待确认问题",
                  tone: "warn",
                  items: [
                    "6 月前能否提供脱敏续保数据?",
                    "POC 评估的成功标准?",
                  ],
                },
                {
                  title: "干系人提示",
                  tone: "info",
                  items: [
                    "王浩偏好先做小范围验证",
                  ],
                },
              ].map(g => {
                const c = { bad: "var(--bad)", warn: "var(--warn)", info: "var(--info)" }[g.tone];
                return (
                  <div key={g.title}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                      <span style={{ width: 5, height: 5, borderRadius: 99, background: c }}/>
                      <span style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 500 }}>{g.title}</span>
                      <span className="num" style={{ fontSize: 10.5, color: c, fontWeight: 500, marginLeft: "auto" }}>{g.items.length}</span>
                    </div>
                    {g.items.map((t, i) => (
                      <div key={i} style={{ display: "flex", gap: 7, padding: "4px 0", alignItems: "flex-start" }}>
                        <span style={{ width: 3, height: 3, marginTop: 7, borderRadius: 99, background: c, flexShrink: 0 }}/>
                        <span style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.55 }}>{t}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
            <span style={{ fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>结构化记忆</span>
            <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }}/>
          </div>
          {[
            {
              title: "客户背景 · Client Background",
              icon: "building",
              body: "鼎和保险股份有限公司,深圳总部,3 万员工。主要业务覆盖财产险、车险、责任险三大类。2025 年总保费收入 480 亿,在区域市场排名前 5。已有完整核心系统,但分布在 5 个独立架构中。",
              sources: ["2026-05-22 战略对齐会", "2026-05-15 续保业务访谈"],
            },
            {
              title: "核心痛点 · Pain Points",
              icon: "target",
              body: "续保转化下滑 — 当前 38%,行业平均 52%。理赔体验差 — NPS 评分 4.2(满分 10)。数据散落 — 客户、保单、理赔、收付分别在 5 个独立核心系统中,业务方查询需在多个系统跳转,日均报表准备时间约 4 小时。",
              sources: ["2026-05-15 续保访谈", "2026-05-08 数据治理评估"],
            },
            {
              title: "我方方案 · Our Proposal",
              icon: "sparkle",
              body: "三层框架:业务层(续保 + 理赔数据闭环)、技术层(轻量中台 + AI 推理层)、组织层(4 + 2 转型办公室)。先做续保数据闭环 POC,Q3 W1 交付评估报告。",
              sources: ["项目记忆 v10", "方案 V1"],
            },
            {
              title: "决策链 · Decision Chain",
              icon: "user",
              body: "技术拍板 — CTO 王浩(影响 90%);业务背书 — COO 张丽(影响 70%);推动执行 — 数字化办公室 王凯;财务审批 — CFO 李远(可能列席)。",
              sources: ["客户记忆 · 决策结构", "2026-05-22 会议"],
            },
            {
              title: "下一步 · Next Steps",
              icon: "arrow-right",
              body: "Q3 W1(6/30 前)交付 POC 评估报告;Q3 W3(7/14 前)提交方案 V2 修订版;Q3 W6 启动数据治理实施(条件:客户提供过去 12 个月脱敏数据)。",
              sources: ["项目里程碑"],
            },
          ].map((s, i) => (
            <section key={i} style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><I name={s.icon} size={13} stroke={1.5}/></span>
                  <h3 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{s.title}</h3>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button style={{ fontSize: 11.5, color: "var(--ink-mute)", padding: "4px 8px" }}>编辑</button>
                  <button style={{ fontSize: 11.5, color: "var(--accent)", padding: "4px 8px" }}>固定 ★</button>
                </div>
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 13.5, color: "var(--ink)", lineHeight: 1.75 }}>{s.body}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 10, borderTop: "1px solid var(--line-soft)" }}>
                <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>依据:</span>
                {s.sources.map(src => (
                  <span key={src} style={{ fontSize: 11.5, color: "var(--accent)", padding: "1px 6px", background: "var(--accent-bg)", borderRadius: "var(--r-sm)" }}>{src}</span>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CxPanel title="记忆健康度">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 4 }}>完整度</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                  <span className="num" style={{ fontSize: 22, color: "var(--ink)", fontWeight: 500 }}>92</span>
                  <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>/ 100</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-mute)", marginBottom: 4 }}>新鲜度</div>
                <CxStatus tone="good">2h ago</CxStatus>
              </div>
            </div>
            <div style={{ paddingTop: 10, borderTop: "1px solid var(--line-soft)", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>已填写槽位</span><span className="num">11 / 12</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>有引用依据</span><span className="num" style={{ color: "var(--good)" }}>10 / 11</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span>需复查</span><span className="num" style={{ color: "var(--warn)" }}>1</span></div>
            </div>
          </CxPanel>

          <CxPanel title="自动更新建议">
            {[
              { t: "更新「核心痛点」", note: "续保访谈 V3 已上传 · 应纳入", action: "应用" },
              { t: "补充「竞品对比」",  note: "槽位空缺 · 建议从行业资料生成", action: "生成" },
              { t: "刷新「下一步」",   note: "里程碑已变更",         action: "应用" },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i === 2 ? "none" : "1px solid var(--line-soft)" }}>
                <span style={{ width: 5, marginTop: 4, height: 5, borderRadius: 99, background: "var(--accent)", flexShrink: 0 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500 }}>{s.t}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>{s.note}</div>
                </div>
                <button style={{ fontSize: 11, color: "var(--accent)", padding: "2px 8px", border: "1px solid var(--accent-bg)", background: "var(--accent-bg)", borderRadius: "var(--r-sm)", height: 22, flexShrink: 0 }}>{s.action}</button>
              </div>
            ))}
          </CxPanel>

          <CxPanel title="版本历史" action={<a style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>全部 →</a>}>
            {[
              { v: "v12", w: "陈悦",  d: "2h ago",  c: "调整核心痛点表述", curr: true },
              { v: "v11", w: "Aria",  d: "y'day",   c: "新增 7 条记忆片段" },
              { v: "v10", w: "陈悦",  d: "3 days",  c: "整理决策链" },
            ].map(v => (
              <div key={v.v} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--line-soft)" }}>
                <span className="num" style={{ fontSize: 11.5, color: v.curr ? "var(--accent)" : "var(--ink-mute)", fontWeight: 500, minWidth: 28 }}>{v.v}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink)" }}>{v.c}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 1 }}>{v.w} · {v.d}</div>
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
   4) Anchors — pinned items: Risks / Questions / Stakeholder notes
   ============================================================ */
function CxProjectAnchors() {
  const groups = [
    {
      title: "风险锚点",
      en: "Risk Anchors",
      desc: "长期需要盯住的风险判断",
      tone: "bad",
      items: [
        { t: "理赔系统改造涉及核心交易,改造期间需保证业务连续性", added: "陈悦 · 5 天前" },
        { t: "客户内部数据治理委员会尚未成立,可能影响 POC 推进", added: "Aria · 2 天前" },
        { t: "续保数据脱敏方案需要法务先评审", added: "苏明 · 昨天" },
      ],
    },
    {
      title: "待确认问题",
      en: "Open Questions",
      desc: "会影响推进的未决事项",
      tone: "warn",
      items: [
        { t: "客户能否在 6 月前提供过去 12 个月脱敏续保数据?", added: "陈悦 · 5 天前" },
        { t: "POC 评估的成功标准与时间节点如何定义?", added: "Aria · 3 天前" },
        { t: "组织变革方案是否需要董事会层面背书?", added: "林宥 · 2 天前" },
        { t: "理赔体验改造是否纳入本期范围?", added: "陈悦 · 昨天" },
      ],
    },
    {
      title: "干系人提示",
      en: "Stakeholder Notes",
      desc: "沟通偏好、敏感点和跟进提醒",
      tone: "info",
      items: [
        { t: "CTO 王浩 — 偏好先做小范围验证再扩展,不喜欢一次性大方案", added: "Aria · 1 周前" },
        { t: "COO 张丽 — 关注业务 KPI 而非技术细节,会前先准备数字", added: "陈悦 · 6 天前" },
        { t: "王凯 — 数字化办公室是协调方,需要明确给到执行清单", added: "Aria · 4 天前" },
      ],
    },
  ];
  return (
    <CxProjectShell activeTab="anchors">
      <div style={{ height: "100%", overflow: "hidden", padding: "24px 40px 32px", minWidth: 0 }}>
        {/* Top strip */}
        <div style={{ background: "linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-elev) 100%)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "18px 22px", marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
            <div>
              <h2 className="ui" style={{ margin: 0, fontSize: 18, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.015em" }}>项目锚点 · {groups.reduce((s, g) => s + g.items.length, 0)} 项</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.6, maxWidth: 720 }}>
                固定下来的关键内容会优先参与 AI 总结、风险判断和会前简报生成。建议固定 5-15 项,过多反而稀释优先级。
              </p>
            </div>
            <button style={{ padding: "7px 14px", fontSize: 12.5, background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 6 }}>
              <I name="plus" size={12} stroke={1.6}/> 添加锚点
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          {groups.map(g => {
            const toneColor = { bad: "var(--bad)", warn: "var(--warn)", info: "var(--info)" }[g.tone];
            return (
              <section key={g.title} style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 99, background: toneColor }}/>
                      <h3 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{g.title}</h3>
                    </div>
                    <p style={{ margin: "3px 0 0 15px", fontSize: 11.5, color: "var(--ink-mute)" }}>{g.desc}</p>
                  </div>
                  <span className="num" style={{ fontSize: 11.5, color: toneColor, fontWeight: 500, padding: "2px 8px", background: "color-mix(in oklch, " + toneColor + " 12%, transparent)", borderRadius: "var(--r-sm)" }}>{g.items.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 4 }}>
                  {g.items.map((item, i) => (
                    <div key={i} className="row-hov" style={{ padding: "10px 8px", margin: "0 -8px", borderRadius: "var(--r-sm)", display: "flex", gap: 10 }}>
                      <span style={{ width: 5, height: 5, marginTop: 6, borderRadius: 99, background: toneColor, flexShrink: 0 }}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="ui" style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.55 }}>{item.t}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 3 }}>{item.added}</div>
                      </div>
                      <button style={{ color: "var(--ink-faint)", opacity: 0.6, fontSize: 11, marginTop: 2 }}>★</button>
                    </div>
                  ))}
                </div>
                <button style={{ padding: "7px 0", fontSize: 12, color: "var(--ink-mute)", border: "1px dashed var(--line-strong)", borderRadius: "var(--r-sm)", marginTop: 6 }}>+ 添加</button>
              </section>
            );
          })}
        </div>

        {/* Client-side stakeholder analysis */}
        <CxPanel
          title="客户侧干系人分析"
          subtitle="结合客户记忆 + 项目锚点的综合视图"
          style={{ marginTop: 22 }}
          action={<a style={{ fontSize: 11.5, color: "var(--accent)" }}>到客户空间补齐 →</a>}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div style={{ padding: "12px 14px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>关联客户</div>
              <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500, marginTop: 4 }}>鼎和保险股份有限公司</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 4 }}>已链接 · 客户记忆 v8</div>
            </div>
            <div style={{ padding: "12px 14px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>客户联系人线索</div>
              <div className="num" style={{ fontSize: 24, color: "var(--ink)", fontWeight: 500, marginTop: 2 }}>5</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2 }}>来自客户记忆关键联系人</div>
            </div>
            <div style={{ padding: "12px 14px", background: "var(--bg-tint)", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 11, color: "var(--ink-mute)" }}>建议动作</div>
              <div style={{ fontSize: 13, color: "var(--ink)", marginTop: 4, lineHeight: 1.55, display: "flex", alignItems: "flex-start", gap: 6 }}>
                <I name="sparkle" size={12} stroke={1.5} style={{ color: "var(--accent)", marginTop: 2, flexShrink: 0 }}/>
                <span>围绕 CTO 王浩与 COO 张丽的偏好,安排下一次例会的话题顺序</span>
              </div>
            </div>
          </div>
        </CxPanel>
      </div>
    </CxProjectShell>
  );
}

Object.assign(window, { CxProjectBriefing, CxProjectMemory, CxProjectAnchors });
