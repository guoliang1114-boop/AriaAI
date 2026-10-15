import SwiftUI

// All content in these screens is local demonstration data.
// Shared design tokens live in Theme so the visual style can be changed centrally.

// MARK: - Activity

struct ActivityView: View {
    @EnvironmentObject var store: AppStore
    @State private var filter: ActivityFilter = .all
    @State private var updatedAt: Date?
    @State private var isRefreshing = false
    @State private var selectedApprovalID: UUID?

    private var visibleItems: [ActivityEntry] {
        let pendingItems = store.approvals.filter { $0.status == .pending }
        let pending = pendingItems.count
        let entries = ActivityEntry.samples.compactMap { item -> ActivityEntry? in
            guard item.id == "approval" else { return item }
            guard !store.approvals.isEmpty else { return nil }
            let pendingSummary = pendingItems.first?.title.contains("晨间") == true
                ? item.summary
                : "有 \(pending) 项示例操作需要你的确认。确认前不会执行。"
            return ActivityEntry(id: item.id,
                                 title: pending > 0 ? "\(pending) 项操作等待确认" : "审批事项已处理",
                                 summary: pending > 0 ? pendingSummary : "所有示例审批都已处理。可以查看决定记录；没有执行任何外部操作。",
                                 time: pending > 0 ? "审批 · 需要处理" : "审批 · 已处理",
                                 symbol: item.symbol,
                                 filter: pending > 0 ? .inProgress : .completed,
                                 steps: item.steps,
                                 result: item.result)
        }
        return entries.filter { filter == .all || $0.filter == filter }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    ContentIntro(eyebrow: "10 月 15 日 · 示例动态", title: "动态", subtitle: "只呈现需要你知道、决定或继续推进的内容。")
                    FilterSelector(selection: $filter)
                    refreshLabel
                    VStack(spacing: 12) {
                        if visibleItems.isEmpty {
                            SurfaceCard {
                                VStack(spacing: 12) {
                                    Image(systemName: "checkmark.circle").font(.title).foregroundStyle(Theme.accent)
                                    Text("这里暂时没有待处理动态").font(.headline).foregroundStyle(Theme.ink)
                                    Text("需要你决定或继续推进时，会出现在这里。")
                                        .font(.subheadline).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
                                }
                                .frame(maxWidth: .infinity).padding(.vertical, 24)
                            }
                        }
                        ForEach(visibleItems) { item in
                            if item.id == "approval" {
                                Button {
                                    selectedApprovalID = (store.approvals.first(where: { $0.status == .pending }) ?? store.approvals.first)?.id
                                } label: {
                                    ActivityEntryCard(item: item)
                                }
                                .buttonStyle(.plain)
                            } else {
                                NavigationLink {
                                    ActivityDetailView(item: item)
                                } label: {
                                    ActivityEntryCard(item: item)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .opacity(isRefreshing ? 0.4 : 1)
                    .allowsHitTesting(!isRefreshing)
                    SampleDataFootnote()
                }
                .padding(20)
            }
            .background(Theme.background)
            .navigationTitle("Aria")
            .navigationBarTitleDisplayMode(.inline)
            .modifier(AriaStatusToolbar())
            .refreshable { await refreshActivity() }
            .navigationDestination(item: $selectedApprovalID) { approvalID in
                ContentApprovalDetailView(approvalID: approvalID)
            }
        }
    }

    private var refreshLabel: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                if let updatedAt {
                    Text("已更新于 \(updatedAt.formatted(date: .omitted, time: .standard))")
                } else {
                    Text("下拉刷新，查看最新进展")
                }
                Text("\(visibleItems.count) 项动态")
            }
            Spacer()
            Button {
                Task { await refreshActivity() }
            } label: {
                Label(isRefreshing ? "更新中" : "刷新", systemImage: "arrow.clockwise")
                    .font(.subheadline)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(.white, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line, lineWidth: 1))
            }
            .buttonStyle(.plain).disabled(isRefreshing)
        }
        .font(.caption)
        .foregroundStyle(Theme.secondary)
    }

    @MainActor private func refreshActivity() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        try? await Task.sleep(for: .milliseconds(700))
        updatedAt = Date()
        isRefreshing = false
    }
}

private enum ActivityFilter: String, CaseIterable, Identifiable, ContentFilter {
    case all = "全部"
    case inProgress = "待处理"
    case completed = "已完成"
    var id: String { rawValue }
}

private struct ActivityEntry: Identifiable {
    let id: String
    let title: String
    let summary: String
    let time: String
    let symbol: String
    let filter: ActivityFilter
    let steps: [String]
    let result: String

