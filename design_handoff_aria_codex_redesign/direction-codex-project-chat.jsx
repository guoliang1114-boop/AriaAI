// direction-codex-project-chat.jsx — Rich Project Chat (the page the user lives in)
// 3-column layout: conversation rail · thread · context panel
// Featuring: tool call cards, plan cards, artifact cards, action previews,
// memory quick bar, anchors, citations

function CxProjectChat() {
  return (
    <CxProjectShell activeTab="chat">
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr", minHeight: 0, overflow: "hidden" }}>
        {/* ============= LEFT: Switchable rail (Conversations / Space) ============= */}
        <CxProjectChatLeftRail />

        {/* ============= CENTER: Thread ============= */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Thread title strip */}
          <div style={{ padding: "12px 28px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 className="ui" style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>数字化转型框架草稿</h2>
                <button style={{ color: "var(--accent)", fontSize: 12 }}>★</button>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2, display: "flex", alignItems: "center", gap: 10 }}>
                <span>gpt-5</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>12 条消息</span><span style={{ color: "var(--ink-faint)" }}>·</span>
                <span>本会话花费 ¥0.42</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>沉淀到记忆</button>
              <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>导出</button>
              <button style={{ padding: "5px 8px", color: "var(--ink-mute)" }}><I name="more" size={14} stroke={1.5}/></button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflow: "hidden", padding: "20px 28px 12px", display: "flex", flexDirection: "column", gap: 24 }}>
            {/* User message */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--bg-tint)", color: "var(--ink-soft)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>陈</span>
              <div style={{ flex: 1, paddingTop: 3 }}>
                <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 4 }}>陈悦 · 14:32</div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "var(--ink)" }}>
                  帮我把战略拆成三层框架,引用最近三次会议纪要,并提示风险点。
                </p>
              </div>
            </div>

            {/* Aria message — with tool call card + plan card + answer */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={{ width: 28, height: 28, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <I name="sparkle" size={13} stroke={1.5}/>
              </span>
              <div style={{ flex: 1, paddingTop: 3, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--accent-ink)", fontWeight: 500 }}>Aria</span>
                  <span>14:32 · gpt-5</span>
                  <CxStatus tone="accent">数字化战略分析</CxStatus>
                </div>

                {/* Tool call card — collapsible */}
                <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: "9px 12px", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <I name="check" size={11} stroke={2} style={{ color: "var(--good)" }}/>
                    <span style={{ fontSize: 12, color: "var(--ink-soft)", fontWeight: 500 }}>检索了 3 个数据源 · 1.01s</span>
                    <button style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-mute)" }}>展开 ▾</button>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-mute)", lineHeight: 1.7, paddingLeft: 18 }}>
                    项目记忆「续保」7 条 · 项目记忆「理赔」5 条 · 文档 DOC-0042、DOC-0091
                  </div>
                </div>

                {/* Plan card */}
                <div style={{ background: "color-mix(in oklch, var(--accent-bg) 60%, var(--bg-elev))", border: "1px solid color-mix(in oklch, var(--accent) 25%, var(--line))", borderRadius: "var(--r-sm)", padding: "12px 14px", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 99, background: "var(--accent)" }}/>
                    <span className="ui" style={{ fontSize: 12, fontWeight: 600, color: "var(--accent-ink)" }}>计划</span>
                    <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>· 4 步</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "var(--ink)", lineHeight: 1.5 }}>
                    {[
                      ["check", "good",    "归纳客户痛点和决策结构"],
                      ["check", "good",    "梳理三层战略框架结构"],
                      ["dot",   "accent",  "对每一层标注关键风险点 · 进行中"],
                      ["dot",   "mute",    "生成可继续追问的会话"],
                    ].map(([icon, tone, text], i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        {icon === "check"
                          ? <I name="check" size={11} stroke={2} style={{ color: tone === "good" ? "var(--good)" : "var(--ink-faint)", marginTop: 3 }}/>
                          : <span style={{ width: 6, height: 6, borderRadius: 99, marginTop: 5, background: tone === "accent" ? "var(--accent)" : "var(--ink-faint)" }}/>
                        }
                        <span style={{ color: tone === "good" ? "var(--ink-mute)" : "var(--ink)" }}>{text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.75, color: "var(--ink)" }}>
                  我把战略分成 <span style={{ color: "var(--accent-ink)", fontWeight: 500 }}>业务、技术、组织</span> 三层,基于过去三次会议<sup style={{ color: "var(--accent)", fontSize: 10.5, marginLeft: 1 }}>[1][2][3]</sup>:
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 10, columnGap: 12, marginBottom: 12 }}>
                  {[
                    ["01", "业务层", "围绕续保与理赔两个高频场景,先建立数据闭环。"],
                    ["02", "技术层", "以现有核心系统为锚,搭建轻量中台与 AI 推理层。"],
                    ["03", "组织层", "设立 4 + 2 转型办公室,直接向 COO 汇报。"],
                  ].map(([n, t, d]) => (
                    <React.Fragment key={n}>
                      <span className="num" style={{ fontSize: 11.5, color: "var(--accent)", paddingTop: 3, fontWeight: 500 }}>{n}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{t}</div>
                        <div style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.65, marginTop: 2 }}>{d}</div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>

                {/* Artifact card — generated output */}
                <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: "12px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 36, height: 44, borderRadius: "var(--r-sm)", background: "var(--bg-tint)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 9, fontWeight: 500, letterSpacing: "0.04em" }}>MD</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>战略框架草稿.md · 已生成</div>
                    <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>3 个 H2 · 12 个要点 · 估算 2.3 KB · 可保存到项目文档</div>
                  </div>
                  <button style={{ padding: "5px 12px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>预览</button>
                  <button style={{ padding: "5px 12px", fontSize: 11.5, color: "var(--bg-elev)", background: "var(--ink)", borderRadius: "var(--r-sm)" }}>保存</button>
                </div>

                <p style={{ margin: "12px 0 0", fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.7 }}>
                  风险点集中在数据治理基础和组织变革阻力 — 建议在 POC 阶段就锁定 CTO 王浩与 COO 张丽两位关键决策人<span className="cursor-blink"/>
                </p>

                {/* Action chips */}
                <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
                  <button className="row-hov" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-pill)" }}>↻ 重新生成</button>
                  <button className="row-hov" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-pill)" }}>📌 固定为锚点</button>
                  <button className="row-hov" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-pill)" }}>📝 加到笔记</button>
                  <button className="row-hov" style={{ padding: "4px 10px", fontSize: 11.5, color: "var(--accent)", border: "1px solid var(--accent-bg)", background: "var(--accent-bg)", borderRadius: "var(--r-pill)" }}>沉淀到项目记忆</button>
                </div>
              </div>
            </div>
          </div>

          {/* Composer */}
          <div style={{ padding: "0 28px 18px", flexShrink: 0 }}>
            <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "12px 14px" }}>
              {/* Active context chips */}
              <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: "var(--r-pill)", background: "var(--accent-bg)", color: "var(--accent-ink)", fontSize: 11 }}>
                  <I name="folder" size={10} stroke={1.5}/> 鼎和保险 (项目)
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: "var(--r-pill)", background: "var(--bg-tint)", color: "var(--ink-soft)", fontSize: 11 }}>
                  <I name="sparkle" size={10} stroke={1.5}/> 记忆 v12
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: "var(--r-pill)", background: "var(--bg-tint)", color: "var(--ink-soft)", fontSize: 11 }}>
                  <I name="file" size={10} stroke={1.5}/> 12 文档
                </span>
              </div>

              <div className="ui" style={{ fontSize: 14, color: "var(--ink-faint)", minHeight: 36 }}>继续向 Aria 提问 …</div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line-soft)" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center", color: "var(--ink-mute)", fontSize: 12 }}>
                  <button style={{ display: "flex", alignItems: "center", gap: 5 }}><I name="paperclip" size={12} stroke={1.5}/> 附件</button>
                  <button style={{ display: "flex", alignItems: "center", gap: 5 }}>@ 提及</button>
                  <button style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--accent)" }}>/ Skill</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>⏎ 发送 · ⇧⏎ 换行</span>
                  <button style={{ padding: "5px 14px", background: "var(--accent)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
                    发送 <I name="arrow-right" size={11} stroke={1.8}/>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right context panel removed — info absorbed into thread + composer chips + left Space view */}
        {false && <aside style={{ borderLeft: "1px solid var(--line)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 16, overflow: "hidden", background: "var(--bg)" }}>
          {/* Memory quick bar */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 className="ui" style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--ink-mute)" }}>项目记忆 · v12</h3>
              <CxStatus tone="good">已同步</CxStatus>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.65 }}>
              {[
                ["背景", "鼎和保险 · 深圳 · 续保 + 理赔双场景"],
                ["决策", "王浩 / 张丽 / 王凯"],
                ["下一", "Q3 W1 交付 POC"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: 6, padding: "3px 0" }}>
                  <span style={{ color: "var(--ink-faint)" }}>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <button style={{ marginTop: 8, fontSize: 11, color: "var(--accent)", padding: "4px 0" }}>展开完整记忆 →</button>
          </div>

          <div style={{ height: 1, background: "var(--line-soft)" }}/>

          {/* Pinned anchors */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 className="ui" style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--ink-mute)" }}>固定锚点 · 6</h3>
              <a style={{ fontSize: 11, color: "var(--ink-mute)" }}>编辑 →</a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { t: "理赔系统改造涉及核心交易",  tone: "bad" },
                { t: "客户能否提供脱敏续保数据",  tone: "warn" },
                { t: "王浩偏好小范围验证再扩展",  tone: "info" },
              ].map((a, i) => {
                const c = { bad: "var(--bad)", warn: "var(--warn)", info: "var(--info)" }[a.tone];
                return (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", alignItems: "flex-start" }}>
                    <span style={{ width: 5, height: 5, marginTop: 7, borderRadius: 99, background: c, flexShrink: 0 }}/>
                    <span style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.5 }}>{a.t}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ height: 1, background: "var(--line-soft)" }}/>

          {/* Active artifact preview */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 className="ui" style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--ink-mute)" }}>本次产出预览</h3>
              <CxStatus tone="accent" pulse>未保存</CxStatus>
            </div>
            <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: "var(--ink-mute)", padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 3, letterSpacing: "0.04em" }}>MD</span>
                <span className="ui" style={{ fontSize: 12, color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>战略框架草稿.md</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.7, padding: "8px 0", borderTop: "1px solid var(--line-soft)" }}>
                <div style={{ color: "var(--ink-mute)" }}># 鼎和保险 数字化战略</div>
                <div style={{ color: "var(--ink-mute)" }}>## 一 · 业务层</div>
                <div style={{ paddingLeft: 8, color: "var(--ink-faint)" }}>- 续保转化数据闭环</div>
                <div style={{ paddingLeft: 8, color: "var(--ink-faint)" }}>- 理赔体验优化</div>
                <div style={{ color: "var(--ink-mute)" }}>## 二 · 技术层</div>
                <div style={{ color: "var(--ink-faint)" }}>…</div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button style={{ flex: 1, padding: "5px 0", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>预览</button>
                <button style={{ flex: 1, padding: "5px 0", fontSize: 11.5, color: "var(--bg-elev)", background: "var(--ink)", borderRadius: "var(--r-sm)" }}>保存到文档</button>
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: "var(--line-soft)" }}/>

          {/* Citations */}
          <div>
            <h3 className="ui" style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600, color: "var(--ink-mute)" }}>本次引用 · 3</h3>
            {[
              { n: 1, t: "战略对齐会纪要", src: "项目记忆 · 5/22", score: 0.94 },
              { n: 2, t: "续保业务访谈", src: "DOC-0042 · 5/15", score: 0.87 },
              { n: 3, t: "项目记忆 v12", src: "记忆 · 5/26", score: 0.81 },
            ].map(r => (
              <a key={r.n} className="row-hov" style={{ display: "block", padding: "7px 8px", margin: "0 -8px", borderRadius: "var(--r-sm)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "var(--accent)" }}>[{r.n}] {r.t}</span>
                  <span className="num" style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{r.score}</span>
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink-mute)", marginTop: 2 }}>{r.src}</div>
              </a>
            ))}
          </div>
        </aside>}
      </div>
    </CxProjectShell>
  );
}

