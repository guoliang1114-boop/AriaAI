// direction-codex-project-chat-preview.jsx
// Variant of project chat showing right-side markdown file preview pane

function CxProjectChatPreview() {
  return (
    <CxProjectShell activeTab="chat">
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px 1fr 480px", minHeight: 0, overflow: "hidden" }}>
        <CxProjectChatLeftRail />

        {/* Center thread — condensed showing the artifact prompt that opened the preview */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <h2 className="ui" style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>给我准备一个初步…</h2>
              <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>DeepSeek V4 Pro · 知识范围:当前项目</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>沉淀到记忆</button>
              <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>导出</button>
            </div>
          </div>

          <div style={{ flex: 1, overflow: "hidden", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Plan progress */}
            <div style={{ padding: "12px 14px", background: "color-mix(in oklch, var(--accent-bg) 60%, var(--bg-elev))", border: "1px solid color-mix(in oklch, var(--accent) 25%, var(--line))", borderRadius: "var(--r-sm)" }}>
              <div style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 10 }}>下方卡片可以直接打开,完整执行记录在右上角「任务」面板。</div>
              {[
                { n: 1, t: "步骤 1/4 · 收集项目上下文",      st: "已完成" },
                { n: 2, t: "步骤 2/4 · 规划咨询故事线大纲结构", st: "已完成" },
                { n: 3, t: "步骤 3/4 · 生成并校验咨询故事线大纲", st: "已完成" },
                { n: 4, t: "步骤 4/4 · 校验并交付结果",         st: "已完成" },
              ].map(s => (
                <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 12.5 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 4, background: "var(--good)", color: "var(--bg-elev)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>{s.n}</span>
                  <span style={{ flex: 1, color: "var(--ink)" }}>{s.t}</span>
                  <CxStatus tone="good">✓ {s.st}</CxStatus>
                  <button style={{ fontSize: 11, color: "var(--ink-mute)" }}>展开日志 ▾</button>
                </div>
              ))}
            </div>

            {/* Artifact card — clicked → opens preview pane (highlighted as active) */}
            <div style={{ padding: "14px 16px", background: "var(--bg-elev)", border: "1.5px solid var(--accent)", borderRadius: "var(--r-sm)", boxShadow: "0 0 0 4px color-mix(in oklch, var(--accent) 10%, transparent)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 32, height: 40, borderRadius: 4, background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 10, fontWeight: 600, letterSpacing: "0.04em" }}>MD</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>客户战略沟通故事线大纲.md</div>
                  <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}># 集团大会员数字化平台蓝图与运营模式设计-客户...</div>
                </div>
                <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--accent)", border: "1px solid var(--accent)", background: "var(--accent-bg)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 4 }}>
                  <I name="arrow-up-right" size={10} stroke={1.5}/> 打开
                </button>
                <button style={{ padding: "5px 10px", fontSize: 11.5, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", gap: 4 }}>
                  <I name="arrow-right" size={10} stroke={1.5}/> 下载
                </button>
              </div>
            </div>

            {/* User follow-up */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ background: "var(--ink)", color: "var(--bg-elev)", padding: "10px 14px", borderRadius: "var(--r-md)", fontSize: 13, maxWidth: "75%" }}>
                合理 基于这个大概 给我一份 ppt
              </div>
            </div>

            {/* Aria responding */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ width: 26, height: 26, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <I name="sparkle" size={12} stroke={1.5}/>
              </span>
              <div>
                <div style={{ fontSize: 12, color: "var(--accent-ink)", fontWeight: 500, marginBottom: 4 }}>Aria</div>
                <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>已完成:合理 基于这个大概 给我一份 ppt<span className="cursor-blink"/></div>
              </div>
            </div>
          </div>

          {/* Composer */}
          <div style={{ padding: "0 24px 18px", flexShrink: 0 }}>
            <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "12px 14px" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 8, fontSize: 11, color: "var(--ink-mute)" }}>
                <span style={{ padding: "2px 8px", background: "var(--bg-tint)", borderRadius: "var(--r-pill)" }}>🔧 @ Skills</span>
              </div>
              <div className="ui" style={{ fontSize: 13, color: "var(--ink-faint)", minHeight: 30 }}>输入消息… (Shift+Enter 换行)</div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <button style={{ padding: "5px 12px", background: "var(--accent)", color: "var(--bg-elev)", borderRadius: "var(--r-sm)", fontSize: 12, fontWeight: 500 }}>↗</button>
              </div>
            </div>
          </div>
        </div>

        {/* ============= RIGHT: File preview pane ============= */}
        <aside style={{ borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
          {/* Preview header */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ width: 28, height: 36, borderRadius: 4, background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 9, fontWeight: 600, letterSpacing: "0.04em" }}>MD</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ui" style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>客户战略沟通故事线大纲.md</div>
              <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>Markdown 预览 · 2.4 KB · 6 个章节</div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button style={{ padding: 6, color: "var(--ink-mute)" }} title="下载"><I name="arrow-right" size={13} stroke={1.5}/></button>
              <button style={{ padding: 6, color: "var(--ink-mute)" }} title="保存到项目文档"><I name="paperclip" size={13} stroke={1.5}/></button>
              <button style={{ padding: 6, color: "var(--ink-mute)" }} title="关闭预览">✕</button>
            </div>
          </div>

          {/* Tab strip */}
          <div style={{ display: "flex", padding: "0 20px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
            {[
              { l: "预览",    active: true },
              { l: "源码" },
              { l: "目录" },
              { l: "版本"    },
            ].map(t => (
              <button key={t.l} style={{ padding: "10px 12px", fontSize: 12.5, color: t.active ? "var(--ink)" : "var(--ink-mute)", fontWeight: t.active ? 500 : 400, borderBottom: t.active ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -1 }}>
                {t.l}
              </button>
            ))}
          </div>

          {/* Markdown content */}
          <div style={{ flex: 1, overflow: "hidden", padding: "22px 24px", fontSize: 13, lineHeight: 1.75, color: "var(--ink)" }}>
            <h2 className="ui" style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>集团大会员数字化平台蓝图与运营模式设计-客户战略沟通故事线大纲</h2>

            <h3 className="ui" style={{ margin: "20px 0 8px", fontSize: 15, fontWeight: 600 }}>使用说明</h3>
            <p style={{ margin: 0, color: "var(--ink-soft)" }}>以下结构按一级目录和二级目录组织。一级目录对应客户沟通的主要章节,二级目录对应每章需要展开的判断点、证据和行动。</p>

            <h3 className="ui" style={{ margin: "22px 0 8px", fontSize: 15, fontWeight: 600 }}>01. 项目背景与沟通目标</h3>
            <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500, marginTop: 12 }}>1.1 为什么现在讨论「集团大会员数字化平台蓝图与运营模式设计」</div>
            <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 12.5 }}>说明广州岭南商旅投资集团有限公司当前为什么需要讨论该议题,并把讨论落到「集团大会员数字化平台蓝图与运营模式设计」的业务进入判断上。</p>

            <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500, marginTop: 12 }}>1.2 广州岭南商旅投资集团有限公司希望通过本次沟通获得什么判断</div>
            <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 12.5 }}>明确本次沟通要形成的共识、待验证问题和下一步决策输入,避免会议只停留在泛泛交流。</p>

            <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500, marginTop: 12 }}>1.3 本材料要解决的核心问题和不解决的问题</div>
            <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 12.5 }}>说明本小节的核心判断、所需证据、客户需要确认的问题,以及进入下一阶段前必须完成的动作。</p>

            <h3 className="ui" style={{ margin: "22px 0 8px", fontSize: 15, fontWeight: 600 }}>02. 客户现状与战略动因</h3>
            <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500, marginTop: 12 }}>2.1 客户增长压力与新业务孵化职责</div>
            <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 12.5 }}>说明本小节的核心判断、所需证据、客户需要确认的问题,以及进入下一阶段前必须完成的动作。</p>

            <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500, marginTop: 12 }}>2.2 功能性护肤品/医美抗衰方向的战略相关性</div>
            <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 12.5 }}>说明本小节的核心判断、所需证据、客户需要确认的问题,以及进入下一阶段前必须完成的动作。</p>

            <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500, marginTop: 12 }}>2.3 现有品牌、渠道和组织能力的可迁移资产</div>
            <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 12.5 }}>评估东阿阿胶现有品牌信任、渠道触点、会员资产和组织能力能否低成本迁移到新业务。</p>

            <h3 className="ui" style={{ margin: "22px 0 8px", fontSize: 15, fontWeight: 600 }}>03. 赛道机会与市场吸引力</h3>
            <div style={{ fontSize: 13.5, color: "var(--ink)", fontWeight: 500, marginTop: 12 }}>3.1 目标赛道的增长逻辑、利润池和竞争密度</div>
          </div>
        </aside>
      </div>
    </CxProjectShell>
  );
}

Object.assign(window, { CxProjectChatPreview });