    static let samples: [ActivityEntry] = [
        .init(id: "brief", title: "今日简报", summary: "Aria 前端原型正在向聊天优先的移动体验调整，语音入口已放进消息编辑器。", time: "简报 · 18:30 更新", symbol: "text.bubble", filter: .completed, steps: ["刚刚：补齐内容筛选与详情入口", "下一步：验证手机和桌面两种布局"], result: "前端原型继续深化。围绕四个主内容页、详情层级和状态反馈继续加强。"),
        .init(id: "document", title: "文档已合并", summary: "个人助手 App 总体方案与语音模式技术设计已经合并，后续可以从同一份方案继续迭代。", time: "项目 · 已完成", symbol: "doc.text", filter: .completed, steps: ["已完成：合并总体方案与语音设计", "待开始：确认语音服务商后进入开发"], result: "产品总体方案和语音模式设计现在由同一份文档承载。移动端、连接器与语音模式可以沿着统一路线继续推进。"),
        .init(id: "approval", title: "1 项操作等待确认", summary: "晨间简报需要持续访问日历和邮件邀请。确认前，Aria 不会创建自动任务。", time: "审批 · 需要处理", symbol: "checkmark.shield", filter: .inProgress, steps: ["读取范围：日历和邮件邀请", "运行频率：每天 07:30", "当前状态：仅演示，未连接真实服务"], result: "创建晨间日程简报需要先由你确认。这个原型只展示审批状态，不会创建真实任务。")
    ]
}

private struct ActivityEntryCard: View {
    let item: ActivityEntry
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    ContentSymbol(item.symbol)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.title).font(.headline).foregroundStyle(Theme.ink)
                        Text(item.time).font(.caption).foregroundStyle(Theme.secondary)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.secondary)
                }
                Text(item.summary).font(.subheadline).foregroundStyle(Theme.secondary).fixedSize(horizontal: false, vertical: true)
                Pill(text: item.filter.rawValue, systemImage: item.filter == .completed ? "checkmark.circle" : "circle.dotted", selected: item.filter == .inProgress)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ActivityDetailView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let item: ActivityEntry

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ContentSymbol(item.symbol, large: true)
                Text(item.title).font(.title2.bold()).foregroundStyle(Theme.ink)
                HStack { Text(item.time); Spacer(); Text(item.filter.rawValue) }
                    .font(.caption).foregroundStyle(Theme.secondary)
                SurfaceCard {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionEyebrow("目前的进展")
                        Text(item.result).font(.body).foregroundStyle(Theme.ink).lineSpacing(5)
                    }
                }
                SectionEyebrow("推进记录")
                ForEach(Array(item.steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .top, spacing: 12) {
                        Text(String(index + 1)).font(.caption.bold()).foregroundStyle(Theme.accent)
                            .frame(width: 26, height: 26).background(Theme.accent.opacity(0.08), in: Circle())
                        Text(step).font(.subheadline).foregroundStyle(Theme.ink)
                    }
                }
                PrimaryButton("回到对话，继续这件事") {
                    dismiss()
                    store.openChat(context: "帮我继续推进「\(item.title)」。")
                }
                SampleDataFootnote()
            }
            .padding(20)
        }
        .background(Theme.background)
        .navigationTitle("动态详情")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Inspiration

struct InspirationView: View {
    @EnvironmentObject var store: AppStore
    @State private var feedback: [String: InspirationFeedback] = [:]
    @State private var entries = InspirationEntry.samples
    @State private var isRefreshing = false
    @State private var refreshed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    ContentIntro(eyebrow: "根据当前目标整理", title: "灵感", subtitle: "根据正在做的事，给出可以直接开始的下一步。")
                    HStack {
                        Text(refreshed ? "已根据当前目标重新整理" : "从一个想法开始")
                            .font(.caption).foregroundStyle(Theme.secondary)
                        Spacer()
                        Button {
                            Task { await refreshIdeas() }
                        } label: {
                            Label(isRefreshing ? "整理中" : "换一批", systemImage: "arrow.clockwise")
                                .font(.subheadline)
                        }
                        .disabled(isRefreshing).foregroundStyle(Theme.ink)
                    }
                    ForEach(entries) { item in
                        InspirationCard(item: item, feedback: feedbackBinding(for: item.id))
                            .opacity(isRefreshing ? 0.4 : 1)
                    }
                    SampleDataFootnote()
                }
                .padding(20)
            }
            .background(Theme.background)
            .navigationTitle("Aria")
            .navigationBarTitleDisplayMode(.inline)
            .modifier(AriaStatusToolbar())
            .refreshable { await refreshIdeas() }
        }
    }

    private func feedbackBinding(for id: String) -> Binding<InspirationFeedback?> {
        Binding(get: { feedback[id] }, set: { feedback[id] = $0 })
    }

    @MainActor private func refreshIdeas() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        try? await Task.sleep(for: .milliseconds(700))
        if !entries.isEmpty {
            let first = entries.removeFirst()
            entries.append(first)
        }
        refreshed = true
        isRefreshing = false
    }
}

private enum InspirationFeedback: Equatable {
    case useful, lessLikeThis
    var acknowledgement: String {
        switch self {
        case .useful: "记下了，下次会多留意这类灵感。"
        case .lessLikeThis: "收到，这类建议会少一些。"
        }
    }
}