/* ============================================================
   Left rail with view switcher: 对话 (Conversations) / 空间 (Space)
   ============================================================ */
function CxProjectChatLeftRail() {
  const [view, setView] = React.useState("chats");
  return (
    <aside style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>
      {/* Segmented switcher */}
      <div style={{ padding: "12px 12px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", padding: 2, background: "var(--bg-tint)", borderRadius: "var(--r-sm)", border: "1px solid var(--line-soft)" }}>
          {[
            { k: "chats", l: "对话", n: 6 },
            { k: "space", l: "空间", n: null },
          ].map(t => {
            const active = view === t.k;
            return (
              <button
                key={t.k}
                onClick={() => setView(t.k)}
                style={{
                  flex: 1, padding: "6px 8px", borderRadius: "var(--r-sm)",
                  background: active ? "var(--bg-elev)" : "transparent",
                  border: active ? "1px solid var(--line)" : "1px solid transparent",
                  fontSize: 12.5,
                  color: active ? "var(--ink)" : "var(--ink-mute)",
                  fontWeight: active ? 500 : 400,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                }}
              >
                {t.l}
                {t.n != null && <span className="num" style={{ fontSize: 10.5, color: active ? "var(--accent)" : "var(--ink-faint)" }}>{t.n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {view === "chats" ? <CxRailChats/> : <CxRailSpace/>}
    </aside>
  );
}

function CxRailChats() {
  return (
    <>
      <div style={{ padding: "10px 12px", flexShrink: 0 }}>
        <button style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "var(--ink)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 12.5, fontWeight: 500 }}>
          <I name="plus" size={12} stroke={1.6}/> 新建对话
          <span style={{ marginLeft: "auto", fontSize: 10.5, opacity: 0.6 }}>⌘N</span>
        </button>
      </div>

      <div style={{ flex: 1, overflow: "hidden", padding: "0 10px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ padding: "8px 8px 4px", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-faint)" }}>
          <span style={{ color: "var(--accent)" }}>★</span> 固定
        </div>
        <a className="row-hov" style={{ padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--bg-tint)", border: "1px solid var(--line)", position: "relative" }}>
          <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 2, background: "var(--accent)" }}/>
          <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>数字化转型框架草稿</div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>
            <CxStatus tone="accent" pulse>进行中</CxStatus>
          </div>
        </a>
        <a className="row-hov" style={{ padding: "8px 10px", borderRadius: "var(--r-sm)" }}>
          <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>6/3 例会会前简报</div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>今早</div>
        </a>

        <div style={{ padding: "10px 8px 4px", fontSize: 11, color: "var(--ink-faint)" }}>今天</div>
        <a className="row-hov" style={{ padding: "8px 10px", borderRadius: "var(--r-sm)" }}>
          <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>POC 评估指标讨论</div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>14:08</div>
        </a>
        <a className="row-hov" style={{ padding: "8px 10px", borderRadius: "var(--r-sm)" }}>
          <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>客户提问整理 · 第二轮</div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>11:42</div>
        </a>

        <div style={{ padding: "10px 8px 4px", fontSize: 11, color: "var(--ink-faint)" }}>昨天</div>
        <a className="row-hov" style={{ padding: "8px 10px", borderRadius: "var(--r-sm)" }}>
          <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>方案 V2 大纲</div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>昨天 16:22</div>
        </a>
        <a className="row-hov" style={{ padding: "8px 10px", borderRadius: "var(--r-sm)" }}>
          <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>组织变革风险讨论</div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>昨天 10:15</div>
        </a>

        <div style={{ padding: "10px 8px 4px", fontSize: 11, color: "var(--ink-faint)" }}>更早</div>
        <a className="row-hov" style={{ padding: "8px 10px", borderRadius: "var(--r-sm)" }}>
          <div className="ui" style={{ fontSize: 12.5, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>客户访谈纪要分析</div>
          <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>5 月 18 日</div>
        </a>
      </div>
    </>
  );
}

/* Space view — tree-structured project space with upload support */
function CxRailSpace() {
  const [expanded, setExpanded] = React.useState({
    memory: true, anchors: true, docs: true, outputs: true,
    "docs/interviews": true, "docs/method": false, "docs/industry": false,
  });
  const toggle = (k) => setExpanded(e => ({ ...e, [k]: !e[k] }));

  const TreeRow = ({ depth = 0, icon, iconColor, expandable, isOpen, label, badge, badgeColor, onClick, dim, active }) => (
    <a className="row-hov" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "4px 6px",
      paddingLeft: 6 + depth * 14,
      margin: "0 -6px",
      borderRadius: "var(--r-sm)",
      cursor: "pointer",
      background: active ? "var(--bg-tint)" : "transparent",
      position: "relative",
    }}>
      {active && <span style={{ position: "absolute", left: 0, top: 4, bottom: 4, width: 2, background: "var(--accent)" }}/>}
      <span style={{ width: 12, color: "var(--ink-faint)", fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {expandable ? (isOpen ? "▾" : "▸") : ""}
      </span>
      {icon && (
        <I name={icon} size={11} stroke={1.5} style={{ color: iconColor || "var(--ink-mute)", flexShrink: 0 }}/>
      )}
      <span style={{ fontSize: 12, color: dim ? "var(--ink-mute)" : "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{label}</span>
      {badge && (
        <span className="num" style={{ fontSize: 10, color: badgeColor || "var(--ink-faint)", flexShrink: 0 }}>{badge}</span>
      )}
    </a>
  );

  const FileRow = ({ depth, ext, label, size, active }) => (
    <a className="row-hov" style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "4px 6px",
      paddingLeft: 6 + depth * 14 + 12,
      margin: "0 -6px",
      borderRadius: "var(--r-sm)",
      background: active ? "var(--accent-bg)" : "transparent",
    }}>
      <span style={{ fontSize: 9, color: ext === "MD" ? "var(--accent)" : "var(--ink-mute)", padding: "1px 4px", border: `1px solid ${ext === "MD" ? "var(--accent-bg)" : "var(--line)"}`, background: ext === "MD" ? "var(--accent-bg)" : "transparent", borderRadius: 2, flexShrink: 0, letterSpacing: "0.04em", minWidth: 24, textAlign: "center" }}>{ext}</span>
      <span style={{ fontSize: 12, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{label}</span>
      {size && <span className="num" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{size}</span>}
    </a>
  );

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Search */}
      <div style={{ padding: "8px 14px 6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", color: "var(--ink-mute)", fontSize: 11.5 }}>
          <I name="search" size={11} stroke={1.5}/>
          <span>搜索空间</span>
          <span style={{ marginLeft: "auto", color: "var(--ink-faint)" }}>⌘P</span>
        </div>
      </div>

      {/* Drop zone for uploads */}
      <div style={{ padding: "4px 14px 8px" }}>
        <div style={{
          padding: "10px 12px",
          border: "1.5px dashed var(--line-strong)",
          borderRadius: "var(--r-sm)",
          background: "color-mix(in oklch, var(--accent) 4%, transparent)",
          display: "flex", alignItems: "center", gap: 8,
          cursor: "pointer",
        }}>
          <span style={{ width: 28, height: 28, borderRadius: "var(--r-sm)", background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <I name="plus" size={13} stroke={1.6}/>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ui" style={{ fontSize: 12, color: "var(--ink)", fontWeight: 500 }}>拖入文件或点击上传</div>
            <div style={{ fontSize: 10.5, color: "var(--ink-mute)", marginTop: 1 }}>PDF · DOC · MD · TXT · ≤ 50 MB</div>
          </div>
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflow: "hidden", padding: "0 14px 14px" }}>
        {/* Memory branch */}
        <TreeRow depth={0} expandable isOpen={expanded.memory} icon="sparkle" iconColor="var(--accent)"
          label="项目记忆" badge="v12" badgeColor="var(--good)"
          onClick={() => toggle("memory")}/>
        {expanded.memory && (
          <>
            <TreeRow depth={1} icon="file" label="当前版本 · v12" active dim/>
            <TreeRow depth={1} icon="file" label="历史版本 · 11 条" dim badge="→"/>
            <TreeRow depth={1} icon="target" label="健康度 · 92 / 100" dim/>
          </>
        )}

        {/* Anchors branch */}
        <TreeRow depth={0} expandable isOpen={expanded.anchors} icon="target" iconColor="var(--warn)"
          label="锚点" badge="6" onClick={() => toggle("anchors")}/>
        {expanded.anchors && (
          <>
            <TreeRow depth={1} icon="dot" iconColor="var(--bad)" label="风险锚点" badge="3"/>
            <TreeRow depth={1} icon="dot" iconColor="var(--warn)" label="待确认问题" badge="2"/>
            <TreeRow depth={1} icon="dot" iconColor="var(--info)" label="干系人提示" badge="1"/>
          </>
        )}

        {/* Documents branch — expandable with subfolders */}
        <TreeRow depth={0} expandable isOpen={expanded.docs} icon="folder" iconColor="var(--accent)"
          label="文档" badge="12" onClick={() => toggle("docs")}/>
        {expanded.docs && (
          <>
            <TreeRow depth={1} expandable isOpen={expanded["docs/interviews"]} icon="folder" iconColor="var(--ink-mute)"
              label="客户访谈" badge="3" onClick={() => toggle("docs/interviews")}/>
            {expanded["docs/interviews"] && (
              <>
                <FileRow depth={2} ext="DOC" label="客户访谈纪要 V3" size="920K"/>
                <FileRow depth={2} ext="DOC" label="续保业务访谈" size="1.2M"/>
                <FileRow depth={2} ext="PDF" label="决策链补充材料" size="640K"/>
              </>
            )}

            <TreeRow depth={1} expandable isOpen={expanded["docs/method"]} icon="folder" iconColor="var(--ink-mute)"
              label="方法论" badge="2" onClick={() => toggle("docs/method")}/>
            {expanded["docs/method"] && (
              <>
                <FileRow depth={2} ext="MD" label="AI 售前评估方法论 v2" size="120K"/>
                <FileRow depth={2} ext="PDF" label="POC 评估方案 v0.3" size="2.4M"/>
              </>
            )}

            <TreeRow depth={1} expandable isOpen={expanded["docs/industry"]} icon="folder" iconColor="var(--ink-mute)"
              label="行业资料" badge="4" onClick={() => toggle("docs/industry")}/>
            {expanded["docs/industry"] && (
              <>
                <FileRow depth={2} ext="PDF" label="保险数字化白皮书 2025" size="8.4M"/>
                <FileRow depth={2} ext="PDF" label="中台架构参考实践 v3" size="5.7M"/>
              </>
            )}

            <FileRow depth={1} ext="DOC" label="项目启动会纪要" size="340K"/>
            <FileRow depth={1} ext="DOC" label="申通 Q2 周报合集" size="3.1M"/>
            <FileRow depth={1} ext="MEM" label="项目记忆快照 v12 · 自动" size="—"/>
          </>
        )}

        {/* Outputs branch */}
        <TreeRow depth={0} expandable isOpen={expanded.outputs} icon="sparkle" iconColor="var(--accent)"
          label="本会话产出" badge="1"
          onClick={() => toggle("outputs")}/>
        {expanded.outputs && (
          <>
            <FileRow depth={1} ext="MD" label="战略框架草稿.md" active size="2.3K"/>
          </>
        )}
      </div>

      {/* Bottom storage indicator */}
      <div style={{ padding: "8px 14px 10px", borderTop: "1px solid var(--line-soft)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--ink-mute)", marginBottom: 4 }}>
          <span>已用空间</span>
          <span className="num">23 MB / 1 GB</span>
        </div>
        <div style={{ height: 2, background: "var(--bg-sunken)", borderRadius: 99 }}>
          <div style={{ height: "100%", width: "2.3%", background: "var(--accent)" }}/>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CxProjectChat, CxProjectChatLeftRail, CxRailChats, CxRailSpace });
