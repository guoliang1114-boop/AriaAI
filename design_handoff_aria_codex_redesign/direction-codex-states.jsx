// direction-codex-states.jsx — Loading skeleton + Message notifications

/* ============================================================
   Skeleton loading helper
   ============================================================ */
function CxSkeleton({ w = "100%", h = 12, style = {} }) {
  return (
    <span style={{
      display: "inline-block",
      width: w, height: h,
      background: "linear-gradient(90deg, var(--bg-tint) 0%, var(--bg-sunken) 50%, var(--bg-tint) 100%)",
      backgroundSize: "200% 100%",
      borderRadius: "var(--r-sm)",
      animation: "codex-shimmer 1.6s ease-in-out infinite",
      ...style,
    }}/>
  );
}

/* ============================================================
   Loading state — page being fetched
   ============================================================ */
function CxLoading() {
  return (
    <CxShell activeKey="workspace">
      <div style={{ height: 2, background: "var(--bg-tint)", overflow: "hidden", flexShrink: 0 }}>
        <div style={{
          height: "100%", width: "40%",
          background: "var(--accent)",
          animation: "codex-progress 1.8s ease-in-out infinite",
        }}/>
      </div>

      <div style={{ flex: 1, overflow: "hidden", padding: "36px 56px", display: "grid", gridTemplateColumns: "1fr 300px", columnGap: 56, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 32, minWidth: 0 }}>
          {/* Greeting skeleton */}
          <div>
            <CxSkeleton w={140} h={11} style={{ marginBottom: 12 }}/>
            <div><CxSkeleton w={320} h={28}/></div>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <CxSkeleton w="80%" h={14}/>
              <CxSkeleton w="55%" h={14}/>
            </div>
          </div>

          {/* Quick actions skeleton */}
          <section>
            <div style={{ marginBottom: 14 }}><CxSkeleton w={100} h={13}/></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ padding: "18px 18px", background: "var(--bg-elev)", borderRadius: "var(--r-md)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10, minHeight: 140 }}>
                  <CxSkeleton w={30} h={30} style={{ borderRadius: "var(--r-sm)" }}/>
                  <CxSkeleton w="70%" h={16}/>
                  <CxSkeleton w="90%" h={12}/>
                  <CxSkeleton w="50%" h={11} style={{ marginTop: "auto" }}/>
                </div>
              ))}
            </div>
          </section>

          {/* Project list skeleton */}
          <section>
            <div style={{ marginBottom: 12 }}><CxSkeleton w={120} h={13}/></div>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 110px 100px 110px 14px", padding: "13px 4px", gap: 14, alignItems: "center", borderBottom: "1px solid var(--line-soft)" }}>
                <div>
                  <CxSkeleton w="60%" h={14}/>
                  <div style={{ marginTop: 5 }}><CxSkeleton w="40%" h={11}/></div>
                </div>
                <CxSkeleton w={70} h={14} style={{ borderRadius: 99 }}/>
                <CxSkeleton w={50} h={13}/>
                <CxSkeleton w={80} h={13} style={{ borderRadius: 99 }}/>
                <CxSkeleton w={10} h={10}/>
              </div>
            ))}
          </section>
        </div>

        {/* Side skeleton */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 28, minWidth: 0, borderLeft: "1px solid var(--line)", paddingLeft: 36 }}>
          {[1, 2].map(s => (
            <div key={s}>
              <div style={{ marginBottom: 12 }}><CxSkeleton w={90} h={13}/></div>
              {[1, 2, 3, 4].map(i => (
                <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0" }}>
                  <CxSkeleton w={14} h={14} style={{ borderRadius: 3, flexShrink: 0 }}/>
                  <div style={{ flex: 1 }}>
                    <CxSkeleton w="85%" h={13}/>
                    <div style={{ marginTop: 5 }}><CxSkeleton w="50%" h={11}/></div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </aside>
      </div>
    </CxShell>
  );
}

/* ============================================================
   Notifications — dropdown panel below the bell icon
   Showing the workspace page with the bell dropdown open
   ============================================================ */
function CxNotifications() {
  const notifications = [
    {
      type: "skill", icon: "sparkle", tone: "accent", title: "数字化战略 Skill 调用完成",
      desc: "鼎和保险 · 数字化转型咨询 — 已生成战略框架草稿,共 12 个要点。",
      time: "刚刚", unread: true, project: "鼎和保险",
    },
    {
      type: "memory", icon: "target", tone: "warn", title: "客户记忆刷新失败",
      desc: "中信地产 · 客户记忆沉淀任务超时(30s),建议手工触发。",
      time: "8 分钟前", unread: true, project: "中信地产",
    },
    {
      type: "system", icon: "bell", tone: "info", title: "V0.0.3 版本上线",
      desc: "Skill 体系治理、Harness 架构与记忆系统升级 — 详情见消息中心。",
      time: "今天 19:12", unread: true,
    },
    {
      type: "todo", icon: "check", tone: "good", title: "待办「整理周三例会材料」即将到期",
      desc: "今天 17:00 截止,负责人 陈悦 · 来自鼎和保险项目。",
      time: "1 小时前", unread: false, project: "鼎和保险",
    },
    {
      type: "team", icon: "user", tone: "neutral", title: "林宥上传了 2 份文档",
      desc: "客户访谈纪要 V3 · 数据治理评估方案 — 已加入鼎和保险项目。",
      time: "3 小时前", unread: false, project: "鼎和保险",
    },
    {
      type: "mention", icon: "chat", tone: "accent", title: "苏明在对话里 @ 了你",
      desc: "「POC 评估指标定义讨论」— 想听听你对 NPS 纳入指标的意见。",
      time: "今早", unread: false, project: "鼎和保险",
    },
  ];

  const unreadCount = notifications.filter(n => n.unread).length;

  return (
    <CxShell activeKey="workspace">
      {/* Dimmed page underneath */}
      <div style={{ flex: 1, padding: "36px 56px 40px", overflow: "hidden", position: "relative", filter: "blur(2px) brightness(0.95)" }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--ink-mute)", marginBottom: 10 }}>2026 年 5 月 28 日 · 周四</div>
          <h1 className="ui" style={{ margin: 0, fontSize: 32, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>下午好,陈悦</h1>
        </div>
      </div>

      {/* Overlay backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.04)", pointerEvents: "none" }}/>

      {/* Notification dropdown — positioned where the bell would open */}
      <div style={{
        position: "absolute",
        top: 62, right: 96,
        width: 420,
        background: "var(--bg-elev)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        boxShadow: "0 12px 36px -8px rgba(0,0,0,0.18), 0 0 0 1px var(--line)",
        overflow: "hidden",
        display: "flex", flexDirection: "column",
        maxHeight: 600,
      }}>
        {/* Arrow */}
        <span style={{ position: "absolute", top: -7, right: 22, width: 12, height: 12, background: "var(--bg-elev)", borderTop: "1px solid var(--line)", borderLeft: "1px solid var(--line)", transform: "rotate(45deg)" }}/>

        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-soft)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <I name="bell" size={14} stroke={1.5} style={{ color: "var(--accent)" }}/>
            <span className="ui" style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>消息通知</span>
            <span className="num" style={{ fontSize: 11, padding: "1px 7px", background: "var(--accent)", color: "var(--bg-elev)", borderRadius: 99, fontWeight: 600 }}>{unreadCount}</span>
          </div>
          <button style={{ fontSize: 11.5, color: "var(--accent)" }}>全部标为已读</button>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", padding: "8px 14px", borderBottom: "1px solid var(--line-soft)", gap: 4 }}>
          {[
            { l: "全部", n: notifications.length, active: true },
            { l: "未读",   n: unreadCount },
            { l: "提及",   n: 1 },
            { l: "系统",   n: 1 },
          ].map(t => (
            <button key={t.l} style={{
              padding: "4px 10px",
              borderRadius: "var(--r-sm)",
              background: t.active ? "var(--bg-tint)" : "transparent",
              fontSize: 12,
              color: t.active ? "var(--ink)" : "var(--ink-mute)",
              fontWeight: t.active ? 500 : 400,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              {t.l}
              <span style={{ fontSize: 10, color: t.active ? "var(--accent)" : "var(--ink-faint)" }}>{t.n}</span>
            </button>
          ))}
        </div>

        {/* Notification list */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {notifications.map((n, i) => {
            const toneColor = { accent: "var(--accent)", warn: "var(--warn)", good: "var(--good)", info: "var(--info)", neutral: "var(--ink-soft)" }[n.tone];
            const toneBg = { accent: "var(--accent-bg)", warn: "color-mix(in oklch, var(--warn) 14%, transparent)", good: "color-mix(in oklch, var(--good) 14%, transparent)", info: "color-mix(in oklch, var(--info) 14%, transparent)", neutral: "var(--bg-tint)" }[n.tone];
            return (
              <a key={i} className="row-hov" style={{
                display: "flex", gap: 12, padding: "12px 18px",
                borderBottom: i === notifications.length - 1 ? "none" : "1px solid var(--line-soft)",
                background: n.unread ? "color-mix(in oklch, var(--accent) 3%, transparent)" : "transparent",
                position: "relative",
              }}>
                {n.unread && <span style={{ position: "absolute", left: 7, top: "50%", width: 5, height: 5, borderRadius: 99, background: "var(--accent)", transform: "translateY(-50%)" }}/>}
                <span style={{ width: 30, height: 30, borderRadius: "var(--r-sm)", background: toneBg, color: toneColor, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <I name={n.icon} size={14} stroke={1.5}/>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                    <span className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: n.unread ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.title}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-faint)", flexShrink: 0 }}>{n.time}</span>
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.55 }}>{n.desc}</p>
                  {n.project && (
                    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10.5, color: "var(--accent-ink)", padding: "1px 6px", background: "var(--accent-bg)", borderRadius: "var(--r-sm)" }}>{n.project}</span>
                    </div>
                  )}
                </div>
              </a>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 18px", borderTop: "1px solid var(--line-soft)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-tint)" }}>
          <a style={{ fontSize: 12, color: "var(--ink-mute)" }}>消息设置</a>
          <a style={{ fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>打开消息中心 <I name="arrow-up-right" size={10} stroke={1.5}/></a>
        </div>
      </div>

      {/* Toast stack — show 2 toasts in the corner */}
      <div style={{ position: "absolute", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 10, width: 360, zIndex: 50 }}>
        {/* Success toast */}
        <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderLeft: "3px solid var(--good)", borderRadius: "var(--r-sm)", padding: "12px 14px", display: "flex", gap: 10, boxShadow: "0 8px 24px -6px rgba(0,0,0,0.12)" }}>
          <I name="check" size={14} stroke={2} style={{ color: "var(--good)", marginTop: 2, flexShrink: 0 }}/>
          <div style={{ flex: 1 }}>
            <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>记忆已沉淀</div>
            <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 3 }}>项目记忆已更新到 v13 · 5 个槽位 · 8 条新片段</div>
          </div>
          <button style={{ color: "var(--ink-faint)", fontSize: 14, alignSelf: "flex-start" }}>✕</button>
        </div>

        {/* Error toast */}
        <div style={{ background: "var(--bg-elev)", border: "1px solid var(--line)", borderLeft: "3px solid var(--bad)", borderRadius: "var(--r-sm)", padding: "12px 14px", display: "flex", gap: 10, boxShadow: "0 8px 24px -6px rgba(0,0,0,0.12)" }}>
          <I name="target" size={14} stroke={1.8} style={{ color: "var(--bad)", marginTop: 2, flexShrink: 0 }}/>
          <div style={{ flex: 1 }}>
            <div className="ui" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>客户记忆刷新失败</div>
            <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 3 }}>中信地产 · 任务超时(30s)。已自动加入重试队列。</div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button style={{ padding: "3px 10px", fontSize: 11, color: "var(--bad)", border: "1px solid color-mix(in oklch, var(--bad) 30%, transparent)", borderRadius: "var(--r-sm)" }}>立即重试</button>
              <button style={{ padding: "3px 10px", fontSize: 11, color: "var(--ink-mute)" }}>查看日志</button>
            </div>
          </div>
          <button style={{ color: "var(--ink-faint)", fontSize: 14, alignSelf: "flex-start" }}>✕</button>
        </div>
      </div>
    </CxShell>
  );
}

Object.assign(window, { CxSkeleton, CxLoading, CxNotifications });

/* ============================================================
   Avatar dropdown — shown when clicking top-right avatar
   ============================================================ */
function CxAvatarMenu() {
  return (
    <CxShell activeKey="workspace">
      <div style={{ flex: 1, padding: "36px 56px 40px", overflow: "hidden", filter: "blur(2px) brightness(0.95)" }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--ink-mute)", marginBottom: 10 }}>2026 年 5 月 28 日 · 周四</div>
          <h1 className="ui" style={{ margin: 0, fontSize: 32, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.02em" }}>下午好,陈悦</h1>
        </div>
      </div>

      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.04)", pointerEvents: "none" }}/>

      {/* Dropdown positioned below top-right avatar */}
      <div style={{
        position: "absolute",
        top: 62, right: 28,
        width: 300,
        background: "var(--bg-elev)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        boxShadow: "0 12px 36px -8px rgba(0,0,0,0.18), 0 0 0 1px var(--line)",
        overflow: "hidden",
      }}>
        <span style={{ position: "absolute", top: -7, right: 16, width: 12, height: 12, background: "var(--bg-elev)", borderTop: "1px solid var(--line)", borderLeft: "1px solid var(--line)", transform: "rotate(45deg)" }}/>

        {/* User identity */}
        <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid var(--line-soft)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 42, height: 42, borderRadius: 99, background: "var(--accent-bg)", color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 500 }}>陈</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ui" style={{ fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>陈悦</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>chenyue@aria.team</div>
            <div style={{ marginTop: 4 }}><CxStatus tone="good">在线 · 解决方案咨询组</CxStatus></div>
          </div>
        </div>

        {/* Status switch */}
        <div style={{ padding: "8px 10px 6px 14px", borderBottom: "1px solid var(--line-soft)" }}>
          <div style={{ fontSize: 10.5, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 4px 6px" }}>状态</div>
          {[
            { l: "在线", tone: "good", active: true },
            { l: "忙碌 · 勿扰",   tone: "warn" },
            { l: "离开", tone: "mute" },
          ].map(s => (
            <a key={s.l} className="row-hov" style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: "var(--r-sm)", fontSize: 12.5, color: s.active ? "var(--ink)" : "var(--ink-soft)" }}>
              <CxStatus tone={s.tone}>{s.l}</CxStatus>
              {s.active && <I name="check" size={11} stroke={2} style={{ color: "var(--accent)", marginLeft: "auto" }}/>}
            </a>
          ))}
        </div>

        {/* Menu items */}
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line-soft)" }}>
          {[
            { i: "user",     l: "个人资料",        k: "" },
            { i: "settings", l: "外观",           k: "" },
            { i: "settings", l: "偏好与设置",       k: "⌘," },
            { i: "bell",     l: "消息中心",        k: "" },
            { i: "lock",     l: "API 密钥",        k: "" },
          ].map(m => (
            <a key={m.l} className="row-hov" style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: "var(--r-sm)", fontSize: 13, color: "var(--ink-soft)" }}>
              <I name={m.i} size={13} stroke={1.5} style={{ color: "var(--ink-mute)" }}/>
              <span style={{ flex: 1 }}>{m.l}</span>
              {m.k && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{m.k}</span>}
            </a>
          ))}
        </div>

        {/* Workspace switch */}
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line-soft)" }}>
          <div style={{ fontSize: 10.5, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 4px 4px" }}>工作空间</div>
          <a className="row-hov" style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: "var(--r-sm)" }}>
            <span style={{ width: 22, height: 22, borderRadius: "var(--r-sm)", background: "var(--ink)", color: "var(--bg-elev)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>A</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ui" style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 500 }}>解决方案咨询组</div>
              <div style={{ fontSize: 10.5, color: "var(--ink-mute)" }}>当前</div>
            </div>
            <I name="check" size={11} stroke={2} style={{ color: "var(--accent)" }}/>
          </a>
          <a className="row-hov" style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: "var(--r-sm)", color: "var(--ink-soft)" }}>
            <I name="plus" size={12} stroke={1.5} style={{ color: "var(--ink-mute)" }}/>
            <span style={{ fontSize: 12.5 }}>添加 / 切换工作空间</span>
          </a>
        </div>

        {/* Footer actions */}
        <div style={{ padding: "8px 10px" }}>
          <a className="row-hov" style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: "var(--r-sm)", fontSize: 12.5, color: "var(--ink-mute)" }}>
            <I name="file" size={12} stroke={1.5}/> 帮助与文档
          </a>
          <a className="row-hov" style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: "var(--r-sm)", fontSize: 12.5, color: "var(--bad)" }}>
            <I name="logout" size={12} stroke={1.5}/> 退出登录
          </a>
        </div>
      </div>
    </CxShell>
  );
}

Object.assign(window, { CxAvatarMenu });