private struct InspirationEntry: Identifiable {
    let id: String
    let category: String
    let title: String
    let subtitle: String
    let symbol: String
    let reason: String
    let ideas: [String]
    static let samples: [InspirationEntry] = [
        .init(id: "voice", category: "01 · 产品", title: "把语音模式收敛成第一个可开发版本", subtitle: "先覆盖连线、听取、思考、播报、打断与结束六个关键状态。", symbol: "waveform", reason: "来自示例目标：把 Aria 打造成 Muse-like 个人助手。", ideas: ["先写清楚连线、听取、思考、播报、打断与结束的状态转换。", "为麦克风关闭、连接中断与重复点击准备反馈。", "用本地模拟走通完整体验，再决定真实服务的接入方案。"]),
        .init(id: "permissions", category: "02 · 架构", title: "设计生活连接器的权限分级", subtitle: "把只读、代写、外部发送与付款拆成不同的授权边界。", symbol: "checkmark.shield", reason: "来自示例项目：让关键操作始终可控。", ideas: ["按只读、草稿、对外发送与付款分组列出能力。", "每次确认展示数据范围、操作对象与可能的影响。", "为撤销连接和查看历史授权预留明确入口。"]),
        .init(id: "platform", category: "03 · 决策", title: "比较 PWA 与 React Native 的第一阶段成本", subtitle: "从开发速度、通知、语音、设备能力与上架成本评估。", symbol: "rectangle.3.group", reason: "来自示例项目：为第一阶段选择合适的移动端路线。", ideas: ["列出第一阶段必须具备的设备与语音能力。", "分别评估开发、测试、维护与发布所需的工作。", "把选择依据写成一页简短的决策记录。"]),
        .init(id: "interaction", category: "04 · 体验", title: "整理 Muse 值得对标的交互清单", subtitle: "聚焦聊天、动态、灵感、目标、资料库与状态页之间的关系。", symbol: "square.grid.2x2", reason: "来自示例目标：统一个人助手各个入口的使用体验。", ideas: ["从一个任务出发，记录它如何在各页面之间流转。", "检查返回、关闭、重复操作与空状态是否清晰。", "先验证核心路径，再扩展更多场景。"])
    ]
}

private struct InspirationCard: View {
    let item: InspirationEntry
    @Binding var feedback: InspirationFeedback?

    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    SectionEyebrow(item.category)
                    Spacer()
                    Image(systemName: item.symbol).font(.title2).foregroundStyle(Theme.accent)
                }
                NavigationLink {
                    InspirationDetailView(item: item, feedback: $feedback)
                } label: {
                    VStack(alignment: .leading, spacing: 9) {
                        Text(item.title).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                        Text(item.subtitle).font(.subheadline).foregroundStyle(Theme.secondary).multilineTextAlignment(.leading)
                        Label("展开这个想法", systemImage: "arrow.up.right").font(.subheadline.weight(.medium)).foregroundStyle(Theme.accent)
                    }
                }
                .buttonStyle(.plain)
                Divider().overlay(Theme.line)
                InspirationFeedbackControls(feedback: $feedback)
            }
        }
    }
}

private struct InspirationFeedbackControls: View {
    @Binding var feedback: InspirationFeedback?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Button { feedback = .useful } label: {
                    Label(feedback == .useful ? "已记下" : "对我有用", systemImage: feedback == .useful ? "hand.thumbsup.fill" : "hand.thumbsup")
                }
                .accessibilityLabel("这条灵感对我有用")
                Spacer(minLength: 8)
                Button { feedback = .lessLikeThis } label: {
                    Label(feedback == .lessLikeThis ? "已减少" : "少一些这类", systemImage: "minus.circle")
                }
                .accessibilityLabel("减少这类灵感")
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(Theme.secondary)
            .buttonStyle(.plain)
            if let feedback {
                Text(feedback.acknowledgement).font(.caption).foregroundStyle(Theme.accent)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
    }
}

private struct InspirationDetailView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let item: InspirationEntry
    @Binding var feedback: InspirationFeedback?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ContentSymbol(item.symbol, large: true)
                SectionEyebrow(item.category)
                Text(item.title).font(.title.bold()).foregroundStyle(Theme.ink)
                Text(item.subtitle).font(.body).foregroundStyle(Theme.secondary)
                SurfaceCard {
                    VStack(alignment: .leading, spacing: 16) {
                        SectionEyebrow("可以这样开始")
                        ForEach(Array(item.ideas.enumerated()), id: \.offset) { index, idea in
                            HStack(alignment: .top, spacing: 12) {
                                Text("0\(index + 1)").font(.caption.monospaced()).foregroundStyle(Theme.accent)
                                Text(idea).font(.body).foregroundStyle(Theme.ink).lineSpacing(4)
                            }
                        }
                    }
                }
                Text(item.reason).font(.caption).foregroundStyle(Theme.secondary)
                InspirationFeedbackControls(feedback: $feedback)
                PrimaryButton("和 Aria 一起试试") {
                    dismiss()
                    store.openChat(context: "帮我展开这个想法：\(item.title)。")
                }
                SampleDataFootnote()
            }
            .padding(20)
        }
        .background(Theme.background)
        .navigationTitle("灵感详情")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Goals

struct GoalsView: View {
    @EnvironmentObject var store: AppStore
    @State private var goals = GoalEntry.samples

    private var completedCount: Int { goals.filter { $0.isComplete }.count }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    ContentIntro(eyebrow: "方向清晰，一步一步来", title: "目标", subtitle: "把长期方向和下一步行动放在一起。")
                    HStack(spacing: 12) {
                        GoalStatistic(value: "\(goals.count - completedCount)", label: "正在推进")
                        GoalStatistic(value: "\(completedCount)", label: "已经完成")
                    }
                    SectionEyebrow("我的目标")
                    ForEach($goals) { $goal in
                        NavigationLink {
                            GoalDetailView(goal: $goal)
                        } label: {
                            GoalCard(goal: goal)
                        }
                        .buttonStyle(.plain)
                    }
                    SampleDataFootnote()
                }
                .padding(20)
            }
            .background(Theme.background)
            .navigationTitle("Aria")
            .navigationBarTitleDisplayMode(.inline)
            .modifier(AriaStatusToolbar())
        }
    }
}

