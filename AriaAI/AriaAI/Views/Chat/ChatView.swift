import SwiftUI
import AppKit

// MARK: - Generated File
struct GeneratedFile: Identifiable {
    let id = UUID()
    let fileName: String
    let fileType: String
    let filePath: String
    let slideCount: Int?
}

// MARK: - Skill Progress Stage

enum SkillStage {
    case idle
    case analyzing    // Claude 正在分析/思考
    case continuing   // 自动续接中
    case generating   // 工具执行中（生成文件）
    case done         // 文件已生成

    var icon: String {
        switch self {
        case .idle:       return "sparkles"
        case .analyzing:  return "brain"
        case .continuing: return "arrow.clockwise"
        case .generating: return "doc.badge.gearshape"
        case .done:       return "checkmark.circle.fill"
        }
    }
    var color: Color {
        switch self {
        case .idle:       return .onSurfaceVariant
        case .analyzing:  return .primary500
        case .continuing: return Color(red: 0.46, green: 0.62, blue: 0.98)
        case .generating: return Color(hex: "#F59E0B")
        case .done:       return Color(hex: "#10B981")
        }
    }
}

// MARK: - Chat Mode

enum ChatMode: String, CaseIterable, Identifiable {
    case concise     = "Concise"
    case detailed    = "Detailed"
    case stepByStep  = "Step-by-step"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .concise:    return "text.line.first.and.arrowtriangle.forward"
        case .detailed:   return "text.alignleft"
        case .stepByStep: return "list.number"
        }
    }

    func label(for lang: AppLanguage) -> String {
        switch self {
        case .concise:    return lang.t("简洁", "Concise")
        case .detailed:   return lang.t("详细", "Detailed")
        case .stepByStep: return lang.t("分步骤", "Step-by-step")
        }
    }

    func desc(for lang: AppLanguage) -> String {
        switch self {
        case .concise:    return lang.t("简短回复，不超过 3 句", "Brief reply, max 3 sentences")
        case .detailed:   return lang.t("全面深入分析", "Comprehensive in-depth analysis")
        case .stepByStep: return lang.t("分步骤拆解说明", "Step-by-step breakdown")
        }
    }

    func prefix(for lang: AppLanguage) -> String {
        switch self {
        case .concise:    return lang.t("[请简短回答，不超过3句话]\n\n", "[Be concise — max 3 sentences]\n\n")
        case .detailed:   return lang.t("[请提供全面详尽的分析]\n\n", "[Provide a comprehensive, in-depth analysis]\n\n")
        case .stepByStep: return lang.t("[请分步骤详细说明]\n\n", "[Explain step by step in detail]\n\n")
        }
    }
}

// MARK: - ChatView

struct ChatView: View {
    @EnvironmentObject var dataStore: DataStore
    @EnvironmentObject var appState: AppStateManager
    @Environment(\.appLanguage) var lang

    @State private var messages: [ChatMessage] = []
    @State private var inputText = ""
    @State private var isStreaming = false
    @State private var streamingText = ""
    @State private var isOutputTruncated = false  // 输出是否被截断
    @State private var pendingContinueContent = ""  // 等待继续的上下文
    @State private var toolExecutingName: String? = nil
    @State private var toolExecutingMessage: String? = nil
    @State private var generatedFiles: [GeneratedFile] = []
    @State private var skillStage: SkillStage = .idle
    @State private var currentConversationId: Int? = nil
    @State private var selectedSkillId: Int? = nil
    @State private var isLoadingHistory = false

    // Export
    @State private var showExportPanel = false

    // Sidebar
    @State private var sidebarCollapsed = false

    // Toolbar state
    @State private var selectedMode: ChatMode? = nil
    @State private var showSkillPicker = false
    @State private var showModePicker = false
    @State private var showContextPicker = false
    @State private var showDocPicker = false
    @State private var selectedDocIds: [Int] = []
    @State private var inputHeight: CGFloat = ChatTextField.minH

    // Welcome page animation
    @State private var welcomeHeroVisible = false
    @State private var welcomeCardsVisible = false

    private var selectedProjectId: Int? {
        guard let proj = appState.selectedProject,
              let api = dataStore.apiProjects.first(where: { $0.name == proj.name })
        else { return nil }
        return api.id
    }