private struct GoalStep: Identifiable {
    let id: String
    let title: String
    var isComplete: Bool
    var weight = 1.0
}

private struct GoalEntry: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let symbol: String
    let pace: String
    let motivation: String
    var steps: [GoalStep]
    var completedSteps: Int { steps.filter(\.isComplete).count }
    var progress: Double {
        let total = steps.reduce(0) { $0 + $1.weight }
        guard total > 0 else { return 0 }
        return steps.filter(\.isComplete).reduce(0) { $0 + $1.weight } / total
    }
    var isComplete: Bool { !steps.isEmpty && completedSteps == steps.count }
    var nextStep: String { steps.first { !$0.isComplete }?.title ?? "所有小步骤都完成了，给自己一点掌声。" }

    static let samples: [GoalEntry] = [
        .init(id: "aria", title: "把 Aria 打造成 Muse-like 个人助手", subtitle: "移动端 · 生活连接器 · 语音模式", symbol: "square.grid.2x2", pace: "当前：前端体验设计", motivation: "围绕移动端、生活连接器与语音模式，逐步形成完整的个人助手体验。", steps: [.init(id: "plan", title: "完成总体方案", isComplete: true, weight: 15), .init(id: "voice", title: "设计主界面与语音通话", isComplete: true, weight: 20), .init(id: "details", title: "补齐细节与状态", isComplete: false, weight: 25), .init(id: "backend", title: "接入 Aria 后端", isComplete: false, weight: 40)]),
        .init(id: "english", title: "提升英语面试表达", subtitle: "用短练习积累稳定、自然的回答", symbol: "bubble.left.and.bubble.right", pace: "下一步：10 分钟口语练习", motivation: "用短而高频的练习，形成稳定、自然且有说服力的面试回答。", steps: [.init(id: "answer", title: "完成第一轮回答", isComplete: true, weight: 20), .init(id: "grammar", title: "修正一个核心语法点", isComplete: false, weight: 20), .init(id: "structure", title: "扩展回答结构", isComplete: false, weight: 30), .init(id: "recording", title: "录一段 45 秒以内的口语回答", isComplete: false, weight: 30)])
    ]
}

private struct GoalStatistic: View {
    let value: String
    let label: String
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 6) {
                Text(value).font(.largeTitle.weight(.light)).foregroundStyle(Theme.ink)
                Text(label).font(.caption).foregroundStyle(Theme.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct GoalCard: View {
    let goal: GoalEntry
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top, spacing: 12) {
                    ContentSymbol(goal.symbol)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(goal.title).font(.headline).foregroundStyle(Theme.ink)
                        Text(goal.subtitle).font(.subheadline).foregroundStyle(Theme.secondary)
                    }
                    Spacer(minLength: 2)
                    Text("\(Int((goal.progress * 100).rounded()))%")
                        .font(.subheadline.weight(.medium).monospacedDigit()).foregroundStyle(Theme.accent)
                }
                VStack(spacing: 8) {
                    ProgressView(value: goal.progress).tint(Theme.accent)
                        .accessibilityLabel("目标进度")
                    HStack {
                        Text(goal.isComplete ? "已完成" : goal.pace)
                        Spacer()
                        Text("\(goal.completedSteps) / \(goal.steps.count) 步")
                    }.font(.caption).foregroundStyle(Theme.secondary)
                }
                Text(goal.isComplete ? goal.nextStep : "下一步：\(goal.nextStep)")
                    .font(.caption).foregroundStyle(goal.isComplete ? Theme.accent : Theme.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct GoalDetailView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @Binding var goal: GoalEntry

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ContentSymbol(goal.symbol, large: true)
                Text(goal.title).font(.title2.bold()).foregroundStyle(Theme.ink)
                Text(goal.motivation).font(.body).foregroundStyle(Theme.secondary).lineSpacing(4)
                SurfaceCard {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(goal.isComplete ? "这件事，你做到了" : "一步一步来").font(.headline)
                            Spacer()
                            Text("\(Int((goal.progress * 100).rounded()))%").font(.subheadline.monospacedDigit()).foregroundStyle(Theme.accent)
                        }
                        ProgressView(value: goal.progress).tint(Theme.accent)
                        Text("已完成 \(goal.completedSteps) 个小步骤，共 \(goal.steps.count) 个。")
                            .font(.caption).foregroundStyle(Theme.secondary)
                    }
                }
                SectionEyebrow("小步骤清单")
                VStack(spacing: 10) {
                    ForEach($goal.steps) { $step in
                        Button { step.isComplete.toggle() } label: {
                            HStack(alignment: .center, spacing: 12) {
                                Image(systemName: step.isComplete ? "checkmark.circle.fill" : "circle")
                                    .font(.title3).foregroundStyle(step.isComplete ? Theme.accent : Theme.secondary)
                                Text(step.title).font(.body).foregroundStyle(Theme.ink)
                                    .strikethrough(step.isComplete, color: Theme.secondary.opacity(0.6))
                                Spacer(minLength: 0)
                            }
                            .padding(16)
                            .background(.white, in: RoundedRectangle(cornerRadius: 18))
                            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.line, lineWidth: 1))
                            .contentShape(RoundedRectangle(cornerRadius: 18))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(step.title)
                        .accessibilityValue(step.isComplete ? "已完成" : "未完成")
                        .accessibilityHint("轻点切换完成状态")
                    }
                }
                PrimaryButton("和 Aria 聊聊下一步") {
                    dismiss()
                    store.openChat(context: goal.isComplete ? "帮我回顾「\(goal.title)」的进展。" : "帮我继续推进「\(goal.title)」，下一步是\(goal.nextStep)。")
                }
                Text("勾选会立即更新目标进度，仅保存在本次演示中。")
                    .font(.caption).foregroundStyle(Theme.secondary)
                SectionEyebrow("动态时间线")
                SurfaceCard {
                    VStack(alignment: .leading, spacing: 16) {
                        if goal.id == "aria" {
                            StatusInformationRow(symbol: "circle.fill", title: "今天 · 补齐完整原型", detail: "新增登录、搜索、会话、连接器、目标和审批详情。")
                            StatusInformationRow(symbol: "circle.fill", title: "今天 · 统一白色主题", detail: "聊天、语音和电话页面保持一致视觉语言。")
                            StatusInformationRow(symbol: "circle.fill", title: "10 月 12 日 · 建立总体方案", detail: "明确三个工作流与阶段路线。")
                        } else {
                            StatusInformationRow(symbol: "circle.fill", title: "第一轮 · 建立回答框架", detail: "从 Why do you want this job? 开始练习。")
                            StatusInformationRow(symbol: "circle.fill", title: "下一步 · 继续口语练习", detail: "练习经验、结果与岗位匹配的清晰表达。")
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.background)
        .navigationTitle("目标详情")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Library

struct LibraryView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var filter: LibraryKind = .all
    @State private var search = ""
    @State private var files = LibraryEntry.samples

    private var matchingFiles: [LibraryEntry] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return files.filter {
            (filter == .all || $0.kind == filter) &&
            (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.summary.localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let count = geometry.size.width > 390 && !dynamicTypeSize.isAccessibilitySize ? 2 : 1
                libraryContent(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: count))
            }
            .background(Theme.background)
            .navigationTitle("Aria")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索文件名称或内容")
            .modifier(AriaStatusToolbar())
        }
    }

    private func libraryContent(columns: [GridItem]) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ContentIntro(eyebrow: "文件、方案与可交互产物", title: "资料库", subtitle: "集中查看对话中生成的文件、方案和可交互产物。")
                FilterSelector(selection: $filter)
                HStack {
                    SectionEyebrow(search.isEmpty ? "最近保存" : "搜索结果")
                    Spacer()
                    Text("\(matchingFiles.count) 个文件").font(.caption).foregroundStyle(Theme.secondary)
                }
                if matchingFiles.isEmpty {
                    emptyState
                } else {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                        ForEach(matchingFiles) { item in
                            NavigationLink {
                                LibraryDetailView(file: item, saved: savedBinding(for: item.id))
                            } label: {
                                LibraryFileCard(file: item)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                SampleDataFootnote()
            }
            .padding(20)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }

    private var emptyState: some View {
        SurfaceCard {
            VStack(spacing: 14) {
                Image(systemName: search.isEmpty ? filter.symbol : "magnifyingglass").font(.largeTitle.weight(.light)).foregroundStyle(Theme.secondary)
                Text(search.isEmpty ? "这里还没有\(filter.rawValue)" : "暂时没有找到匹配的文件")
                    .font(.headline).foregroundStyle(Theme.ink)
                Text(search.isEmpty ? "以后保存的\(filter.rawValue)会出现在这里。你可以先看看其他资料。" : "试试更短的关键词，或切换文件类型。")
                    .font(.subheadline).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
                Button("查看全部文件") { search = ""; filter = .all }
                    .font(.subheadline.weight(.medium)).foregroundStyle(Theme.accent)
                    .padding(.vertical, 8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        }
    }

    private func savedBinding(for id: String) -> Binding<Bool> {
        Binding(get: { files.first { $0.id == id }?.isSaved ?? false }, set: { value in
            guard let index = files.firstIndex(where: { $0.id == id }) else { return }
            files[index].isSaved = value
        })
    }
}

private enum LibraryKind: String, CaseIterable, Identifiable, ContentFilter {
    case all = "全部"
    case document = "文档"
    case prototype = "原型"
    case image = "图片"
    case audio = "音频"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .all: "square.grid.2x2"
        case .document: "doc.text"
        case .image: "photo"
        case .prototype: "rectangle.3.group"
        case .audio: "waveform"
        }
    }
}