    var body: some View {
        HStack(spacing: 0) {
            // Left — conversation history sidebar
            if sidebarCollapsed {
                collapsedSidebarStrip
            } else {
                conversationSidebar
            }

            Divider()

            // Right — main chat
            VStack(spacing: 0) {
                // Breadcrumb
                HStack(spacing: Spacing.xs) {
                    // 折叠/展开按钮
                    Button {
                        sidebarCollapsed.toggle()
                    } label: {
                        Image(systemName: sidebarCollapsed ? "sidebar.left" : "sidebar.left")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.onSurfaceVariant)
                            .rotationEffect(.degrees(sidebarCollapsed ? 180 : 0))
                    }
                    .buttonStyle(.plain)
                    .help(sidebarCollapsed ? lang.t("展开对话历史", "Show History") : lang.t("收起对话历史", "Hide History"))

                    Rectangle().fill(Color.outlineVariant.opacity(0.3)).frame(width: 1, height: 14)

                    Text(lang.t("工作流", "WORKSTREAM"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.5)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                    Text(appState.selectedProject?.name ?? lang.t("新建对话", "New Chat"))
                        .font(TextStyle.labelMD).foregroundColor(.onSurface)
                    Spacer()
                    if isStreaming {
                        HStack(spacing: 4) {
                            ProgressView().controlSize(.mini)
                            Text(lang.t("思考中…", "Thinking…")).font(TextStyle.labelSM).foregroundColor(.primary500)
                        }
                    }
                    // Export button
                    Button { showExportPanel = true } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 12))
                            .foregroundColor(.onSurfaceVariant)
                            .frame(width: 28, height: 28)
                    }
                    .buttonStyle(.plain)
                    .disabled(messages.isEmpty)
                    .help(lang.t("导出对话", "Export conversation"))
                    .popover(isPresented: $showExportPanel, arrowEdge: .bottom) {
                        exportPopover
                    }
                }
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm)
                .background(.surfaceContainerLowest)
                .overlay(Divider(), alignment: .bottom)

                // Messages
                ScrollViewReader { proxy in
                    ZStack {
                        if messages.isEmpty && !isStreaming && !isLoadingHistory {
                            welcomeView
                        } else {
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: Spacing.xl) {
                                    ForEach(Array(messages.enumerated()), id: \.element.id) { index, message in
                                        MessageRow(
                                            message: message,
                                            onCopy: {
                                                NSPasteboard.general.clearContents()
                                                NSPasteboard.general.setString(message.content, forType: .string)
                                            },
                                            onRetry: {
                                                guard message.role == .assistant else { return }
                                                for i in stride(from: index - 1, through: 0, by: -1) {
                                                    if messages[i].role == .user {
                                                        let content = messages[i].content
                                                        messages = Array(messages[..<i])
                                                        inputText = content
                                                        Task { await sendMessage() }
                                                        break
                                                    }
                                                }
                                            }
                                        )
                                        .id(message.id)
                                    }
                                    if isStreaming && !streamingText.isEmpty {
                                        streamingRow
                                            .id("streaming")
                                    }
                                    
                                    // 输出被截断提示
                                    if isOutputTruncated && !isStreaming {
                                        truncatedWarningView
                                            .id("truncated")
                                    }
                                }
                                .padding(Spacing.xxl)
                            }
                            .background(.surfaceBase)
                            .onChange(of: messages.count) {
                                proxy.scrollTo(messages.last?.id, anchor: .bottom)
                            }
                            .onChange(of: streamingText) {
                                proxy.scrollTo("streaming", anchor: .bottom)
                            }
                            .onChange(of: isOutputTruncated) { _, newValue in
                                if newValue {
                                    proxy.scrollTo("truncated", anchor: .bottom)
                                }
                            }
                        }

                        if isLoadingHistory {
                            VStack(spacing: Spacing.sm) {
                                ProgressView()
                                    .controlSize(.regular)
                                    .tint(.primary500)
                                Text(lang.t("加载中…", "Loading…"))
                                    .font(TextStyle.labelSM)
                                    .foregroundColor(.onSurfaceVariant)
                            }
                            .padding(Spacing.xl)
                            .background(.surfaceContainerLowest)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                            .shadow(color: .black.opacity(0.06), radius: 8, y: 2)
                        }
                    }
                }

                inputBar
            }
        }
        .task { await dataStore.loadConversations() }
        .onChange(of: appState.pendingNewConversation) {
            if appState.pendingNewConversation {
                appState.pendingNewConversation = false
                Task { await newConversation() }
            }
        }
        .onChange(of: appState.pendingConversationId) {
            if let convId = appState.pendingConversationId {
                appState.pendingConversationId = nil
                currentConversationId = convId
                messages = []
                inputText = ""
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("NewConversation"))) { _ in
            Task { await newConversation() }
        }
    }

    // MARK: - Welcome / empty state

    private var workflowSkills: [APISkill] {
        dataStore.apiSkills.filter { $0.category == "guided_workflow" }
    }
    private var regularSkills: [APISkill] {
        dataStore.apiSkills.filter { $0.category != "guided_workflow" }.prefix(6).map { $0 }
    }

    private var welcomeView: some View {
        ScrollView {
            VStack(spacing: Spacing.xxl) {
                // Hero — 渐入 + 向上浮
                VStack(spacing: Spacing.md) {
                    ZStack {
                        // 光晕背景
                        Circle()
                            .fill(Color.primary500.opacity(0.12))
                            .frame(width: 88, height: 88)
                            .blur(radius: 20)
                        Circle()
                            .fill(LinearGradient(colors: [.primary600, .primary500], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 56, height: 56)
                        Image(systemName: "sparkles")
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundColor(.white)
                    }
                    .scaleEffect(welcomeHeroVisible ? 1 : 0.7)
                    .opacity(welcomeHeroVisible ? 1 : 0)
                    .animation(.spring(response: 0.5, dampingFraction: 0.65), value: welcomeHeroVisible)

                    Text(lang.t("不止聊天，搞定一切", "Beyond Chat — Get Things Done"))
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(.onSurface)
                        .opacity(welcomeHeroVisible ? 1 : 0)

                    Text(lang.t("本地运行 · 自主规划 · 安全可控", "Local · Autonomous · Secure"))
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                        .opacity(welcomeHeroVisible ? 1 : 0)
                }
                .padding(.top, Spacing.xxl)

                // Guided Workflow skills — featured row
                if !workflowSkills.isEmpty {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 11, weight: .semibold)).foregroundColor(.primary500)
                            Text(lang.t("专家工作流", "Guided Workflows"))
                                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.5)
                            Text(lang.t("新", "NEW"))
                                .font(.system(size: 9, weight: .bold)).foregroundColor(.white)
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Color.primary500)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }

                        LazyVGrid(
                            columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
                            spacing: Spacing.sm
                        ) {
                            ForEach(workflowSkills) { skill in
                                welcomeWorkflowCard(skill)
                            }
                        }
                    }
                    .padding(.horizontal, Spacing.xxl)
                }

                // Regular skills
                if !regularSkills.isEmpty {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(lang.t("快速启动", "Quick Start"))
                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.5)

                        LazyVGrid(
                            columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
                            spacing: Spacing.sm
                        ) {
                            ForEach(regularSkills) { skill in
                                welcomeSkillCard(skill)
                            }
                        }
                    }
                    .padding(.horizontal, Spacing.xxl)
                }

                Spacer(minLength: Spacing.xxl)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.surfaceBase)
        .onAppear {
            welcomeHeroVisible = false
            welcomeCardsVisible = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                welcomeHeroVisible = true
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                welcomeCardsVisible = true
            }
        }
        .onDisappear {
            welcomeHeroVisible = false
            welcomeCardsVisible = false
        }
    }

    @ViewBuilder
    private func welcomeWorkflowCard(_ skill: APISkill) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 9)).foregroundColor(.primary500)
                Text("@\(skill.localizedName(for: lang))")
                    .font(TextStyle.labelMD).foregroundColor(.primary600).lineLimit(1)
            }
            Text(skill.localizedDescription(for: lang))
                .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primaryFixed)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(Color.primary500.opacity(0.25), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: Radius.md))
        .onTapGesture {
            selectedSkillId = skill.id
            inputText = skill.userTemplate.isEmpty ? "@\(skill.name) " : skill.userTemplate
        }
    }

    @ViewBuilder
    private func welcomeSkillCard(_ skill: APISkill) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("@\(skill.localizedName(for: lang))")
                .font(TextStyle.labelMD).foregroundColor(.primary500).lineLimit(1)
            Text(skill.localizedDescription(for: lang))
                .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surfaceContainerLowest)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(Color.outlineVariant.opacity(0.3), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: Radius.md))
        .onTapGesture {
            selectedSkillId = skill.id
            inputText = skill.userTemplate.isEmpty ? "@\(skill.name) " : skill.userTemplate
        }
    }

    // MARK: - Collapsed strip (收缩后的细条)

    private var collapsedSidebarStrip: some View {
        VStack(spacing: Spacing.lg) {
            // 新建对话
            Button {
                Task { await newConversation() }
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.primary500)
            }
            .buttonStyle(.plain)
            .help(lang.t("新建对话", "New Chat"))

            Divider().padding(.horizontal, 8)

            // 对话历史图标（小圆点代表各条对话）
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 6) {
                    ForEach(dataStore.conversations) { conv in
                        Circle()
                            .fill(currentConversationId == conv.id ? Color.primary500 : Color.onSurfaceVariant.opacity(0.25))
                            .frame(width: 6, height: 6)
                            .onTapGesture { Task { await loadConversation(conv) } }
                            .help(conv.title)
                    }
                }
                .padding(.vertical, 4)
            }

            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.top, Spacing.md)
        .frame(width: 40)
        .background(Color.surfaceContainerLowest)
    }

    // MARK: - Conversation Sidebar

    private var conversationSidebar: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(lang.t("对话历史", "Conversations"))
                    .font(TextStyle.labelMD).foregroundColor(.onSurface)
                Spacer()
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .background(.surfaceContainerLowest)

            Divider()

            if dataStore.conversations.isEmpty {
                VStack(spacing: Spacing.sm) {
                    Spacer()
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 24)).foregroundColor(.onSurfaceVariant.opacity(0.4))
                    Text(lang.t("暂无对话记录", "No conversations yet"))
                        .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    Spacer()
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(dataStore.conversations.enumerated()), id: \.element.id) { idx, conv in
                            ConversationRowView(
                                conversation: conv,
                                isSelected: currentConversationId == conv.id,
                                onSelect: {
                                    Task { await loadConversation(conv) }
                                },
                                onDelete: {
                                    Task {
                                        let deletedId = conv.id
                                        let wasActive = currentConversationId == deletedId
                                        await dataStore.deleteConversation(id: deletedId)
                                        if wasActive {
                                            await switchAfterDelete(deletedId: deletedId)
                                        }
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }
        .frame(width: 220)
        .background(.surfaceContainerLowest)
    }

    private func loadConversation(_ conv: APIConversation) async {
        guard currentConversationId != conv.id else { return }
        isLoadingHistory = true
        currentConversationId = conv.id
        let apiMessages = await dataStore.loadMessages(conversationId: conv.id)
        messages = apiMessages.map { $0.toLocal() }
        isLoadingHistory = false
    }

    private func newConversation() async {
        // Clear current state but keep UI responsive
        messages = []
        inputText = ""
        selectedSkillId = nil
        selectedMode = nil
        selectedDocIds = []
        
        // Start conversation creation (optimistically inserts into list immediately)
        let createTask = Task { await dataStore.createConversation() }
        
        // Immediately select the optimistic conversation from the list
        // This ensures list and detail appear simultaneously
        if let firstConv = dataStore.conversations.first {
            currentConversationId = firstConv.id
        }
        
        // Wait for API to complete and get real conversation
        if let conv = await createTask.value {
            // Update to the real conversation ID if it changed
            if currentConversationId != conv.id {
                currentConversationId = conv.id
            }
        }
    }

    /// 删除后兜底：切到下一条已有对话，若列表空才新建
    private func switchAfterDelete(deletedId: Int) async {
        let remaining = dataStore.conversations.filter { $0.id != deletedId }
        if let next = remaining.first {
            await loadConversation(next)
        } else {
            // 列表彻底空了，复用现有空对话或新建
            if let empty = dataStore.conversations.first(where: { $0.title == "New Workstream" && $0.id != deletedId }) {
                currentConversationId = empty.id
                messages = []
            } else {
                await newConversation()
            }
        }
    }

    // MARK: - Streaming row

    private var streamingRow: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [.primary600, .primary500], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 32, height: 32)
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
            }
            .frame(width: 32)
            
            VStack(alignment: .leading, spacing: Spacing.md) {
                // 工具执行状态
                if selectedSkillId != nil && skillStage != .idle {
                    skillProgressCard
                }
                
                // 生成的文件
                if !generatedFiles.isEmpty {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text("已生成文件：")
                            .font(TextStyle.labelMD)
                            .foregroundColor(.onSurfaceVariant)
                        
                        ForEach(generatedFiles) { file in
                            HStack(spacing: Spacing.sm) {
                                Image(systemName: file.fileType == "pptx" ? "play.rectangle.fill" : "doc.text.fill")
                                    .font(.system(size: 14))
                                    .foregroundColor(.primary500)
                                Text(file.fileName)
                                    .font(TextStyle.bodySM)
                                if let count = file.slideCount {
                                    Text("(\(count)页)")
                                        .font(TextStyle.labelSM)
                                        .foregroundColor(.onSurfaceVariant)
                                }
                                Spacer()
                                Button {
                                    Task { await downloadAndOpen(file) }
                                } label: {
                                    HStack(spacing: 4) {
                                        Image(systemName: "arrow.down.circle.fill")
                                        Text("下载")
                                    }
                                    .font(TextStyle.labelSM)
                                    .foregroundColor(.white)
                                    .padding(.horizontal, Spacing.sm)
                                    .padding(.vertical, 4)
                                    .background(RoundedRectangle(cornerRadius: Radius.sm).fill(Color.primary500))
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, Spacing.sm)
                            .padding(.vertical, 4)
                            .background(Color.surfaceContainerHigh)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(Color.surfaceContainerLow)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
                }
                
                // 流式输出使用容错模式解析 Markdown
                if !streamingText.isEmpty {
                    MarkdownView(text: streamingText, isStreaming: true)
                }
            }
        }
    }
    
    // MARK: - Skill Progress Card

    private func skillStageIndex(_ s: SkillStage) -> Int {
        switch s {
        case .idle:       return -1
        case .analyzing:  return 0
        case .continuing: return 1
        case .generating: return 2
        case .done:       return 3
        }
    }

    private func skillStepCircle(icon: String, isDone: Bool, isActive: Bool) -> some View {
        ZStack {
            Circle()
                .fill(isDone ? Color(hex: "#10B981") : isActive ? Color.primary500 : Color.outlineVariant.opacity(0.4))
                .frame(width: 28, height: 28)
            if isDone {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white)
            } else {
                Image(systemName: icon)
                    .font(.system(size: 11))
                    .foregroundColor(isActive ? .white : .onSurfaceVariant.opacity(0.4))
            }
        }
    }

    private var skillProgressHint: String {
        switch skillStage {
        case .done:       return lang.t("文件生成完毕，点击下载按钮保存到本地。", "File ready — click Download to save.")
        case .generating: return lang.t("正在生成 PPT 文件，请勿关闭窗口…", "Generating PPT, please keep this window open…")
        case .continuing: return lang.t("内容较多，自动分段处理中…", "Content is large, processing in segments…")
        default:          return lang.t("正在理解您的业务背景与需求…", "Understanding your business context…")
        }
    }

    private var skillProgressCard: some View {
        let steps: [(icon: String, label: String, stage: SkillStage)] = [
            ("magnifyingglass",       lang.t("分析需求", "Analyzing"), .analyzing),
            ("arrow.clockwise",       lang.t("整理内容", "Composing"), .continuing),
            ("doc.badge.gearshape",   lang.t("生成文件", "Building"),  .generating),
            ("checkmark.circle.fill", lang.t("已完成",   "Done"),      .done),
        ]
        let current = skillStageIndex(skillStage)
        let borderColor = skillStage == .done ? Color(hex: "#10B981").opacity(0.3) : Color.primary500.opacity(0.15)

        return VStack(alignment: .leading, spacing: Spacing.md) {
            skillProgressHeader
            skillProgressSteps(steps: steps, current: current)
            Text(skillProgressHint)
                .font(TextStyle.labelSM)
                .foregroundColor(skillStage == .done ? Color(hex: "#10B981") : .onSurfaceVariant)
        }
        .padding(Spacing.lg)
        .background(
            RoundedRectangle(cornerRadius: Radius.lg)
                .fill(Color.surfaceContainerLowest)
                .overlay(RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(borderColor, lineWidth: 1))
        )
    }

    private var skillProgressHeader: some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.primary500)
            Text(lang.t("正在处理您的请求", "Processing your request"))
                .font(TextStyle.labelSM.bold())
                .foregroundColor(.primary500)
            Spacer()
            if skillStage != .done {
                ProgressView().scaleEffect(0.65).frame(width: 14, height: 14)
            }
        }
    }

    private func skillProgressSteps(steps: [(icon: String, label: String, stage: SkillStage)], current: Int) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { idx, step in
                let stepIdx = skillStageIndex(step.stage)
                let isDone = current > stepIdx
                let isActive = current == stepIdx
                VStack(spacing: 4) {
                    skillStepCircle(icon: step.icon, isDone: isDone, isActive: isActive)
                    Text(step.label)
                        .font(.system(size: 10))
                        .foregroundColor(isDone ? Color(hex: "#10B981") : isActive ? .primary500 : .onSurfaceVariant.opacity(0.5))
                }
                if idx < steps.count - 1 {
                    Rectangle()
                        .fill(isDone ? Color(hex: "#10B981").opacity(0.5) : Color.outlineVariant.opacity(0.3))
                        .frame(height: 1.5)
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, 18)
                }
            }
        }
    }

    // MARK: - Download generated file

    private func downloadAndOpen(_ file: GeneratedFile) async {
        guard !file.filePath.isEmpty else { return }
        do {
            let tempURL = try await APIClient.shared.downloadGeneratedFile(filePath: file.filePath)
            let panel = NSSavePanel()
            panel.nameFieldStringValue = file.fileName
            panel.allowedContentTypes = []
            await MainActor.run {
                if panel.runModal() == .OK, let dest = panel.url {
                    try? FileManager.default.removeItem(at: dest)
                    try? FileManager.default.copyItem(at: tempURL, to: dest)
                    NSWorkspace.shared.open(dest)
                }
            }
        } catch {
            // Silently ignore — user can retry
        }
    }

    // MARK: - Truncated warning

    private var truncatedWarningView: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            // 空白占位，与 AI 头像对齐
            Spacer().frame(width: 32)
            
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 12))
                        .foregroundColor(.statusOnHold)
                    Text(lang.t("输出已达到长度限制", "Output length limit reached"))
                        .font(TextStyle.bodySM)
                        .foregroundColor(.statusOnHold)
                }
                
                Button {
                    Task { await continueGeneration() }
                } label: {
                    HStack(spacing: Spacing.sm) {
                        Image(systemName: "arrow.forward.circle.fill")
                            .font(.system(size: 12))
                        Text(lang.t("继续生成", "Continue generating"))
                            .font(TextStyle.labelMD)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(
                        LinearGradient(
                            colors: [.primary600, .primary500],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
            }
            .padding(Spacing.md)
            .background(Color.statusOnHold.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.md)
                    .strokeBorder(Color.statusOnHold.opacity(0.3), lineWidth: 1)
            )
        }
    }

    // MARK: - Input bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.4)
            VStack(spacing: Spacing.sm) {
                // Active tags (skill + docs)
                if selectedSkillId != nil || !selectedDocIds.isEmpty {
                    HStack(spacing: Spacing.xs) {
                        if let sid = selectedSkillId,
                           let skill = dataStore.apiSkills.first(where: { $0.id == sid }) {
                            HStack(spacing: 4) {
                                Text("@\(skill.localizedName(for: lang))")
                                    .font(TextStyle.labelSM).foregroundColor(.primary500)
                                Image(systemName: "xmark")
                                    .font(.system(size: 9, weight: .bold)).foregroundColor(.primary500)
                                    .contentShape(Rectangle())
                                    .onTapGesture { selectedSkillId = nil }
                            }
                            .padding(.horizontal, Spacing.sm).padding(.vertical, 3)
                            .background(Color.primaryFixed)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.pill))
                        }
                        ForEach(selectedDocIds, id: \.self) { docId in
                            if let doc = dataStore.apiDocuments.first(where: { $0.id == docId }) {
                                HStack(spacing: 4) {
                                    Image(systemName: "doc.text").font(.system(size: 9)).foregroundColor(.primary500)
                                    Text(doc.name)
                                        .font(TextStyle.labelSM).foregroundColor(.primary500)
                                        .lineLimit(1)
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold)).foregroundColor(.primary500)
                                        .contentShape(Rectangle())
                                        .onTapGesture { selectedDocIds.removeAll { $0 == docId } }
                                }
                                .padding(.horizontal, Spacing.sm).padding(.vertical, 3)
                                .background(Color.primaryFixed)
                                .clipShape(RoundedRectangle(cornerRadius: Radius.pill))
                            }
                        }
                        Spacer()
                    }
                }

                // Text input
                HStack(alignment: .bottom, spacing: Spacing.sm) {
                    if let proj = appState.selectedProject {
                        HStack(spacing: 4) {
                            Circle().fill(Color.statusActive).frame(width: 6, height: 6)
                            Text(proj.name).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                        }
                        .padding(.horizontal, Spacing.sm).padding(.vertical, 4)
                        .background(Color.surfaceContainerHigh)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.pill))
                    }

                    ChatTextField(
                        text: $inputText,
                        dynamicHeight: $inputHeight,
                        placeholder: lang.t("描述任务，@ 调用技能，# 关联文档", "Describe task, @ for skills, # for context"),
                        isDisabled: isStreaming,
                        onSubmit: {
                            let trimmed = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !trimmed.isEmpty, !isStreaming else { return }
                            Task { await sendMessage() }
                        },
                        onChange: { newText in
                            if newText.last == "@" && !showSkillPicker { showSkillPicker = true }
                            if newText.last == "#" && !showContextPicker { showContextPicker = true }
                            if newText.last == "/" && !showDocPicker { showDocPicker = true }
                        }
                    )
                    .frame(height: inputHeight)

                    Spacer()

                    HStack(spacing: Spacing.md) {
                        Image(systemName: "paperclip")
                            .font(.system(size: 14))
                            .foregroundColor(.onSurfaceVariant)
                        Image(systemName: "at")
                            .font(.system(size: 14))
                            .foregroundColor(selectedSkillId != nil ? .primary500 : .onSurfaceVariant)
                            .contentShape(Rectangle())
                            .onTapGesture { showSkillPicker.toggle() }
                        Image(systemName: "number")
                            .font(.system(size: 14))
                            .foregroundColor(appState.selectedProject != nil ? .primary500 : .onSurfaceVariant)
                            .contentShape(Rectangle())
                            .onTapGesture { showContextPicker.toggle() }
                        Image(systemName: "books.vertical")
                            .font(.system(size: 14))
                            .foregroundColor(!selectedDocIds.isEmpty ? .primary500 : .onSurfaceVariant)
                            .contentShape(Rectangle())
                            .onTapGesture { showDocPicker.toggle() }
                            .popover(isPresented: $showDocPicker, arrowEdge: .bottom) {
                                docPickerPopover
                            }
                    }
                }

                // Action row
                HStack(spacing: Spacing.sm) {
                    // Skills picker
                    toolbarButton(
                        icon: "puzzlepiece.extension",
                        label: selectedSkillId.flatMap { id in dataStore.apiSkills.first { $0.id == id }?.localizedName(for: lang) } ?? lang.t("技能", "Skills"),
                        active: selectedSkillId != nil
                    )
                    .popover(isPresented: $showSkillPicker, arrowEdge: .bottom) {
                        skillPickerPopover
                    }
                    .onTapGesture { showSkillPicker.toggle() }

                    // Mode picker
                    toolbarButton(icon: "rhombus", label: selectedMode?.label(for: lang) ?? lang.t("模式", "Modes"), active: selectedMode != nil)
                        .popover(isPresented: $showModePicker, arrowEdge: .bottom) {
                            modePickerPopover
                        }
                        .onTapGesture { showModePicker.toggle() }

                    // Context picker
                    toolbarButton(
                        icon: "doc.text",
                        label: appState.selectedProject?.name ?? lang.t("上下文", "Context"),
                        active: appState.selectedProject != nil
                    )
                    .popover(isPresented: $showContextPicker, arrowEdge: .bottom) {
                        contextPickerPopover
                    }
                    .onTapGesture { showContextPicker.toggle() }

                    Spacer()
                    Button { Task { await sendMessage() } } label: {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                            .frame(width: 32, height: 32)
                            .background(
                                inputText.isEmpty || isStreaming
                                    ? AnyShapeStyle(Color.onSurfaceVariant)
                                    : AnyShapeStyle(LinearGradient(colors: [.primary600, .primary500], startPoint: .topLeading, endPoint: .bottomTrailing))
                            )
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(inputText.isEmpty || isStreaming)
                }
            }
            .padding(Spacing.lg)
            .background(.surfaceContainerLowest)
        }
        .onAppear {
            // Consume pending skill set by SkillsView
            if let sid = appState.pendingSkillId {
                selectedSkillId = sid
                appState.pendingSkillId = nil
                currentConversationId = nil
                messages = []
            }
            // Consume pre-filled chat input set by ProjectSpaceView
            if let text = appState.pendingChatInput {
                inputText = text
                appState.pendingChatInput = nil
            }
        }
    }

    // MARK: - Toolbar helpers

    @ViewBuilder
    private func toolbarButton(icon: String, label: String, active: Bool) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 11))
            Text(label).font(TextStyle.labelSM).lineLimit(1)
        }
        .foregroundColor(active ? .primary500 : .onSurfaceVariant)
        .padding(.horizontal, Spacing.sm).padding(.vertical, 4)
        .background(active ? Color.primaryFixed : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: Radius.pill))
        .contentShape(RoundedRectangle(cornerRadius: Radius.pill))
    }

    // Skills popover
    private var skillPickerPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(lang.t("选择技能", "Select Skill")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                .padding(.horizontal, Spacing.md).padding(.top, Spacing.md).padding(.bottom, Spacing.xs)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    Button {
                        selectedSkillId = nil
                        showSkillPicker = false
                    } label: {
                        HStack {
                            Text(lang.t("无技能（通用对话）", "No skill (general chat)")).font(TextStyle.bodyMD).foregroundColor(.onSurface)
                            Spacer()
                            if selectedSkillId == nil {
                                Image(systemName: "checkmark").font(.system(size: 11)).foregroundColor(.primary500)
                            }
                        }
                        .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                    }
                    .buttonStyle(.plain)
                    Divider().opacity(0.4)
                    ForEach(dataStore.apiSkills) { skill in
                        Button {
                            selectedSkillId = skill.id
                            if !skill.userTemplate.isEmpty {
                                inputText = skill.userTemplate
                            } else {
                                inputText = inputText.replacingOccurrences(of: "@", with: "")
                            }
                            showSkillPicker = false
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(skill.localizedName(for: lang)).font(TextStyle.labelMD).foregroundColor(.onSurface)
                                    Text(skill.localizedDescription(for: lang)).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant).lineLimit(1)
                                }
                                Spacer()
                                if selectedSkillId == skill.id {
                                    Image(systemName: "checkmark").font(.system(size: 11)).foregroundColor(.primary500)
                                }
                            }
                            .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(maxHeight: 280)
        }
        .frame(width: 280)
        .background(Color.surfaceContainerLowest)
    }

    // Mode popover
    private var modePickerPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(lang.t("回复模式", "Reply Mode")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                .padding(.horizontal, Spacing.md).padding(.top, Spacing.md).padding(.bottom, Spacing.xs)
            Divider()
            VStack(alignment: .leading, spacing: 2) {
                Button {
                    selectedMode = nil
                    showModePicker = false
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(lang.t("默认", "Default")).font(TextStyle.labelMD).foregroundColor(.onSurface)
                            Text(lang.t("由 AI 自行决定回复长度", "AI decides response length")).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                        }
                        Spacer()
                        if selectedMode == nil {
                            Image(systemName: "checkmark").font(.system(size: 11)).foregroundColor(.primary500)
                        }
                    }
                    .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                }
                .buttonStyle(.plain)
                Divider().opacity(0.4)
                ForEach(ChatMode.allCases) { mode in
                    Button {
                        selectedMode = mode
                        showModePicker = false
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Image(systemName: mode.icon).font(.system(size: 11)).foregroundColor(.primary500)
                                    Text(mode.label(for: lang)).font(TextStyle.labelMD).foregroundColor(.onSurface)
                                }
                                Text(mode.desc(for: lang)).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                            }
                            Spacer()
                            if selectedMode == mode {
                                Image(systemName: "checkmark").font(.system(size: 11)).foregroundColor(.primary500)
                            }
                        }
                        .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(width: 240)
        .background(Color.surfaceContainerLowest)
    }

    // Context popover
    private var contextPickerPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(lang.t("项目上下文", "Project Context")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                .padding(.horizontal, Spacing.md).padding(.top, Spacing.md).padding(.bottom, Spacing.xs)
            Divider()
            VStack(alignment: .leading, spacing: 2) {
                Button {
                    appState.selectedProject = nil
                    inputText = inputText.replacingOccurrences(of: "#", with: "")
                    currentConversationId = nil
                    showContextPicker = false
                } label: {
                    HStack {
                        Text(lang.t("无项目上下文", "No project context")).font(TextStyle.bodyMD).foregroundColor(.onSurface)
                        Spacer()
                        if appState.selectedProject == nil {
                            Image(systemName: "checkmark").font(.system(size: 11)).foregroundColor(.primary500)
                        }
                    }
                    .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                }
                .buttonStyle(.plain)
                if !dataStore.projects.isEmpty {
                    Divider().opacity(0.4)
                    ForEach(dataStore.projects) { project in
                        Button {
                            appState.selectedProject = project
                            inputText = inputText.replacingOccurrences(of: "#", with: "")
                            currentConversationId = nil
                            showContextPicker = false
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(project.name).font(TextStyle.labelMD).foregroundColor(.onSurface)
                                    Text(project.client).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                                }
                                Spacer()
                                if appState.selectedProject?.id == project.id {
                                    Image(systemName: "checkmark").font(.system(size: 11)).foregroundColor(.primary500)
                                }
                            }
                            .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(width: 260)
        .background(Color.surfaceContainerLowest)
    }

    // Doc picker popover
    private var docPickerPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(lang.t("引用知识库", "Reference Knowledge Base")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                .padding(.horizontal, Spacing.md).padding(.top, Spacing.md).padding(.bottom, Spacing.xs)
            Divider()
            if dataStore.apiDocuments.isEmpty {
                Text(lang.t("暂无文档，请先上传到知识库", "No documents yet. Upload to Knowledge Base first."))
                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    .padding(Spacing.md)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(dataStore.apiDocuments) { doc in
                            let isSelected = selectedDocIds.contains(doc.id)
                            Button {
                                if isSelected {
                                    selectedDocIds.removeAll { $0 == doc.id }
                                } else {
                                    selectedDocIds.append(doc.id)
                                    inputText = inputText.replacingOccurrences(of: "/", with: "")
                                }
                                showDocPicker = false
                            } label: {
                                HStack {
                                    Image(systemName: fileIcon(doc.fileType))
                                        .font(.system(size: 12)).foregroundColor(.primary500)
                                        .frame(width: 18)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(doc.name).font(TextStyle.labelMD).foregroundColor(.onSurface).lineLimit(1)
                                        Text(doc.fileType.uppercased())
                                            .font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                                    }
                                    Spacer()
                                    if isSelected {
                                        Image(systemName: "checkmark").font(.system(size: 11)).foregroundColor(.primary500)
                                    }
                                }
                                .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 280)
            }
        }
        .frame(width: 300)
        .background(Color.surfaceContainerLowest)
    }

    private func fileIcon(_ type: String) -> String {
        switch type.lowercased() {
        case "pdf":   return "doc.richtext"
        case "docx":  return "doc.text"
        case "xlsx":  return "tablecells"
        case "pptx":  return "rectangle.on.rectangle"
        default:      return "doc"
        }
    }

    // MARK: - Send

    private func sendMessage() async {
        await performChatRequest(content: inputText, isContinue: false)
    }
    
    /// 执行聊天请求，支持普通请求和继续生成
    private func performChatRequest(content: String, isContinue: Bool) async {
        let raw = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return }
        
        if !isContinue {
            inputText = ""
            // Build attachments from selected references
            var userAttachments: [ChatAttachment] = []
            if let sid = selectedSkillId {
                userAttachments.append(.skill(sid))
            }
            for docId in selectedDocIds {
                userAttachments.append(.document(docId))
            }
            
            let userMsg = ChatMessage(id: UUID(), role: .user, content: raw, timestamp: Date(), attachments: userAttachments, cards: nil)
            messages.append(userMsg)
        }

        // Apply mode prefix (client-side instruction, not shown in bubble)
        let finalContent = (selectedMode?.prefix(for: lang) ?? "") + raw

        isStreaming = true
        streamingText = ""
        isOutputTruncated = false

        var fullText = ""
        var wasTruncated = false
        toolExecutingName = nil
        toolExecutingMessage = nil
        generatedFiles = []

        // Start skill progress tracking
        if selectedSkillId != nil && !isContinue {
            skillStage = .analyzing
        } else if selectedSkillId != nil && isContinue && skillStage != .continuing {
            skillStage = .analyzing
        }

        do {
            for try await chunk in await APIClient.shared.streamChat(
                conversationId: currentConversationId,
                content: finalContent,
                projectId: selectedProjectId,
                skillId: selectedSkillId,
                ragDocIds: selectedDocIds
            ) {
                switch chunk {
                case .conversationId(let id):
                    currentConversationId = id
                case .text(let t):
                    // 检测截断标记
                    if t.contains("[OUTPUT_TRUNCATED]") {
                        wasTruncated = true
                        let cleanText = t.replacingOccurrences(of: "[OUTPUT_TRUNCATED]", with: "")
                        fullText += cleanText
                        streamingText = fullText
                    } else {
                        fullText += t
                        streamingText = fullText
                    }
                case .toolExecuting(let toolName, let message, _, _):
                    toolExecutingName = toolName
                    toolExecutingMessage = message
                    if selectedSkillId != nil { skillStage = .generating }
                case .toolResult(let result):
                    toolExecutingName = nil
                    toolExecutingMessage = nil
                    if result.status == "success", let output = result.output {
                        let file = GeneratedFile(
                            fileName: output.fileName ?? "generated_file",
                            fileType: output.fileType ?? "unknown",
                            filePath: output.filePath ?? "",
                            slideCount: output.slideCount
                        )
                        generatedFiles.append(file)
                        if selectedSkillId != nil { skillStage = .done }
                    }
                case .title:
                    break  // title updates handled in ProjectSpaceView
                }
            }
        } catch {
            fullText = lang.t("⚠️ 请求失败：\(error.localizedDescription)", "⚠️ Request failed: \(error.localizedDescription)")
            if selectedSkillId != nil { skillStage = .idle }
        }

        streamingText = ""
        isStreaming = false
        toolExecutingName = nil
        toolExecutingMessage = nil
        
        // 添加生成的文件信息到消息内容
        if !generatedFiles.isEmpty {
            let fileInfo = generatedFiles.map { file in
                let icon = file.fileType == "pptx" ? "📊" : (file.fileType == "json" ? "📋" : "📄")
                let detail = file.slideCount != nil ? "(\(file.slideCount!)页)" : ""
                return "\(icon) \(file.fileName) \(detail)"
            }.joined(separator: "\n")
            fullText += "\n\n---\n**已生成文件：**\n" + fileInfo
        }
        
        guard !fullText.isEmpty else { return }
        
        if isContinue {
            // 继续生成：追加到最后一条消息
            if let lastMsg = messages.last, lastMsg.role == .assistant {
                let updatedContent = lastMsg.content + fullText
                messages[messages.count - 1] = ChatMessage(
                    id: lastMsg.id,
                    role: .assistant,
                    content: updatedContent,
                    timestamp: Date(),
                    attachments: lastMsg.attachments,
                    cards: nil
                )
            }
        } else {
            // 新消息
            let assistantMsg = ChatMessage(id: UUID(), role: .assistant, content: fullText, timestamp: Date(), attachments: [], cards: nil)
            messages.append(assistantMsg)
        }
        
        // 如果输出被截断
        if wasTruncated {
            // 有 skill 时自动续接，无需用户干预
            if selectedSkillId != nil && generatedFiles.isEmpty {
                skillStage = .continuing
                isOutputTruncated = false
                pendingContinueContent = lang.t("继续", "Continue")
                try? await Task.sleep(nanoseconds: 300_000_000)
                let continuePrompt = lang.t("请继续刚才的回答，从上次中断的地方接着讲。", "Please continue from where you left off.")
                await performChatRequest(content: continuePrompt, isContinue: true)
            } else {
                isOutputTruncated = true
                pendingContinueContent = lang.t("继续", "Continue")
            }
        }

        // Reset skill stage if session is over (no files, no more continuation)
        if selectedSkillId != nil && skillStage != .done && !isOutputTruncated {
            skillStage = .idle
        }

        await dataStore.loadConversations()
    }
    
    /// 继续生成被截断的输出
    private func continueGeneration() async {
        guard isOutputTruncated, !pendingContinueContent.isEmpty else { return }
        isOutputTruncated = false
        
        // 构建继续提示的上下文
        let continuePrompt = lang.t("请继续刚才的回答，从上次中断的地方接着讲。", "Please continue from where you left off.")
        await performChatRequest(content: continuePrompt, isContinue: true)
    }

    // MARK: - Export

    private var exportPopover: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(lang.t("导出对话", "Export Conversation"))
                .font(TextStyle.titleSM).foregroundColor(.onSurface)

            if messages.isEmpty {
                Text(lang.t("当前对话没有消息", "No messages in this conversation"))
                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
            } else {
                Text(lang.t("共 \(messages.count) 条消息", "\(messages.count) messages"))
                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)

                VStack(spacing: Spacing.sm) {
                    Button {
                        exportConversation(format: "markdown")
                        showExportPanel = false
                    } label: {
                        HStack(spacing: Spacing.sm) {
                            Image(systemName: "doc.text").font(.system(size: 13)).foregroundColor(.primary500)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(lang.t("导出为 Markdown", "Export as Markdown"))
                                    .font(TextStyle.labelMD).foregroundColor(.onSurface)
                                Text(lang.t("保留格式，适合文档工具", "Preserves formatting, great for docs"))
                                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                            }
                            Spacer()
                        }
                        .padding(Spacing.md)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)

                    Button {
                        exportConversation(format: "text")
                        showExportPanel = false
                    } label: {
                        HStack(spacing: Spacing.sm) {
                            Image(systemName: "doc.plaintext").font(.system(size: 13)).foregroundColor(.onSurfaceVariant)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(lang.t("导出为纯文本", "Export as Plain Text"))
                                    .font(TextStyle.labelMD).foregroundColor(.onSurface)
                                Text(lang.t("无格式，适合复制粘贴", "No formatting, easy to copy-paste"))
                                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                            }
                            Spacer()
                        }
                        .padding(Spacing.md)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)

                    Button {
                        exportConversation(format: "pdf")
                        showExportPanel = false
                    } label: {
                        HStack(spacing: Spacing.sm) {
                            Image(systemName: "doc.richtext").font(.system(size: 13)).foregroundColor(.statusFailed)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(lang.t("打印 / 导出为 PDF", "Print / Export as PDF"))
                                    .font(TextStyle.labelMD).foregroundColor(.onSurface)
                                Text(lang.t("使用系统打印对话框另存为 PDF", "Use system print dialog to save as PDF"))
                                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                            }
                            Spacer()
                        }
                        .padding(Spacing.md)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(Spacing.lg)
        .frame(width: 300)
        .background(Color.surfaceContainerLowest)
    }

    private func exportConversation(format: String) {
        guard !messages.isEmpty else { return }
        let convTitle = dataStore.conversations.first(where: { $0.id == currentConversationId })?.title ?? lang.t("对话", "Chat")
        let dateStr = Date().formatted(date: .abbreviated, time: .shortened)
        let fileDateStr = String(Date().formatted(.iso8601).prefix(10))

        if format == "pdf" {
            exportStyledPDF(convTitle: convTitle, dateStr: dateStr)
            return
        }

        var content = ""
        if format == "markdown" {
            content += "# \(convTitle)\n\n"
            content += "_\(lang.t("导出时间：", "Exported: "))\(dateStr)_\n\n---\n\n"
            for msg in messages {
                let role = msg.role == .user ? lang.t("**用户**", "**User**") : lang.t("**AI 助手**", "**Assistant**")
                content += "\(role)\n\n\(msg.content)\n\n---\n\n"
            }
        } else {
            content += "\(convTitle)\n"
            content += "\(lang.t("导出时间：", "Exported: "))\(dateStr)\n\n"
            for msg in messages {
                let role = msg.role == .user ? lang.t("用户", "User") : lang.t("AI 助手", "Assistant")
                content += "[\(role)]\n\(msg.content)\n\n"
            }
        }

        let ext = format == "markdown" ? "md" : "txt"
        let fileName = "\(lang.t("对话", "chat"))-\(fileDateStr).\(ext)"
        let panel = NSSavePanel()
        panel.nameFieldStringValue = fileName
        panel.allowedContentTypes = format == "markdown" ? [.init(filenameExtension: "md")!] : [.plainText]
        panel.begin { resp in
            if resp == .OK, let url = panel.url {
                try? content.write(to: url, atomically: true, encoding: .utf8)
            }
        }
    }
    
    /// 导出样式化的PDF（渲染后的Markdown样式）
    private func exportStyledPDF(convTitle: String, dateStr: String) {
        // 创建导出视图
        let exportView = ChatExportView(
            title: convTitle,
            dateStr: dateStr,
            messages: messages,
            lang: lang
        )
        
        // 使用ImageRenderer渲染为PDF
        let renderer = ImageRenderer(content: exportView)
        renderer.proposedSize = .init(width: 612, height: 792) // A4尺寸 (72dpi)
        
        // 计算所需高度
        let hostingView = NSHostingView(rootView: exportView)
        hostingView.frame = CGRect(x: 0, y: 0, width: 612, height: 792)
        hostingView.layoutSubtreeIfNeeded()
        
        // 创建打印信息
        let printInfo = NSPrintInfo.shared.copy() as! NSPrintInfo
        printInfo.paperSize = NSMakeSize(612, 792)
        printInfo.topMargin = 36
        printInfo.bottomMargin = 36
        printInfo.leftMargin = 36
        printInfo.rightMargin = 36
        printInfo.isHorizontallyCentered = false
        printInfo.isVerticallyCentered = false
        
        // 使用NSPrintOperation打印到PDF
        if renderer.nsImage != nil {
            let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 540, height: 720))
            textView.isEditable = false
            textView.drawsBackground = false
            
            // 构建富文本内容
            let fullAttrStr = buildStyledAttributedString(
                title: convTitle,
                dateStr: dateStr,
                messages: messages,
                lang: lang
            )
            textView.textStorage?.setAttributedString(fullAttrStr)
            textView.sizeToFit()
            
            let printOp = NSPrintOperation(view: textView, printInfo: printInfo)
            printOp.showsPrintPanel = true
            printOp.showsProgressPanel = true
            printOp.run()
        }
    }
    
    /// 构建完整HTML并转换为NSAttributedString
    private func buildStyledAttributedString(
        title: String,
        dateStr: String,
        messages: [ChatMessage],
        lang: AppLanguage
    ) -> NSAttributedString {
        // 构建完整HTML文档
        var html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 11px;
                    line-height: 1.6;
                    color: #1f2937;
                    padding: 0;
                    margin: 0;
                }
                .header {
                    margin-bottom: 24px;
                    padding-bottom: 16px;
                    border-bottom: 2px solid #e5e7eb;
                }
                .title {
                    font-size: 20px;
                    font-weight: bold;
                    color: #111827;
                    margin-bottom: 8px;
                }
                .date {
                    font-size: 11px;
                    color: #6b7280;
                }
                .message {
                    margin-bottom: 24px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid #e5e7eb;
                }
                .role {
                    font-size: 11px;
                    font-weight: 600;
                    margin-bottom: 8px;
                }
                .role-user {
                    color: #2563eb;
                }
                .role-assistant {
                    color: #7c3aed;
                }
                .content {
                    font-size: 11px;
                    line-height: 1.6;
                }
                /* Markdown 样式 */
                h1 { font-size: 18px; font-weight: bold; margin: 16px 0 8px; color: #111827; }
                h2 { font-size: 16px; font-weight: 600; margin: 14px 0 8px; color: #111827; }
                h3 { font-size: 14px; font-weight: 600; margin: 12px 0 6px; color: #374151; }
                strong, b { font-weight: 600; }
                code {
                    background-color: #f3f4f6;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: 'SF Mono', Monaco, monospace;
                    font-size: 10px;
                    color: #dc2626;
                }
                pre {
                    background-color: #f8fafc;
                    padding: 12px;
                    border-radius: 6px;
                    border: 1px solid #e5e7eb;
                    overflow-x: auto;
                    margin: 12px 0;
                }
                pre code {
                    background: none;
                    padding: 0;
                    color: #166534;
                }
                ul, ol {
                    margin: 8px 0;
                    padding-left: 20px;
                }
                li {
                    margin: 4px 0;
                }
                blockquote {
                    border-left: 3px solid #3b82f6;
                    margin: 12px 0;
                    padding-left: 12px;
                    color: #4b5563;
                    font-style: italic;
                }
                /* 表格样式 */
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 12px 0;
                    font-size: 10px;
                }
                th {
                    background-color: #1A56DB;
                    color: white;
                    padding: 8px 12px;
                    text-align: left;
                    font-weight: 600;
                    border: 1px solid #1A56DB;
                }
                td {
                    padding: 6px 12px;
                    border: 1px solid #e5e7eb;
                }
                tr:nth-child(even) {
                    background-color: #f8fafc;
                }
                p {
                    margin: 8px 0;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">\(escapeHTML(title))</div>
                <div class="date">\(escapeHTML(lang.t("导出时间：", "Exported: ")))\(escapeHTML(dateStr))</div>
            </div>
        """
        
        for msg in messages {
            let roleClass = msg.role == .user ? "role-user" : "role-assistant"
            let roleLabel = msg.role == .user ? lang.t("用户", "User") : lang.t("AI 助手", "Assistant")
            
            html += """
            <div class="message">
                <div class="role \(roleClass)">\(escapeHTML(roleLabel))</div>
                <div class="content">
                    \(markdownToHTML(msg.content))
                </div>
            </div>
            """
        }
        
        html += "</body></html>"
        
        // 转换为NSAttributedString
        guard let data = html.data(using: .utf8) else {
            return NSAttributedString(string: "导出失败")
        }
        
        let options: [NSAttributedString.DocumentReadingOptionKey: Any] = [
            .documentType: NSAttributedString.DocumentType.html,
            .characterEncoding: String.Encoding.utf8.rawValue
        ]
        
        do {
            return try NSAttributedString(data: data, options: options, documentAttributes: nil)
        } catch {
            return NSAttributedString(string: "导出失败: \(error.localizedDescription)")
        }
    }
    
    /// HTML 转义
    private func escapeHTML(_ text: String) -> String {
        return text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
    
    /// 将 Markdown 转换为 HTML - 逐行处理确保准确性
    private func markdownToHTML(_ markdown: String) -> String {
        // 首先处理代码块（多行）
        let codeBlockPattern = "```([\\s\\S]*?)```"
        var html = markdown
        if let regex = try? NSRegularExpression(pattern: codeBlockPattern, options: []) {
            let matches = regex.matches(in: html, options: [], range: NSRange(location: 0, length: html.utf16.count))
            for match in matches.reversed() {
                if let range = Range(match.range, in: html) {
                    let fullMatch = String(html[range])
                    let codeContent = String(fullMatch.dropFirst(3).dropLast(3))
                    let escapedCode = escapeHTML(codeContent)
                    let htmlBlock = "<pre><code>\(escapedCode)</code></pre>"
                    html.replaceSubrange(range, with: htmlBlock)
                }
            }
        }
        
        // 处理表格（需要在段落处理之前）
        html = processTablesInHTML(html)
        
        // 逐行处理其他 Markdown 元素
        let lines = html.components(separatedBy: "\n")
        var result: [String] = []
        var currentParagraph: [String] = []
        var inCodeBlock = false
        var inList = false
        var listItems: [String] = []
        
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            
            // 跳过空行处理
            if trimmed.isEmpty {
                if inList && !listItems.isEmpty {
                    result.append("<ul>\(listItems.joined())</ul>")
                    listItems = []
                    inList = false
                }
                if !currentParagraph.isEmpty {
                    result.append("<p>\(currentParagraph.joined(separator: " "))</p>")
                    currentParagraph = []
                }
                continue
            }
            
            // 检测代码块标记（已转换的 <pre> 标签）
            if trimmed.hasPrefix("<pre>") {
                if !currentParagraph.isEmpty {
                    result.append("<p>\(currentParagraph.joined(separator: " "))</p>")
                    currentParagraph = []
                }
                if inList && !listItems.isEmpty {
                    result.append("<ul>\(listItems.joined())</ul>")
                    listItems = []
                    inList = false
                }
                inCodeBlock = true
                result.append(line)
                continue
            }
            if trimmed.hasSuffix("</pre>") {
                inCodeBlock = false
                result.append(line)
                continue
            }
            if inCodeBlock {
                result.append(line)
                continue
            }
            
            // 检测表格（已转换的 <table> 标签）
            if trimmed.hasPrefix("<table>") || trimmed.hasPrefix("<thead>") || 
               trimmed.hasPrefix("<tbody>") || trimmed.hasPrefix("<tr>") ||
               trimmed.hasPrefix("<th>") || trimmed.hasPrefix("<td>") ||
               trimmed.hasPrefix("</table>") || trimmed.hasPrefix("</thead>") ||
               trimmed.hasPrefix("</tbody>") || trimmed.hasPrefix("</tr>") ||
               trimmed.hasPrefix("</th>") || trimmed.hasPrefix("</td>") {
                if !currentParagraph.isEmpty {
                    result.append("<p>\(currentParagraph.joined(separator: " "))</p>")
                    currentParagraph = []
                }
                if inList && !listItems.isEmpty {
                    result.append("<ul>\(listItems.joined())</ul>")
                    listItems = []
                    inList = false
                }
                result.append(line)
                continue
            }
            
            // 处理标题 - 先转义HTML特殊字符，再处理行内样式
            if trimmed.hasPrefix("# ") {
                if !currentParagraph.isEmpty {
                    result.append("<p>\(currentParagraph.joined(separator: " "))</p>")
                    currentParagraph = []
                }
                if inList && !listItems.isEmpty {
                    result.append("<ul>\(listItems.joined())</ul>")
                    listItems = []
                    inList = false
                }
                let text = escapeHTML(String(trimmed.dropFirst(2)))
                result.append("<h1>\(processInlineMarkdown(text))</h1>")
                continue
            }
            if trimmed.hasPrefix("## ") {
                if !currentParagraph.isEmpty {
                    result.append("<p>\(currentParagraph.joined(separator: " "))</p>")
                    currentParagraph = []
                }
                if inList && !listItems.isEmpty {
                    result.append("<ul>\(listItems.joined())</ul>")
                    listItems = []
                    inList = false
                }
                let text = escapeHTML(String(trimmed.dropFirst(3)))
                result.append("<h2>\(processInlineMarkdown(text))</h2>")
                continue
            }
            if trimmed.hasPrefix("### ") {
                if !currentParagraph.isEmpty {
                    result.append("<p>\(currentParagraph.joined(separator: " "))</p>")
                    currentParagraph = []
                }
                if inList && !listItems.isEmpty {
                    result.append("<ul>\(listItems.joined())</ul>")
                    listItems = []
                    inList = false
                }
                let text = escapeHTML(String(trimmed.dropFirst(4)))
                result.append("<h3>\(processInlineMarkdown(text))</h3>")
                continue
            }
            
            // 处理引用块
            if trimmed.hasPrefix("> ") {
                if !currentParagraph.isEmpty {
                    result.append("<p>\(currentParagraph.joined(separator: " "))</p>")
                    currentParagraph = []
                }
                if inList && !listItems.isEmpty {
                    result.append("<ul>\(listItems.joined())</ul>")
                    listItems = []
                    inList = false
                }
                let text = escapeHTML(String(trimmed.dropFirst(2)))
                result.append("<blockquote>\(processInlineMarkdown(text))</blockquote>")
                continue
            }
            
            // 处理列表项
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                if !currentParagraph.isEmpty {
                    result.append("<p>\(currentParagraph.joined(separator: " "))</p>")
                    currentParagraph = []
                }
                inList = true
                let text = escapeHTML(String(trimmed.dropFirst(2)))
                listItems.append("<li>\(processInlineMarkdown(text))</li>")
                continue
            }
            
            // 普通文本行 - 先转义HTML，再处理行内样式
            let escapedLine = escapeHTML(trimmed)
            let processedLine = processInlineMarkdown(escapedLine)
            currentParagraph.append(processedLine)
        }
        
        // 处理剩余内容
        if inList && !listItems.isEmpty {
            result.append("<ul>\(listItems.joined())</ul>")
        }
        if !currentParagraph.isEmpty {
            result.append("<p>\(currentParagraph.joined(separator: " "))</p>")
        }
        
        return result.joined(separator: "\n")
    }
    
    /// 处理行内 Markdown（粗体、斜体、代码）
    private func processInlineMarkdown(_ text: String) -> String {
        var result = text
        
        // 粗体 **text** - 使用非贪婪匹配
        let boldPattern = "\\*\\*(.+?)\\*\\*"
        if let regex = try? NSRegularExpression(pattern: boldPattern, options: []) {
            result = regex.stringByReplacingMatches(
                in: result,
                options: [],
                range: NSRange(location: 0, length: result.utf16.count),
                withTemplate: "<strong>$1</strong>"
            )
        }
        
        // 斜体 *text* - 使用非贪婪匹配，但要避免匹配到 **
        // 先检查是否还有未处理的 *
        let italicPattern = "(?<!\\*)\\*(?!\\*)(.+?)(?<!\\*)\\*(?!\\*)"
        if let regex = try? NSRegularExpression(pattern: italicPattern, options: []) {
            result = regex.stringByReplacingMatches(
                in: result,
                options: [],
                range: NSRange(location: 0, length: result.utf16.count),
                withTemplate: "<em>$1</em>"
            )
        }
        
        // 行内代码 `code`
        let codePattern = "`(.+?)`"
        if let regex = try? NSRegularExpression(pattern: codePattern, options: []) {
            result = regex.stringByReplacingMatches(
                in: result,
                options: [],
                range: NSRange(location: 0, length: result.utf16.count),
                withTemplate: "<code>$1</code>"
            )
        }
        
        return result
    }
    
    /// 处理 Markdown 表格转换为 HTML 表格
    private func processTablesInHTML(_ html: String) -> String {
        let lines = html.components(separatedBy: "\n")
        
        var tableStart = -1
        var tableLines: [String] = []
        var newLines: [String] = []
        
        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("|") {
                if tableStart == -1 {
                    tableStart = index
                }
                tableLines.append(trimmed)
            } else {
                if !tableLines.isEmpty {
                    newLines.append(convertTableToHTML(tableLines))
                    tableLines = []
                    tableStart = -1
                }
                newLines.append(line)
            }
        }
        
        if !tableLines.isEmpty {
            newLines.append(convertTableToHTML(tableLines))
        }
        
        return newLines.joined(separator: "\n")
    }
    
    /// 转换 Markdown 表格行为 HTML
    private func convertTableToHTML(_ lines: [String]) -> String {
        guard lines.count >= 2 else { return lines.joined(separator: "\n") }
        
        func parseCells(_ line: String) -> [String] {
            var trimmed = line
            if trimmed.hasPrefix("|") { trimmed = String(trimmed.dropFirst()) }
            if trimmed.hasSuffix("|") { trimmed = String(trimmed.dropLast()) }
            return trimmed.components(separatedBy: "|").map { 
                escapeHTML($0.trimmingCharacters(in: .whitespaces)) 
            }
        }
        
        let headers = parseCells(lines[0])
        let separator = parseCells(lines[1])
        
        // 检查是否为有效分隔行
        let isValidSeparator = separator.allSatisfy { cell in
            cell.allSatisfy { $0 == "-" || $0 == ":" || $0 == " " }
        } || separator.allSatisfy { $0.isEmpty }
        
        guard isValidSeparator else { return lines.joined(separator: "\n") }
        
        var html = "<table>"
        
        // 表头 - 支持行内样式
        html += "<thead><tr>"
        for header in headers {
            let styledHeader = processInlineMarkdown(header)
            html += "<th>\(styledHeader)</th>"
        }
        html += "</tr></thead>"
        
        // 数据行 - 支持行内样式
        html += "<tbody>"
        for i in 2..<lines.count {
            let cells = parseCells(lines[i])
            html += "<tr>"
            for cell in cells {
                let styledCell = processInlineMarkdown(cell)
                html += "<td>\(styledCell)</td>"
            }
            html += "</tr>"
        }
        html += "</tbody></table>"
        
        return html
    }
}

// MARK: - Chat Export View
/// 用于PDF导出的视图（保持与聊天界面一致的样式）
struct ChatExportView: View {
    let title: String
    let dateStr: String
    let messages: [ChatMessage]
    let lang: AppLanguage
    
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            // 标题区
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(.primary)
                Text(lang.t("导出时间：", "Exported: ") + dateStr)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
            
            Divider()
            
            // 消息列表
            ForEach(Array(messages.enumerated()), id: \.element.id) { index, msg in
                MessageExportView(message: msg, lang: lang)
                
                if index < messages.count - 1 {
                    Divider()
                        .padding(.vertical, 8)
                }
            }
        }
        .padding(36)
        .frame(width: 540, alignment: .leading)
        .background(Color.white)
    }
}

// MARK: - Message Export View
struct MessageExportView: View {
    let message: ChatMessage
    let lang: AppLanguage
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // 角色标签
            HStack(spacing: 8) {
                if message.role == .user {
                    Image(systemName: "person.circle.fill")
                        .foregroundColor(.blue)
                    Text(lang.t("用户", "User"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.blue)
                } else {
                    Image(systemName: "sparkles")
                        .foregroundColor(.purple)
                    Text(lang.t("AI 助手", "Assistant"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.purple)
                }
            }
            
            // 内容（使用MarkdownView保持样式一致）
            MarkdownView(text: message.content)
                .font(.system(size: 11))
        }
    }
}

// MARK: - Conversation Row

struct ConversationRowView: View {
    let conversation: APIConversation
    let isSelected: Bool
    let onSelect: () -> Void
    let onDelete: () -> Void
    @State private var isHovered = false
    @State private var showDeleteConfirm = false
    @Environment(\.appLanguage) var lang

    private var relativeDate: String {
        let diff = Date().timeIntervalSince(conversation.updatedAt)
        if diff < 60 { return lang.t("刚刚", "Just now") }
        if diff < 3600 { return lang.t("\(Int(diff / 60)) 分钟前", "\(Int(diff / 60))m ago") }
        if diff < 86400 { return lang.t("\(Int(diff / 3600)) 小时前", "\(Int(diff / 3600))h ago") }
        let f = DateFormatter()
        f.dateFormat = diff < 86400 * 7 ? "E" : "M/d"
        return f.string(from: conversation.updatedAt)
    }

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: Spacing.xs) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(conversation.title)
                        .font(TextStyle.labelMD)
                        .foregroundColor(isSelected ? .primary500 : .onSurface)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(relativeDate)
                        .font(.system(size: 10))
                        .foregroundColor(.onSurfaceVariant)
                }
                Spacer(minLength: 0)
                // 删除按钮：始终占位（width 24），hover 时显示图标，避免文字跳动
                Button {
                    onDelete()
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 11))
                        .foregroundColor(.red.opacity(0.7))
                        .opacity(isHovered || showDeleteConfirm ? 1 : 0)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded { })
                .onHover { inside in showDeleteConfirm = inside }
                .allowsHitTesting(isHovered || showDeleteConfirm)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 0)
                    .fill(isSelected ? Color.primaryFixed : (isHovered ? Color.surfaceContainerHigh : Color.clear))
            )
            .contentShape(Rectangle())
            .animation(.easeInOut(duration: 0.15), value: isHovered)
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: isSelected)
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .contextMenu {
            Button(role: .destructive) {
                onDelete()
            } label: {
                Label(lang.t("删除对话", "Delete Conversation"), systemImage: "trash")
            }
        }
    }
}

// MARK: - Message Row
struct MessageRow: View {
    let message: ChatMessage
    var onCopy: () -> Void = {}
    var onRetry: () -> Void = {}
    @State private var copied = false
    @Environment(\.appLanguage) var lang
    @EnvironmentObject var dataStore: DataStore

    var body: some View {
        if message.role == .user {
            userMessage
        } else {
            assistantMessage
        }
    }

    @ViewBuilder
    private var userMessage: some View {
        VStack(alignment: .trailing, spacing: Spacing.xs) {
            // Reference tags (skill, docs, etc.)
            if !message.attachments.isEmpty {
                HStack(spacing: Spacing.xs) {
                    ForEach(Array(message.attachments.enumerated()), id: \.offset) { _, attachment in
                        attachmentTag(attachment)
                    }
                }
                .padding(.trailing, Spacing.sm)
            }
            
            HStack {
                Spacer(minLength: 100)
                Text(message.content)
                    .font(TextStyle.bodyMD).foregroundColor(.onSurface)
                    .padding(.horizontal, Spacing.lg).padding(.vertical, Spacing.md)
                    .background(Color.surfaceContainerHigh)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
                    .textSelection(.enabled)
                    .contextMenu {
                        Button {
                            onCopy()
                        } label: {
                            Label(lang.t("复制", "Copy"), systemImage: "doc.on.doc")
                        }
                    }
            }
        }
    }
    
    @ViewBuilder
    private func attachmentTag(_ attachment: ChatAttachment) -> some View {
        let (icon, label, color): (String, String, Color) = {
            switch attachment {
            case .skill(let id):
                if let skill = dataStore.apiSkills.first(where: { $0.id == id }) {
                    return ("puzzlepiece.extension", skill.localizedName(for: lang), .primary500)
                }
                return ("puzzlepiece.extension", "Skill", .primary500)
            case .document(let id):
                if let doc = dataStore.apiDocuments.first(where: { $0.id == id }) {
                    return ("doc.text", doc.name, .secondary)
                }
                return ("doc.text", "Doc", .secondary)
            case .file(_):
                return ("paperclip", "File", .secondary)
            case .project(_):
                return ("folder", "Project", .secondary)
            }
        }()
        
        HStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 9))
            Text(label).font(TextStyle.labelSM)
        }
        .foregroundColor(color)
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(color.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: Radius.pill))
    }

    @ViewBuilder
    private var assistantMessage: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [.primary600, .primary500], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 32, height: 32)
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
            }
            .frame(width: 32)

            VStack(alignment: .leading, spacing: Spacing.lg) {
                MarkdownView(text: message.content)

                if let cards = message.cards {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Spacing.md) {
                        ForEach(cards) { InsightCardView(card: $0) }
                    }
                }

                HStack(spacing: Spacing.sm) {
                    // Copy
                    HStack(spacing: 4) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 11))
                        Text(copied ? lang.t("已复制", "Copied") : lang.t("复制", "Copy"))
                            .font(TextStyle.labelSM)
                    }
                    .foregroundColor(copied ? .statusActive : .onSurfaceVariant)
                    .padding(.horizontal, Spacing.sm).padding(.vertical, 4)
                    .background(Color.surfaceContainerHigh)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    .contentShape(RoundedRectangle(cornerRadius: Radius.md))
                    .onTapGesture {
                        onCopy()
                        copied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                    }

                    // Retry
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.clockwise").font(.system(size: 11))
                        Text(lang.t("重试", "Retry")).font(TextStyle.labelSM)
                    }
                    .foregroundColor(.onSurfaceVariant)
                    .padding(.horizontal, Spacing.sm).padding(.vertical, 4)
                    .background(Color.surfaceContainerHigh)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    .contentShape(RoundedRectangle(cornerRadius: Radius.md))
                    .onTapGesture { onRetry() }

                    Spacer()
                }
            }
            .contextMenu {
                Button {
                    onCopy()
                } label: {
                    Label(lang.t("复制全部", "Copy All"), systemImage: "doc.on.doc")
                }
                Button {
                    onRetry()
                } label: {
                    Label(lang.t("重试", "Retry"), systemImage: "arrow.clockwise")
                }
            }
        }
    }
}

// MARK: - Insight Card
struct InsightCardView: View {
    let card: InsightCard

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: Spacing.sm) {
                Image(systemName: card.icon)
                    .font(.system(size: 14, weight: .semibold)).foregroundColor(.primary500)
                Text(card.title).font(TextStyle.titleSM).foregroundColor(.onSurface)
            }
            Text(card.body)
                .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
        }
        .padding(Spacing.lg)
        .background(Color.surfaceContainerLowest)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md)
                .strokeBorder(Color.outlineVariant.opacity(0.15), lineWidth: 1)
        )
    }
}