private struct LibraryEntry: Identifiable {
    let id: String
    let title: String
    let summary: String
    let kind: LibraryKind
    let metadata: String
    let date: String
    let contents: [String]
    var isSaved = false
    static let samples: [LibraryEntry] = [
        .init(id: "plan", title: "个人助手 App 总体方案", summary: "把移动端、生活连接器与语音模式放在同一份路线图中。", kind: .document, metadata: "Markdown", date: "今天", contents: ["第一阶段聚焦可用的移动体验：聊天优先、关键操作先确认。", "语音通话覆盖听取、思考、回答与打断。", "把移动端、生活连接器与语音模式放在统一的工作流与阶段路线里。"]),
        .init(id: "prototype", title: "Aria 前端原型", summary: "用于验证导航、对话、语音通话、审批与设置流程。", kind: .prototype, metadata: "Artifact · 交互原型", date: "刚刚", contents: ["当前原型包含五个主入口：聊天、动态、灵感、目标与资料库。", "补齐登录引导、会话搜索、连接器、目标详情与审批详情。", "App 内语音和电话网络呼叫均为本地交互演示，没有真实连接。"]),
        .init(id: "roadmap", title: "个人助手模式迭代计划", summary: "从使用反馈出发，逐步补齐个人助手能力。", kind: .document, metadata: "Markdown", date: "10 月 12 日", contents: ["先验证真实使用场景，再分阶段加入个人数据连接、移动端能力与语音交互。", "保持每一步都可验证，优先让核心体验形成闭环。", "当前阶段先完成交互原型；后端接入属于之后的工作。"])
    ]
}

private struct LibraryFileCard: View {
    let file: LibraryEntry
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    ContentSymbol(file.kind.symbol)
                    Spacer()
                    if file.isSaved {
                        Image(systemName: "bookmark.fill").font(.caption).foregroundStyle(Theme.accent).accessibilityLabel("已收藏")
                    }
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.secondary)
                }
                VStack(alignment: .leading, spacing: 7) {
                    Text(file.title).font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(file.metadata) · \(file.date)").font(.caption2).foregroundStyle(Theme.secondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct LibraryDetailView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let file: LibraryEntry
    @Binding var saved: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    ContentSymbol(file.kind.symbol, large: true)
                    Spacer()
                    Button { saved.toggle() } label: {
                        Label(saved ? "已收藏" : "收藏", systemImage: saved ? "bookmark.fill" : "bookmark")
                            .font(.subheadline.weight(.medium)).foregroundStyle(Theme.accent)
                    }
                    .accessibilityHint("仅保存在本次演示中")
                }
                Text(file.title).font(.title.bold()).foregroundStyle(Theme.ink)
                Text("\(file.metadata) · \(file.date)保存").font(.caption).foregroundStyle(Theme.secondary)
                if file.kind == .prototype { visualPreview }
                SurfaceCard {
                    VStack(alignment: .leading, spacing: 18) {
                        SectionEyebrow("示例文件预览")
                        ForEach(file.contents, id: \.self) { paragraph in
                            Text(paragraph).font(.body).foregroundStyle(Theme.ink).lineSpacing(6)
                            if paragraph != file.contents.last { Divider().overlay(Theme.line) }
                        }
                    }
                }
                PrimaryButton("带着这份资料继续聊") {
                    dismiss()
                    store.openChat(context: "继续完善《\(file.title)》。")
                }
                Text("这是本地示例内容，没有上传或下载真实文件。")
                    .font(.caption).foregroundStyle(Theme.secondary)
            }
            .padding(20)
        }
        .background(Theme.background)
        .navigationTitle("资料详情")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var visualPreview: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack {
                AriaMark(size: 34)
                Text("Aria").font(.title2.weight(.medium)).foregroundStyle(Theme.ink)
                Spacer()
                Text("交互预览").font(.caption).foregroundStyle(Theme.secondary)
            }
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 12).fill(Theme.line.opacity(0.5))
                RoundedRectangle(cornerRadius: 12).fill(Theme.line.opacity(0.8))
                RoundedRectangle(cornerRadius: 12).fill(Theme.accent.opacity(0.14))
            }
            .frame(height: 74)
            Text("聊天 · 动态 · 灵感 · 目标 · 资料库").font(.caption).foregroundStyle(Theme.secondary)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 22))
        .overlay(RoundedRectangle(cornerRadius: 22).stroke(Theme.line, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Aria 原型示意图，包含聊天、动态、灵感、目标和资料库五个入口")
    }
}

// MARK: - Aria status sheet

struct StatusView: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var segment: StatusSegment = .activity
    @State private var dailyReminder = false

    private var pendingCount: Int {
        store.approvals.filter { item in
            if case .pending = item.status { return true }
            return false
        }.count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    statusHeader
                    Picker("Aria 状态分类", selection: $segment) {
                        ForEach(StatusSegment.allCases) { item in
                            Text(item.rawValue).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)
                    statusContent
                    SampleDataFootnote()
                }
                .padding(20)
            }
            .background(Color.white)
            .navigationTitle("状态")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("关闭") { dismiss() }
                        .foregroundStyle(Theme.secondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape").foregroundStyle(Theme.ink)
                    }
                    .accessibilityLabel("打开设置")
                }
            }
        }
    }

    private var statusHeader: some View {
        HStack(alignment: .center, spacing: 16) {
            Text("G")
                .font(.title2.weight(.medium)).foregroundStyle(.white)
                .frame(width: 54, height: 54)
                .background(Theme.ink, in: Circle())
                .accessibilityLabel("示例用户头像")
            VStack(alignment: .leading, spacing: 6) {
                Text("Aria 正在工作").font(.title3.weight(.semibold)).foregroundStyle(Theme.ink)
                HStack(spacing: 6) {
                    Circle().fill(Theme.accent).frame(width: 6, height: 6)
                    Text("演示模式 · 本地运行").font(.caption).foregroundStyle(Theme.secondary)
                }
            }
        }
        .padding(.vertical, 10)
    }

    @ViewBuilder private var statusContent: some View {
        switch segment {
        case .activity: activityContent
        case .approvals: approvalsContent
        case .schedule: scheduleContent
        case .identity: identityContent
        }
    }

    private var activityContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionEyebrow("正在为你留意")
            SurfaceCard {
                VStack(alignment: .leading, spacing: 18) {
                    StatusInformationRow(symbol: "sparkles", title: "刚刚更新前端原型", detail: "完成五个主导航与全屏语音通话交互。")
                    Divider().overlay(Theme.line)
                    StatusInformationRow(symbol: "doc.text", title: "总体方案已整理", detail: "移动端、生活连接器和语音模式已合并到统一方案。")
                    Divider().overlay(Theme.line)
                    StatusInformationRow(symbol: "checkmark.shield", title: "重要的事，先问过你", detail: pendingCount == 0 ? "目前没有等待你确认的事项。" : "有 \(pendingCount) 项示例操作等待你确认。")
                }
            }
            Button {
                store.selectedTab = .activity
                dismiss()
            } label: {
                Label("查看全部动态", systemImage: "arrow.right").font(.subheadline.weight(.medium))
            }
            .foregroundStyle(Theme.accent)
            .padding(.vertical, 8)
        }
    }

    private var approvalsContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionEyebrow("由你来决定")
            Text("这里只演示确认流程，批准后不会发送消息、付款或修改外部数据。")
                .font(.caption).foregroundStyle(Theme.secondary)
            if store.approvals.isEmpty {
                SurfaceCard {
                    StatusInformationRow(symbol: "checkmark.circle", title: "暂时没有待确认事项", detail: "需要你点头的时候，我会在这里告诉你。")
                }
            } else {
                ForEach(store.approvals) { approval in
                    ApprovalContentCard(approval: approval) { approved in
                        store.decideApproval(id: approval.id, approved: approved)
                    }
                }
            }
            if pendingCount == 0 && !store.approvals.isEmpty {
                Label("所有示例事项都已处理", systemImage: "checkmark.circle")
                    .font(.caption).foregroundStyle(Theme.accent)
            }
        }
    }

    private var scheduleContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionEyebrow("今天的安排")
            SurfaceCard {
                VStack(alignment: .leading, spacing: 20) {
                    ScheduleContentRow(time: "18:30", title: "继续完善 Aria 前端体验", detail: "验证核心路径、内容详情与交互状态。", symbol: "calendar")
                }
            }
            SurfaceCard {
                VStack(alignment: .leading, spacing: 8) {
                    Toggle("每日轻提醒", isOn: $dailyReminder).tint(Theme.accent)
                    Text(dailyReminder ? "已开启本地演示提醒状态，不会推送通知。" : "关闭状态。开启后仅展示本地状态变化。")
                        .font(.caption).foregroundStyle(Theme.secondary)
                }
            }
            PrimaryButton("和 Aria 调整安排") {
                dismiss()
                store.openChat(context: "帮我调整今天 18:30 的安排：继续完善 Aria 前端体验。")
            }
        }
    }

    private var identityContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionEyebrow("你的私人助手")
            SurfaceCard {
                VStack(alignment: .leading, spacing: 20) {
                    StatusInformationRow(symbol: "person.crop.circle", title: "你的个人助手", detail: "专注项目推进、信息整理、生活事务与语音协作；关键操作始终先确认。")
                    Divider().overlay(Theme.line)
                    StatusInformationRow(symbol: "hand.raised", title: "始终由你掌控", detail: "涉及对外操作时，先把内容和影响说明白。")
                    Divider().overlay(Theme.line)
                    StatusInformationRow(symbol: "internaldrive", title: "这是一份交互原型", detail: "当前内容来自本地示例，没有连接邮箱、日历或真实账号。")
                }
            }
            SurfaceCard {
                VStack(spacing: 14) {
                    IdentityFactRow(label: "默认语言", value: "中文")
                    IdentityFactRow(label: "主动权限", value: "重要事项提醒")
                    IdentityFactRow(label: "高风险操作", value: "始终确认")
                    IdentityFactRow(label: "记忆范围", value: "由你管理")
                }
            }
            NavigationLink {
                SettingsView()
            } label: {
                Label("设置与偏好", systemImage: "slider.horizontal.3")
                    .font(.subheadline.weight(.medium)).foregroundStyle(Theme.accent)
                    .padding(.vertical, 8)
            }
        }
    }
}

private enum StatusSegment: String, CaseIterable, Identifiable {
    case activity = "动态"
    case approvals = "待审批"
    case schedule = "日程"
    case identity = "身份"
    var id: String { rawValue }
}

private struct ApprovalContentCard: View {
    let approval: ApprovalItem
    var showsDetailLink = true
    let onDecision: (Bool) -> Void

    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                Text(approval.title).font(.headline).foregroundStyle(Theme.ink)
                Text(approval.detail).font(.subheadline).foregroundStyle(Theme.secondary)
                if showsDetailLink {
                    NavigationLink {
                        ContentApprovalDetailView(approvalID: approval.id)
                    } label: {
                        Label("查看操作范围与审批详情", systemImage: "arrow.up.right")
                            .font(.caption).foregroundStyle(Theme.accent)
                    }
                }
                switch approval.status {
                case .pending:
                    HStack(spacing: 12) {
                        Button("暂不批准") { onDecision(false) }
                            .buttonStyle(.bordered).tint(Theme.secondary)
                        Button("允许") { onDecision(true) }
                            .buttonStyle(.borderedProminent).tint(Theme.ink)
                    }
                    .controlSize(.regular)
                case .approved:
                    Label("已批准 · 仅演示", systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(Theme.accent)
                case .rejected:
                    Label("已拒绝 · 未执行", systemImage: "xmark.circle").font(.caption).foregroundStyle(Theme.secondary)
                }
            }
        }
    }
}

private struct ContentApprovalDetailView: View {
    @EnvironmentObject var store: AppStore
    let approvalID: UUID

    private var approval: ApprovalItem? {
        store.approvals.first { $0.id == approvalID }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let approval {
                    SectionEyebrow(approval.status == .pending ? "等待你的决定" : "已记录你的决定")
                    Text(approval.title).font(.title2.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text("关键操作先说明范围与影响，由你决定是否继续。")
                        .font(.subheadline).foregroundStyle(Theme.secondary)
                    ApprovalContentCard(approval: approval, showsDetailLink: false) { approved in
                        store.decideApproval(id: approval.id, approved: approved)
                    }
                    SurfaceCard {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionEyebrow("为什么需要确认")
                            Text("持续访问或对外操作需要明确的授权。正式接入后，应展示读取范围、运行频率与撤销入口。当前页面只演示确认状态。")
                                .font(.body).foregroundStyle(Theme.secondary).lineSpacing(4)
                        }
                    }
                    SampleDataFootnote()
                } else {
                    ContentIntro(eyebrow: "审批记录", title: "这项记录已不存在", subtitle: "返回后可以查看当前的待审批事项。")
                }
            }
            .padding(20)
        }
        .background(Theme.background)
        .navigationTitle("审批详情")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct IdentityFactRow: View {
    let label: String
    let value: String
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(Theme.secondary)
            Spacer(minLength: 12)
            Text(value).foregroundStyle(Theme.ink)
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }
}

private struct StatusInformationRow: View {
    let symbol: String
    let title: String
    let detail: String
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).font(.title3).foregroundStyle(Theme.accent).frame(width: 28)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(detail).font(.subheadline).foregroundStyle(Theme.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ScheduleContentRow: View {
    let time: String
    let title: String
    let detail: String
    let symbol: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(time).font(.caption.monospacedDigit()).foregroundStyle(Theme.accent)
            StatusInformationRow(symbol: symbol, title: title, detail: detail)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Shared helpers scoped to these screens

private protocol ContentFilter: Hashable, CaseIterable, Identifiable, RawRepresentable where RawValue == String {}

private struct FilterSelector<Filter: ContentFilter>: View where Filter.AllCases: RandomAccessCollection {
    @Binding var selection: Filter
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Filter.allCases) { item in
                Button { selection = item } label: {
                    Text(item.rawValue)
                        .font(.subheadline.weight(selection == item ? .semibold : .regular))
                        .foregroundStyle(selection == item ? Theme.ink : Theme.secondary)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity)
                        .background(selection == item ? Color.white : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                        .shadow(color: selection == item ? Color.black.opacity(0.04) : .clear, radius: 2, y: 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.rawValue)
                .accessibilityAddTraits(selection == item ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Color(red: 0.933, green: 0.933, blue: 0.941), in: RoundedRectangle(cornerRadius: 11))
    }
}

private struct ContentIntro: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionEyebrow(eyebrow)
            Text(title).font(.largeTitle.weight(.medium)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
            Text(subtitle).font(.subheadline).foregroundStyle(Theme.secondary).lineSpacing(4)
        }
        .padding(.top, 12)
        .padding(.bottom, 4)
    }
}

private struct ContentSymbol: View {
    let symbol: String
    var large = false
    init(_ symbol: String, large: Bool = false) {
        self.symbol = symbol
        self.large = large
    }
    var body: some View {
        Image(systemName: symbol)
            .font(large ? .title : .title3)
            .foregroundStyle(Theme.accent)
            .frame(width: large ? 64 : 42, height: large ? 64 : 42)
            .background(Theme.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: large ? 20 : 14))
            .accessibilityHidden(true)
    }
}

private struct SampleDataFootnote: View {
    var body: some View {
        Text("示例内容 · 所有操作仅在本地演示")
            .font(.caption2)
            .foregroundStyle(Theme.secondary.opacity(0.8))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
    }
}

private struct AriaStatusToolbar: ViewModifier {
    @EnvironmentObject var store: AppStore
    @State private var showsStatus = false
    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showsStatus = true } label: { AriaMark(size: 28) }
                        .accessibilityLabel("查看 Aria 的状态")
                }
            }
            .sheet(isPresented: $showsStatus) {
                StatusView().environmentObject(store)
            }
    }
}
