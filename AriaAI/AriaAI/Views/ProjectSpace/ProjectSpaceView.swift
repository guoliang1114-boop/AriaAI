import SwiftUI
import UniformTypeIdentifiers

struct ProjectSpaceView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    let project: Project

    @State private var isImportingFiles = false
    @State private var isUploadingFile = false
    @State private var uploadProgress: Double = 0   // 0.0 – 1.0
    @State private var uploadProgressText = ""

    // Real API data
    @State private var apiFiles: [APIProjectFile] = []
    @State private var apiFolders: [APIProjectFolder] = []
    @State private var apiMilestones: [APIMilestone] = []
    @State private var isLoadingContent = true   // drives skeleton in right panel

    // Folder state
    @State private var expandedFolderIds: Set<Int> = []
    @State private var uploadTargetFolderId: Int? = nil

    // Add milestone form
    @State private var showAddMilestone = false
    @State private var newMilestoneTitle = ""
    @State private var newMilestonePriority = "medium"
    @State private var newMilestoneDueDate = ""
    @State private var showSearch = false
    @State private var navSearchText = ""

    // Financials
    @State private var financials: APIProjectFinancials? = nil
    @State private var showAddPayment = false
    @State private var newPaymentAmount = ""
    @State private var newPaymentDate = ""
    @State private var newPaymentNote = ""
    @State private var newPaymentType = "received"
    @State private var showSetContractAmount = false
    @State private var newContractAmount = ""

    // Inline chat
    @State private var projectConversations: [APIConversation] = []
    @State private var activeConversationId: Int? = nil
    @State private var chatMessages: [APIMessage] = []
    @State private var inlineChatInput = ""
    @State private var isStreaming = false
    @State private var streamingContent = ""
    @State private var chatScrollTarget: Int? = nil
    @State private var suggestionsVisible = false

    // File attachment in chat
    @State private var selectedFileIds: Set<Int> = []
    @State private var showFilePicker = false
    @State private var showExportPanel = false
    @State private var pendingSuggestionSkillId: Int? = nil  // 从 AI 建议点击时暂存的 skillId

    // Skill selection in chat
    @State private var selectedSkillId: Int? = nil
    @State private var showSkillPicker = false

    @State private var cachedApiProjectId: Int? = nil
    @State private var isGeneratingContext = false
    @State private var contextExpanded = true
    @State private var streamingContextDraft = ""
    @State private var savedNoteMessageId: Int? = nil

    private var apiProjectId: Int? {
        // Use cached value first (set after loadDetail); fall back to live lookup
        cachedApiProjectId ?? dataStore.apiProjects.first { $0.name == project.name }?.id
    }

    /// Live project from store (reflects status changes without re-navigation)
    private var liveProject: Project {
        dataStore.projects.first { $0.name == project.name } ?? project
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                // ── Chat column (fills all available space) ────────
                inlineChatPanel
                    .frame(maxWidth: .infinity)

                Divider()

                // ── Right column ───────────────────────────────────
                ScrollView {
                    VStack(spacing: Spacing.lg) {
                        contextCard
                        if isLoadingContent {
                            skeletonCard
                        } else {
                            financialCard
                        }
                        if !isLoadingContent {
                            aiSuggestionsCard
                            projectStatsCard
                        }
                    }
                    .padding(Spacing.lg)
                }
                .frame(width: 260)
                .background(.surfaceContainerLowest)
            }
            .background(.surfaceBase)
        }
        .fileImporter(
            isPresented: $isImportingFiles,
            allowedContentTypes: [.pdf, .data,
                UTType(filenameExtension: "docx") ?? .data,
                UTType(filenameExtension: "pptx") ?? .data,
                UTType(filenameExtension: "xlsx") ?? .data],
            allowsMultipleSelection: true
        ) { result in
            handleFileImport(result)
        }
        .task {
            await loadAllData()
        }
    }

    // MARK: - Load data

    private func loadAllData() async {
        // Step 1: Resolve project ID — fast if apiProjects already cached
        if dataStore.apiProjects.isEmpty {
            await dataStore.loadProjects()
        }
        guard let pid = dataStore.apiProjects.first(where: { $0.name == project.name })?.id else {
            isLoadingContent = false
            return
        }
        cachedApiProjectId = pid

        // Step 2: Combined detail call + chat in parallel — 1 round-trip instead of 4-5
        async let detail = dataStore.loadProjectDetail(apiProjectId: pid)
        async let chat: Void = loadProjectChatDirect(pid: pid)

        if let d = await detail {
            apiFiles          = d.files
            apiMilestones     = d.milestones
            apiFolders        = d.folders
            expandedFolderIds = Set(d.folders.map { $0.id })
            financials        = d.financials
        }
        isLoadingContent = false

        _ = await chat
    }

    private func loadProjectChatDirect(pid: Int) async {
        // Load only this project's conversations (backend supports ?project_id=)
        await dataStore.loadConversations(projectId: pid)
        projectConversations = dataStore.conversations
        if let first = dataStore.conversations.first {
            activeConversationId = first.id
            chatMessages = await dataStore.loadMessages(conversationId: first.id)
        }
    }

    private func loadFinancials() async {
        guard let pid = apiProjectId else { return }
        financials = await dataStore.loadProjectFinancials(apiProjectId: pid)
    }

    private func sendInlineMessage() {
        let text = inlineChatInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }
        inlineChatInput = ""
        let attachedFileIds = Array(selectedFileIds)
        selectedFileIds = []
        let skillId = selectedSkillId ?? pendingSuggestionSkillId
        selectedSkillId = nil
        pendingSuggestionSkillId = nil
        isStreaming = true
        streamingContent = ""

        Task {
            var convId = activeConversationId
            if convId == nil, let pid = apiProjectId {
                let conv = await dataStore.createConversation(projectId: pid)
                convId = conv?.id
                activeConversationId = convId
                if let c = conv { projectConversations.insert(c, at: 0) }
            }
            // Optimistic user message (append attached file names and skill as context hint)
            var displayText = text
            if let sid = skillId, let skill = dataStore.apiSkills.first(where: { $0.id == sid }) {
                displayText += "\n\n🪄 " + skill.name
            }
            if !attachedFileIds.isEmpty {
                let names = attachedFileIds.compactMap { fid in apiFiles.first { $0.id == fid }?.name }
                if !names.isEmpty {
                    displayText += "\n\n📎 " + names.joined(separator: ", ")
                }
            }
            let userMsg = APIMessage(id: Int.random(in: 100000...999999),
                                     conversationId: convId ?? 0,
                                     role: "user", content: displayText,
                                     metadataJson: nil,
                                     createdAt: Date())
            chatMessages.append(userMsg)
            chatScrollTarget = userMsg.id

            let stream = await APIClient.shared.streamChat(
                conversationId: convId,
                content: text,
                projectId: apiProjectId,
                skillId: skillId,
                fileIds: attachedFileIds
            )
            do {
                var assembled = ""
                var chunkCount = 0
                for try await chunk in stream {
                    chunkCount += 1
                    if case .conversationId(let id) = chunk {
                        await MainActor.run { if activeConversationId == nil { activeConversationId = id } }
                    } else if case .text(let t) = chunk {
                        assembled += t
                        let snapshot = assembled
                        await MainActor.run { streamingContent = snapshot }
                    } else if case .title(let t) = chunk {
                        await MainActor.run {
                            if let idx = projectConversations.firstIndex(where: { $0.id == convId }) {
                                projectConversations[idx].title = t
                            }
                            if let idx = dataStore.conversations.firstIndex(where: { $0.id == convId }) {
                                dataStore.conversations[idx].title = t
                            }
                        }
                    }
                }
                if assembled.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    // No text came back — show error placeholder
                    let errMsg = APIMessage(id: Int.random(in: 100000...999999),
                                           conversationId: convId ?? 0,
                                           role: "assistant",
                                           content: lang.t("⚠️ AI 未返回响应，请重试", "⚠️ No response from AI, please retry"),
                                           metadataJson: nil,
                                           createdAt: Date())
                    chatMessages.append(errMsg)
                } else {
                    let assistantMsg = APIMessage(id: Int.random(in: 100000...999999),
                                                  conversationId: convId ?? 0,
                                                  role: "assistant", content: assembled,
                                                  metadataJson: nil,
                                                  createdAt: Date())
                    chatMessages.append(assistantMsg)
                    chatScrollTarget = assistantMsg.id
                }
            } catch {
                let errMsg = APIMessage(id: Int.random(in: 100000...999999),
                                        conversationId: convId ?? 0,
                                        role: "assistant",
                                        content: lang.t("⚠️ 请求失败：\(error.localizedDescription)", "⚠️ Request failed: \(error.localizedDescription)"),
                                        metadataJson: nil,
                                        createdAt: Date())
                chatMessages.append(errMsg)
            }
            streamingContent = ""
            isStreaming = false
        }
    }

    // MARK: - Project profile card

    private var projectProfileCard: some View {
        let apiProj = dataStore.apiProjects.first { $0.name == project.name }
        let description = apiProj?.description ?? ""
        let statusColor = Color(hex: liveProject.status.color)

        return CardContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Header row: title + status badge inline
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                    Text(lang.t("项目概要", "PROJECT PROFILE"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.5)
                    Spacer()
                    // Compact status badge with menu
                    if let pid = apiProjectId {
                        Menu {
                            ForEach(Project.ProjectStatus.allCases, id: \.self) { s in
                                if s != liveProject.status {
                                    Button {
                                        Task { await dataStore.updateProjectStatus(apiId: pid, status: s.rawValue) }
                                    } label: {
                                        Label(s.label(for: lang), systemImage: "circle.fill")
                                    }
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Circle().fill(statusColor).frame(width: 6, height: 6)
                                Text(liveProject.status.label(for: lang))
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundColor(statusColor)
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 8, weight: .medium))
                                    .foregroundColor(statusColor.opacity(0.7))
                            }
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(statusColor.opacity(0.1))
                            .clipShape(Capsule())
                        }
                        .menuStyle(.borderlessButton)
                    } else {
                        HStack(spacing: 4) {
                            Circle().fill(statusColor).frame(width: 6, height: 6)
                            Text(liveProject.status.label(for: lang))
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(statusColor)
                        }
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(statusColor.opacity(0.1))
                        .clipShape(Capsule())
                    }
                }
                .padding(Spacing.lg)

                Divider().opacity(0.4)

                VStack(alignment: .leading, spacing: 0) {
                    metaRow(lang.t("客户", "Client"), value: liveProject.client)
                    metaRow(lang.t("周期", "Period"), value: liveProject.period)

                    // Project description
                    if !description.isEmpty {
                        Divider().opacity(0.25).padding(.vertical, 4)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(lang.t("项目简介", "OVERVIEW"))
                                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                            Text(description)
                                .font(TextStyle.bodySM).foregroundColor(.onSurface)
                                .fixedSize(horizontal: false, vertical: true)
                                .lineSpacing(3)
                        }
                        .padding(.vertical, Spacing.sm)
                    }

                    // Context summary points (if any)
                    if !liveProject.contextSummary.isEmpty {
                        Divider().opacity(0.25).padding(.vertical, 4)
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            Text(lang.t("背景", "CONTEXT"))
                                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                            ForEach(liveProject.contextSummary, id: \.self) { point in
                                HStack(alignment: .top, spacing: 6) {
                                    Circle().fill(Color.primary500).frame(width: 4, height: 4).padding(.top, 6)
                                    Text(point).font(TextStyle.bodySM).foregroundColor(.onSurface)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        .padding(.top, Spacing.xs)
                    }
                }
                .padding(.horizontal, Spacing.lg).padding(.bottom, Spacing.lg)
            }
        }
    }

    // MARK: - Milestones card

    private var milestonesCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack {
                    Text(lang.t("里程碑", "MILESTONES"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.6)
                    Spacer()
                    let done = apiMilestones.filter(\.isDone).count
                    let total = apiMilestones.count
                    if total > 0 {
                        Text("\(done)/\(total)")
                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                        ProgressBar(progress: total > 0 ? Double(done) / Double(total) : 0, height: 5)
                            .frame(width: 60)
                    }
                    Button {
                        showAddMilestone.toggle()
                        newMilestoneTitle = ""
                        newMilestoneDueDate = ""
                        newMilestonePriority = "medium"
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.primary500)
                    }
                    .buttonStyle(.plain)
                }
                .padding(Spacing.lg)

                if showAddMilestone {
                    Divider().opacity(0.4)
                    addMilestoneForm
                }

                if apiMilestones.isEmpty && !showAddMilestone {
                    Text(lang.t("暂无里程碑，点击 + 添加", "No milestones yet. Tap + to add one."))
                        .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                        .padding(Spacing.lg)
                } else if !apiMilestones.isEmpty {
                    Divider().opacity(0.4)
                    VStack(spacing: 0) {
                        ForEach(apiMilestones) { ms in
                            LiveMilestoneRow(
                                milestone: ms,
                                onToggle: { isDone in
                                    guard let pid = apiProjectId else { return }
                                    Task {
                                        await dataStore.toggleMilestone(apiProjectId: pid, milestoneId: ms.id, isDone: isDone)
                                        apiMilestones = await dataStore.loadProjectMilestones(apiProjectId: pid)
                                    }
                                },
                                onDelete: {
                                    guard let pid = apiProjectId else { return }
                                    Task {
                                        await dataStore.deleteMilestone(apiProjectId: pid, milestoneId: ms.id)
                                        apiMilestones = await dataStore.loadProjectMilestones(apiProjectId: pid)
                                    }
                                }
                            )
                            if ms.id != apiMilestones.last?.id {
                                Divider().opacity(0.25).padding(.leading, 46)
                            }
                        }
                    }
                }
            }
        }
    }

    // Inline add-milestone form
    private var addMilestoneForm: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            TextField(lang.t("里程碑标题…", "Milestone title…"), text: $newMilestoneTitle)
                .textFieldStyle(.plain)
                .font(TextStyle.bodyMD)
                .foregroundColor(.onSurface)
                .padding(Spacing.sm)
                .background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))

            HStack(spacing: Spacing.sm) {
                Picker(lang.t("优先级", "Priority"), selection: $newMilestonePriority) {
                    Text(lang.t("低", "Low")).tag("low")
                    Text(lang.t("中", "Medium")).tag("medium")
                    Text(lang.t("高", "High")).tag("high")
                }
                .pickerStyle(.menu)
                .font(TextStyle.labelSM)

                TextField(lang.t("截止日期（可选）", "Due date (optional)"), text: $newMilestoneDueDate)
                    .textFieldStyle(.plain)
                    .font(TextStyle.labelSM)
                    .foregroundColor(.onSurface)
                    .padding(Spacing.sm)
                    .background(Color.surfaceContainerHighest)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.sm))

                Spacer()

                Button(lang.t("取消", "Cancel")) {
                    showAddMilestone = false
                }
                .buttonStyle(.plain)
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)

                Button(lang.t("添加", "Add")) {
                    let title = newMilestoneTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !title.isEmpty, let pid = apiProjectId else { return }
                    showAddMilestone = false
                    Task {
                        _ = await dataStore.createMilestone(
                            apiProjectId: pid,
                            title: title,
                            priority: newMilestonePriority,
                            dueDate: newMilestoneDueDate.isEmpty ? nil : newMilestoneDueDate
                        )
                        apiMilestones = await dataStore.loadProjectMilestones(apiProjectId: pid)
                    }
                }
                .buttonStyle(.plain)
                .font(TextStyle.labelSM).fontWeight(.semibold)
                .foregroundColor(.primary500)
                .disabled(newMilestoneTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(Spacing.lg)
        .background(Color.primaryFixed.opacity(0.3))
    }

    // MARK: - File Library card

    private var fileLibraryCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack {
                    Text(lang.t("文件库", "FILE LIBRARY"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.6)
                    Spacer()
                    if isUploadingFile {
                        HStack(spacing: 6) {
                            ProgressView(value: uploadProgress)
                                .progressViewStyle(.linear)
                                .frame(width: 80)
                                .tint(.primary500)
                            Text(uploadProgressText)
                                .font(.system(size: 10))
                                .foregroundColor(.onSurfaceVariant)
                                .lineLimit(1)
                        }
                    } else {
                        Text(lang.t("\(apiFiles.count) 个文件", "\(apiFiles.count) files"))
                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                    }
                }
                .padding(Spacing.lg)
                Divider().opacity(0.4)

                if apiFolders.isEmpty && apiFiles.isEmpty {
                    // Empty state
                    Button { uploadTargetFolderId = nil; isImportingFiles = true } label: {
                        VStack(spacing: Spacing.sm) {
                            Image(systemName: "doc.badge.plus")
                                .font(.system(size: 28)).foregroundColor(.primary500.opacity(0.5))
                            Text(lang.t("上传项目文件", "Upload project files"))
                                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                            Text(lang.t("PDF、Word、Excel、PowerPoint", "PDF, Word, Excel, PowerPoint"))
                                .font(.system(size: 11)).foregroundColor(.onSurfaceVariant.opacity(0.7))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.xxl)
                        .background(Color.surfaceContainerLowest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.md)
                                .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5]))
                                .foregroundColor(Color.outlineVariant.opacity(0.5))
                        )
                    }
                    .buttonStyle(.plain)
                    .padding(Spacing.lg)
                } else {
                    // Folder sections
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(apiFolders) { folder in
                            let folderFiles = apiFiles.filter { $0.folderId == folder.id }
                            let isExpanded = expandedFolderIds.contains(folder.id)
                            FolderSectionRow(
                                folder: folder,
                                files: folderFiles,
                                isExpanded: isExpanded,
                                onToggle: {
                                    if isExpanded { expandedFolderIds.remove(folder.id) }
                                    else { expandedFolderIds.insert(folder.id) }
                                },
                                onUpload: {
                                    uploadTargetFolderId = folder.id
                                    isImportingFiles = true
                                },
                                onDeleteFile: { fileId in
                                    guard let pid = apiProjectId else { return }
                                    Task {
                                        await dataStore.deleteProjectFile(apiProjectId: pid, fileId: fileId)
                                        apiFiles = await dataStore.loadProjectFiles(apiProjectId: pid)
                                    }
                                }
                            )
                            Divider().opacity(0.3)
                        }

                        // Unfoldered files
                        let unfolderedFiles = apiFiles.filter { $0.folderId == nil }
                        if !unfolderedFiles.isEmpty {
                            VStack(alignment: .leading, spacing: Spacing.xs) {
                                Text(lang.t("其他文件", "Other Files"))
                                    .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                                    .padding(.horizontal, Spacing.md).padding(.top, Spacing.sm)
                                ForEach(unfolderedFiles) { file in
                                    FolderFileRow(file: file, onDelete: {
                                        guard let pid = apiProjectId else { return }
                                        Task {
                                            await dataStore.deleteProjectFile(apiProjectId: pid, fileId: file.id)
                                            apiFiles = await dataStore.loadProjectFiles(apiProjectId: pid)
                                        }
                                    })
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Inline chat panel (middle column)

    @State private var hoveredConvId: Int? = nil

    private var inlineChatPanel: some View {
        VStack(spacing: 0) {
            // ── Conversation tab bar ──────────────────────────────
            HStack(spacing: 0) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 0) {
                        if projectConversations.isEmpty {
                            Text(lang.t("暂无对话", "No conversations"))
                                .font(.system(size: 11)).foregroundColor(.onSurfaceVariant.opacity(0.5))
                                .padding(.horizontal, Spacing.lg)
                        } else {
                            ForEach(projectConversations) { conv in
                                let isActive = conv.id == activeConversationId
                                let isHovered = hoveredConvId == conv.id
                                let showClose = isActive || isHovered

                                Button {
                                    activeConversationId = conv.id
                                    Task { chatMessages = await dataStore.loadMessages(conversationId: conv.id) }
                                } label: {
                                    HStack(spacing: 4) {
                                        if !showClose {
                                            Image(systemName: "bubble.left")
                                                .font(.system(size: 9))
                                                .foregroundColor(.onSurfaceVariant.opacity(0.5))
                                        }
                                        Text(conv.title.isEmpty ? lang.t("对话 #\(conv.id)", "Chat #\(conv.id)") : conv.title)
                                            .font(.system(size: 11, weight: isActive ? .semibold : .regular))
                                            .foregroundColor(isActive ? .primary500 : .onSurfaceVariant)
                                            .lineLimit(1)
                                        // Close button (hover or active)
                                        if showClose {
                                            Button {
                                                deleteConversation(conv)
                                            } label: {
                                                Image(systemName: "xmark")
                                                    .font(.system(size: 8, weight: .bold))
                                                    .foregroundColor(isActive ? .primary500.opacity(0.7) : .onSurfaceVariant.opacity(0.5))
                                                    .frame(width: 14, height: 14)
                                                    .background(
                                                        Circle().fill(isActive ? Color.primary500.opacity(0.1) : Color.onSurfaceVariant.opacity(0.08))
                                                    )
                                            }
                                            .buttonStyle(.plain)
                                            .help(lang.t("删除对话", "Delete conversation"))
                                        }
                                    }
                                    .padding(.leading, Spacing.md)
                                    .padding(.trailing, showClose ? Spacing.sm : Spacing.md)
                                    .frame(height: 36)
                                    .background(isActive ? Color.primary500.opacity(0.06) : Color.clear)
                                    .overlay(
                                        Rectangle().frame(height: 2).foregroundColor(isActive ? .primary500 : .clear),
                                        alignment: .bottom
                                    )
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .onHover { over in hoveredConvId = over ? conv.id : nil }
                                .contextMenu {
                                    Button(role: .destructive) {
                                        deleteConversation(conv)
                                    } label: {
                                        Label(lang.t("删除对话", "Delete Conversation"), systemImage: "trash")
                                    }
                                }
                            }
                        }
                    }
                }

                Divider().frame(height: 18).opacity(0.5)

                // Upload progress indicator
                if isUploadingFile {
                    HStack(spacing: 6) {
                        ProgressView(value: uploadProgress)
                            .progressViewStyle(.linear)
                            .frame(width: 80)
                            .tint(.primary500)
                        Text(uploadProgressText)
                            .font(.system(size: 10))
                            .foregroundColor(.onSurfaceVariant)
                    }
                    .padding(.horizontal, Spacing.sm)
                }

                // Search
                Button { showSearch = true } label: {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 11))
                        .foregroundColor(.onSurfaceVariant)
                        .frame(width: 32, height: 36)
                }
                .buttonStyle(.plain)
                .help(lang.t("搜索", "Search"))
                .popover(isPresented: $showSearch, arrowEdge: .bottom) {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Text(lang.t("在项目中搜索", "Search in Project"))
                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                        SearchBar(text: $navSearchText, placeholder: lang.t("搜索里程碑、文件…", "Search milestones, files…"))
                            .frame(width: 260)
                        if navSearchText.isEmpty {
                            Text(lang.t("输入关键词开始搜索", "Type to search"))
                                .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                        } else {
                            let msHits = apiMilestones.filter { $0.title.localizedCaseInsensitiveContains(navSearchText) }
                            let fHits  = apiFiles.filter     { $0.name.localizedCaseInsensitiveContains(navSearchText) }
                            if msHits.isEmpty && fHits.isEmpty {
                                Text(lang.t("无匹配结果", "No results found"))
                                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                            } else {
                                if !msHits.isEmpty {
                                    Text(lang.t("里程碑", "MILESTONES"))
                                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                                    ForEach(msHits.prefix(3), id: \.id) { m in
                                        Text(m.title).font(TextStyle.bodyMD).foregroundColor(.onSurface)
                                    }
                                }
                                if !fHits.isEmpty {
                                    Text(lang.t("文件", "FILES"))
                                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                                    ForEach(fHits.prefix(3), id: \.id) { f in
                                        Text(f.name).font(TextStyle.bodyMD).foregroundColor(.onSurface)
                                    }
                                }
                            }
                        }
                    }
                    .padding(Spacing.lg).frame(width: 300)
                    .background(Color.surfaceContainerLowest)
                }

                Divider().frame(height: 18).opacity(0.5)

                // New conversation
                Button {
                    Task {
                        if let pid = apiProjectId {
                            let conv = await dataStore.createConversation(projectId: pid)
                            if let c = conv {
                                projectConversations.insert(c, at: 0)
                                activeConversationId = c.id
                                chatMessages = []
                            }
                        }
                    }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.onSurfaceVariant)
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .help(lang.t("新建对话", "New conversation"))

                // Export conversation
                Button { showExportPanel = true } label: {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 11)).foregroundColor(.onSurfaceVariant)
                        .frame(width: 32, height: 36)
                }
                .buttonStyle(.plain)
                .help(lang.t("导出对话", "Export conversation"))
                .popover(isPresented: $showExportPanel, arrowEdge: .bottom) {
                    exportPopover
                }

                // Open in full chat
                Button { appState.selectedScreen = .chat } label: {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 12)).foregroundColor(.onSurfaceVariant.opacity(0.5))
                        .frame(width: 32, height: 36)
                }
                .buttonStyle(.plain)
                .help(lang.t("在完整对话界面打开", "Open in full Chat view"))
            }
            .frame(height: 36)
            .background(.surfaceContainerLowest)
            .overlay(Divider().opacity(0.4), alignment: .bottom)

            // ── Messages area ─────────────────────────────────────
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 2) {
                        if chatMessages.isEmpty && !isStreaming {
                            VStack(spacing: 24) {
                                // ── Icon + title ─────────────────────────────────
                                VStack(spacing: 16) {
                                    ZStack {
                                        Circle()
                                            .strokeBorder(Color.primary500.opacity(0.08), lineWidth: 1)
                                            .frame(width: 100, height: 100)
                                        Circle()
                                            .strokeBorder(Color.primary500.opacity(0.14), lineWidth: 1)
                                            .frame(width: 80, height: 80)
                                        Circle()
                                            .fill(LinearGradient(
                                                colors: [Color.primary500.opacity(0.15), Color(hex: "#6366F1").opacity(0.10)],
                                                startPoint: .topLeading, endPoint: .bottomTrailing))
                                            .frame(width: 60, height: 60)
                                        Image(systemName: "sparkles")
                                            .font(.system(size: 22, weight: .light))
                                            .foregroundStyle(
                                                LinearGradient(colors: [.primary500, Color(hex: "#6366F1")],
                                                               startPoint: .topLeading, endPoint: .bottomTrailing)
                                            )
                                        Circle().fill(Color.primary500.opacity(0.35)).frame(width: 5, height: 5)
                                            .offset(x: 34, y: -22)
                                        Circle().fill(Color(hex: "#6366F1").opacity(0.25)).frame(width: 4, height: 4)
                                            .offset(x: -30, y: 28)
                                        Circle().fill(Color.primary500.opacity(0.2)).frame(width: 3, height: 3)
                                            .offset(x: 12, y: -42)
                                    }
                                    .frame(width: 100, height: 100)
                                    VStack(spacing: 5) {
                                        Text(lang.t("开始项目对话", "Start a conversation"))
                                            .font(.system(size: 15, weight: .semibold)).foregroundColor(.onSurface)
                                        Text(lang.t("AI 自动获取项目背景，提供针对性建议", "AI loads project context for tailored insights"))
                                            .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                                            .multilineTextAlignment(.center)
                                    }
                                }

                                // ── Quick suggestion cards ────────────────────────
                                VStack(spacing: 10) {
                                    Text(lang.t("快速开始", "Quick Start"))
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundColor(.onSurfaceVariant.opacity(0.6))
                                        .tracking(1.0)
                                        .opacity(suggestionsVisible ? 1 : 0)
                                        .animation(.easeOut(duration: 0.3).delay(0.1), value: suggestionsVisible)

                                    LazyVGrid(
                                        columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)],
                                        spacing: 8
                                    ) {
                                        ForEach(Array(quickSuggestions.enumerated()), id: \.offset) { i, qs in
                                            QuickSuggestionCard(
                                                icon: qs.icon, title: qs.title, subtitle: qs.subtitle,
                                                color: qs.color, index: i, isVisible: suggestionsVisible
                                            )
                                            .onTapGesture {
                                                inlineChatInput = qs.prompt
                                                sendInlineMessage()
                                            }
                                        }
                                    }
                                }
                                .frame(maxWidth: 540)
                                .padding(.horizontal, Spacing.xl)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 48)
                            .onAppear {
                                suggestionsVisible = false
                                withAnimation { suggestionsVisible = true }
                            }
                            .onDisappear { suggestionsVisible = false }
                        } else {
                            ForEach(chatMessages) { msg in
                                InlineChatBubble(
                                    message: msg,
                                    onSaveToProject: msg.role == "assistant" ? { content in
                                        guard let pid = apiProjectId else { return }
                                        Task { await dataStore.saveProjectNote(apiProjectId: pid, content: content) }
                                    } : nil
                                ).id(msg.id)
                            }
                            if isStreaming {
                                InlineStreamingBubble(content: streamingContent).id("streaming")
                            }
                        }
                    }
                    .padding(.vertical, Spacing.xl)
                }
                .background(Color.surfaceBase)
                .onChange(of: chatScrollTarget) { _, _ in
                    if let t = chatScrollTarget { withAnimation { proxy.scrollTo(t, anchor: .bottom) } }
                }
                .onChange(of: isStreaming) { _, _ in
                    if isStreaming { withAnimation { proxy.scrollTo("streaming", anchor: .bottom) } }
                }
                .onChange(of: streamingContent) { _, _ in
                    proxy.scrollTo("streaming", anchor: .bottom)
                }
            }

            // ── Input bar ─────────────────────────────────────────
            VStack(spacing: 0) {
                Divider().opacity(0.4)

                // Selected file chips
                if !selectedFileIds.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(Array(selectedFileIds), id: \.self) { fid in
                                if let file = apiFiles.first(where: { $0.id == fid }) {
                                    HStack(spacing: 4) {
                                        Image(systemName: "paperclip")
                                            .font(.system(size: 9))
                                            .foregroundColor(.primary500)
                                        Text(file.name)
                                            .font(.system(size: 11))
                                            .foregroundColor(.onSurface)
                                            .lineLimit(1)
                                        Button {
                                            selectedFileIds.remove(fid)
                                        } label: {
                                            Image(systemName: "xmark")
                                                .font(.system(size: 8, weight: .bold))
                                                .foregroundColor(.onSurfaceVariant)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                    .padding(.horizontal, 8).padding(.vertical, 4)
                                    .background(Color.primary500.opacity(0.08))
                                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary500.opacity(0.2), lineWidth: 1))
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                }
                            }
                        }
                        .padding(.horizontal, Spacing.xl)
                        .padding(.top, 8)
                    }
                }

                HStack(spacing: 10) {
                    TextField(lang.t("询问项目相关问题，@ 调用技能，# 关联文档", "Ask about project, @ for skills, # for files"), text: $inlineChatInput, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(TextStyle.bodyMD).foregroundColor(.onSurface)
                        .frame(minHeight: 60, alignment: .topLeading)
                        .lineLimit(1...15)
                        .onChange(of: inlineChatInput) { _, newText in
                            if newText.last == "@" && !showSkillPicker { showSkillPicker = true }
                            if newText.last == "#" && !showFilePicker { showFilePicker = true }
                        }
                        .onSubmit {
                            sendInlineMessage()
                        }

                    // Skill selector
                    Button {
                        showSkillPicker.toggle()
                    } label: {
                        if let skillId = selectedSkillId ?? pendingSuggestionSkillId,
                           let skill = dataStore.apiSkills.first(where: { $0.id == skillId }) {
                            HStack(spacing: 4) {
                                Image(systemName: "wand.and.stars")
                                    .font(.system(size: 11))
                                Text(skill.name)
                                    .font(.system(size: 11))
                                    .lineLimit(1)
                            }
                            .foregroundColor(.primary500)
                        } else {
                            Image(systemName: "wand.and.stars")
                                .font(.system(size: 13))
                                .foregroundColor(.onSurfaceVariant.opacity(0.5))
                        }
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: $showSkillPicker, arrowEdge: .top) {
                        skillPickerPopover
                    }

                    // File attachment picker
                    Button {
                        showFilePicker.toggle()
                    } label: {
                        Image(systemName: selectedFileIds.isEmpty ? "paperclip" : "paperclip.badge.ellipsis")
                            .font(.system(size: 13))
                            .foregroundColor(selectedFileIds.isEmpty ? .onSurfaceVariant.opacity(0.5) : .primary500)
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: $showFilePicker, arrowEdge: .top) {
                        filePickerPopover
                    }

                    if isStreaming {
                        ProgressView().controlSize(.mini).tint(.primary500)
                    } else {
                        let hasText = !inlineChatInput.trimmingCharacters(in: .whitespaces).isEmpty
                        Button { sendInlineMessage() } label: {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(hasText ? .white : .onSurfaceVariant.opacity(0.4))
                                .frame(width: 26, height: 26)
                                .background(hasText
                                    ? LinearGradient(colors: [.primary500, Color(hex: "#6366F1")], startPoint: .topLeading, endPoint: .bottomTrailing)
                                    : LinearGradient(colors: [Color.surfaceContainerHigh, Color.surfaceContainerHigh], startPoint: .topLeading, endPoint: .bottomTrailing))
                                .clipShape(Circle())
                        }
                        .buttonStyle(.plain).disabled(!hasText)
                        .animation(.easeInOut(duration: 0.15), value: hasText)
                    }
                }
                .padding(.horizontal, Spacing.xl).padding(.vertical, 10)
                .background(Color.surfaceContainerLowest)
            }
        }
    }

    // MARK: - File picker popover

    private var filePickerPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(lang.t("关联文件", "Attach Files"))
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.onSurface)
                .padding(.horizontal, 14).padding(.vertical, 10)

            Divider().opacity(0.4)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Files grouped by folder
                    let unassigned = apiFiles.filter { $0.folderId == nil }
                    let folderIds = Array(Set(apiFiles.compactMap { $0.folderId })).sorted()

                    if !unassigned.isEmpty {
                        filePickerSection(title: lang.t("未分类", "Uncategorized"), files: unassigned)
                    }
                    ForEach(folderIds, id: \.self) { fid in
                        if let folder = apiFolders.first(where: { $0.id == fid }) {
                            let filesInFolder = apiFiles.filter { $0.folderId == fid }
                            if !filesInFolder.isEmpty {
                                filePickerSection(title: folder.name, files: filesInFolder)
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .frame(width: 280, height: min(CGFloat(apiFiles.count) * 36 + 60, 320))
        .background(Color.surfaceContainerLowest)
    }

    // MARK: - Skill picker popover

    private var skillPickerPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(lang.t("选择技能", "Select Skill"))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.onSurface)
                Spacer()
                if selectedSkillId != nil || pendingSuggestionSkillId != nil {
                    Button {
                        selectedSkillId = nil
                        pendingSuggestionSkillId = nil
                    } label: {
                        Text(lang.t("清除", "Clear"))
                            .font(.system(size: 11))
                            .foregroundColor(.primary500)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)

            Divider().opacity(0.4)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(dataStore.apiSkills) { skill in
                        let isSelected = (selectedSkillId ?? pendingSuggestionSkillId) == skill.id
                        Button {
                            if isSelected {
                                selectedSkillId = nil
                                pendingSuggestionSkillId = nil
                            } else {
                                selectedSkillId = skill.id
                                pendingSuggestionSkillId = nil
                                // Remove @ and insert skill template or name
                                if !skill.userTemplate.isEmpty {
                                    inlineChatInput = skill.userTemplate
                                } else {
                                    inlineChatInput = inlineChatInput.replacingOccurrences(of: "@", with: "")
                                }
                            }
                            showSkillPicker = false
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 13))
                                    .foregroundColor(isSelected ? .primary500 : .onSurfaceVariant.opacity(0.4))
                                Image(systemName: "wand.and.stars")
                                    .font(.system(size: 11))
                                    .foregroundColor(.primary500)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(skill.name)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundColor(.onSurface)
                                        .lineLimit(1)
                                    if !skill.description.isEmpty {
                                        Text(skill.description)
                                            .font(.system(size: 10))
                                            .foregroundColor(.onSurfaceVariant)
                                            .lineLimit(2)
                                    }
                                }
                                Spacer()
                            }
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(isSelected ? Color.primary500.opacity(0.06) : Color.clear)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .frame(width: 320, height: min(CGFloat(dataStore.apiSkills.count) * 52 + 60, 400))
        .background(Color.surfaceContainerLowest)
    }

    private func filePickerSection(title: String, files: [APIProjectFile]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.onSurfaceVariant)
                .padding(.horizontal, 14).padding(.top, 8).padding(.bottom, 4)
            ForEach(files) { file in
                let isSelected = selectedFileIds.contains(file.id)
                Button {
                    if isSelected {
                        selectedFileIds.remove(file.id)
                    } else {
                        selectedFileIds.insert(file.id)
                        // Remove # from input if it was triggered by typing #
                        if inlineChatInput.last == "#" {
                            inlineChatInput = String(inlineChatInput.dropLast())
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 13))
                            .foregroundColor(isSelected ? .primary500 : .onSurfaceVariant.opacity(0.4))
                        Image(systemName: fileIconName(for: file.fileType))
                            .font(.system(size: 11))
                            .foregroundColor(.onSurfaceVariant)
                        Text(file.name)
                            .font(.system(size: 12))
                            .foregroundColor(.onSurface)
                            .lineLimit(1)
                        Spacer()
                    }
                    .padding(.horizontal, 14).padding(.vertical, 7)
                    .background(isSelected ? Color.primary500.opacity(0.06) : Color.clear)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func fileIconName(for fileType: String) -> String {
        switch fileType.lowercased() {
        case "pdf": return "doc.richtext"
        case "docx", "doc": return "doc.text"
        case "xlsx", "xls": return "tablecells"
        case "pptx", "ppt": return "play.rectangle"
        default: return "doc"
        }
    }

    // MARK: - Export

    private var exportPopover: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(lang.t("导出对话", "Export Conversation"))
                .font(TextStyle.titleSM).foregroundColor(.onSurface)

            if chatMessages.isEmpty {
                Text(lang.t("当前对话没有消息", "No messages in this conversation"))
                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
            } else {
                Text(lang.t("共 \(chatMessages.count) 条消息", "\(chatMessages.count) messages"))
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
        guard !chatMessages.isEmpty else { return }
        let convTitle = projectConversations.first(where: { $0.id == activeConversationId })?.title ?? "对话"
        let projectName = project.name
        let dateStr = Date().formatted(date: .abbreviated, time: .shortened)
        let fileDateStr = String(Date().formatted(.iso8601).prefix(10))

        if format == "pdf" {
            // Build plain text for print
            var text = "\(projectName) — \(convTitle)\n导出时间：\(dateStr)\n\n"
            for msg in chatMessages {
                let role = msg.role == "user" ? "用户" : "AI 助手"
                text += "[\(role)]\n\(msg.content)\n\n"
            }
            let attrStr = NSAttributedString(string: text, attributes: [
                .font: NSFont.systemFont(ofSize: 12),
                .foregroundColor: NSColor.black
            ])
            let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 520, height: 10000))
            textView.textStorage?.setAttributedString(attrStr)
            textView.sizeToFit()
            let printInfo = NSPrintInfo.shared.copy() as! NSPrintInfo
            printInfo.topMargin = 50; printInfo.bottomMargin = 50
            printInfo.leftMargin = 60; printInfo.rightMargin = 60
            printInfo.isHorizontallyCentered = false
            let op = NSPrintOperation(view: textView, printInfo: printInfo)
            op.showsPrintPanel = true
            op.showsProgressPanel = true
            op.run()
            return
        }

        var content = ""
        if format == "markdown" {
            content += "# \(projectName) — \(convTitle)\n\n"
            content += "_导出时间：\(dateStr)_\n\n---\n\n"
            for msg in chatMessages {
                let role = msg.role == "user" ? "**用户**" : "**AI 助手**"
                content += "\(role)\n\n\(msg.content)\n\n---\n\n"
            }
        } else {
            content += "\(projectName) — \(convTitle)\n"
            content += "导出时间：\(dateStr)\n\n"
            for msg in chatMessages {
                let role = msg.role == "user" ? "用户" : "AI 助手"
                content += "[\(role)]\n\(msg.content)\n\n"
            }
        }

        let ext = format == "markdown" ? "md" : "txt"
        let fileName = "\(projectName)-对话-\(fileDateStr).\(ext)"
        let panel = NSSavePanel()
        panel.nameFieldStringValue = fileName
        panel.allowedContentTypes = format == "markdown" ? [.init(filenameExtension: "md")!] : [.plainText]
        panel.begin { resp in
            if resp == .OK, let url = panel.url {
                try? content.write(to: url, atomically: true, encoding: .utf8)
            }
        }
    }

    // MARK: - Context & Notes card (right column)

    /// Renders a single note entry, detecting `[YYYY-MM-DD HH:MM]` timestamp headers.
    @ViewBuilder
    private func noteEntryView(for entry: String) -> some View {
        let trimmed = entry.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            let lines = trimmed.components(separatedBy: "\n")
            let firstLine = lines.first ?? ""
            let isTimestamped = firstLine.hasPrefix("[") && firstLine.hasSuffix("]") && firstLine.count <= 20
            if isTimestamped {
                let timestamp = String(firstLine.dropFirst().dropLast())
                let body = lines.dropFirst().joined(separator: "\n")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                VStack(alignment: .leading, spacing: 3) {
                    Text(timestamp)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(.onSurfaceVariant.opacity(0.45))
                        .tracking(0.3)
                    Text(body)
                        .font(.system(size: 11))
                        .foregroundColor(.onSurface.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                        .lineSpacing(3)
                }
                .padding(Spacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.surfaceContainerLow.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 5))
            } else {
                Text(trimmed)
                    .font(.system(size: 11))
                    .foregroundColor(.onSurface.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)
            }
        }
    }

    // Skeleton placeholder shown in right panel while detail data loads
    private var skeletonCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Fake header
                HStack(spacing: Spacing.sm) {
                    RoundedRectangle(cornerRadius: 3).fill(Color.onSurface.opacity(0.07)).frame(width: 14, height: 14)
                    RoundedRectangle(cornerRadius: 3).fill(Color.onSurface.opacity(0.07)).frame(width: 80, height: 10)
                    Spacer()
                }
                Divider().opacity(0.3)
                // Fake rows
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(0..<3, id: \.self) { i in
                        HStack(spacing: Spacing.sm) {
                            RoundedRectangle(cornerRadius: 3).fill(Color.onSurface.opacity(0.07))
                                .frame(width: i == 0 ? 90 : (i == 1 ? 70 : 110), height: 10)
                            Spacer()
                            RoundedRectangle(cornerRadius: 3).fill(Color.onSurface.opacity(0.07))
                                .frame(width: 50, height: 10)
                        }
                    }
                }
                .padding(.horizontal, Spacing.sm)
            }
            .padding(Spacing.lg)
        }
    }

    private var contextCard: some View {
        let apiProj = dataStore.apiProjects.first { $0.name == project.name }
        let savedSummary = apiProj?.contextSummary ?? ""
        let notes = apiProj?.notes ?? ""
        // During streaming show the live draft; after done show the saved value
        let displaySummary = isGeneratingContext ? streamingContextDraft : savedSummary
        let hasSummary = !displaySummary.isEmpty
        let hasNotes = !notes.isEmpty

        return CardContainer {
            VStack(alignment: .leading, spacing: 0) {
                // ── Header ────────────────────────────────────────────────────
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "brain")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                    Text(lang.t("项目记忆", "PROJECT MEMORY"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.5)
                    Spacer()

                    // Copy button — only when there's content
                    if hasSummary {
                        Button {
                            let clean = displaySummary
                                .components(separatedBy: "\n")
                                .map { line -> String in
                                    let t = line.trimmingCharacters(in: .whitespaces)
                                    return t.hasPrefix("•") ? String(t.dropFirst()).trimmingCharacters(in: .whitespaces) : t
                                }
                                .filter { !$0.isEmpty }
                                .joined(separator: "\n")
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(clean, forType: .string)
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 10))
                                .foregroundColor(.onSurfaceVariant.opacity(0.6))
                        }
                        .buttonStyle(.plain)
                        .help(lang.t("复制内容", "Copy content"))
                    }

                    // Refresh button
                    Button {
                        guard let pid = apiProjectId else { return }
                        streamContextSummary(pid: pid)
                    } label: {
                        HStack(spacing: 3) {
                            if isGeneratingContext {
                                ProgressView().controlSize(.mini).scaleEffect(0.7)
                            } else {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 9))
                            }
                            Text(lang.t("刷新摘要", "Refresh"))
                                .font(.system(size: 10))
                        }
                        .foregroundColor(.primary500)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(Color.primary500.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                    .buttonStyle(.plain)
                    .disabled(isGeneratingContext || apiProjectId == nil)

                    // Collapse / expand chevron
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { contextExpanded.toggle() }
                    } label: {
                        Image(systemName: contextExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.onSurfaceVariant.opacity(0.5))
                    }
                    .buttonStyle(.plain)
                }
                .padding(Spacing.lg)

                if contextExpanded {
                    Divider().opacity(0.4)

                    VStack(alignment: .leading, spacing: 0) {
                        if !hasSummary && !hasNotes {
                            // Empty state — tappable to trigger generation
                            Button {
                                guard let pid = apiProjectId else { return }
                                streamContextSummary(pid: pid)
                            } label: {
                                VStack(spacing: Spacing.sm) {
                                    Image(systemName: isGeneratingContext ? "sparkles" : "doc.badge.plus")
                                        .font(.system(size: 20))
                                        .foregroundColor(isGeneratingContext ? .primary500.opacity(0.5) : .onSurfaceVariant.opacity(0.3))
                                    Text(lang.t(
                                        isGeneratingContext ? "AI 正在生成摘要…" : "点击生成项目 AI 摘要",
                                        isGeneratingContext ? "Generating summary…" : "Click to generate AI summary"
                                    ))
                                    .font(.system(size: 11))
                                    .foregroundColor(.onSurfaceVariant.opacity(0.5))
                                    .multilineTextAlignment(.center)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(Spacing.lg)
                            }
                            .buttonStyle(.plain)
                            .disabled(isGeneratingContext || apiProjectId == nil)
                        } else {
                            // AI-generated summary
                            if hasSummary {
                                VStack(alignment: .leading, spacing: Spacing.sm) {
                                    Text(lang.t("AI 摘要", "AI SUMMARY"))
                                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                                    ForEach(displaySummary.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }, id: \.self) { line in
                                        let cleaned = line.hasPrefix("•") ? String(line.dropFirst()).trimmingCharacters(in: .whitespaces) : line
                                        HStack(alignment: .top, spacing: 5) {
                                            Circle().fill(Color.primary500).frame(width: 4, height: 4).padding(.top, 6)
                                            Group {
                                                if let attr = try? AttributedString(markdown: cleaned) {
                                                    Text(attr)
                                                } else {
                                                    Text(cleaned)
                                                }
                                            }
                                            .font(.system(size: 11)).foregroundColor(.onSurface)
                                            .fixedSize(horizontal: false, vertical: true)
                                            .textSelection(.enabled)
                                        }
                                    }
                                }
                                .padding(Spacing.lg)
                            }

                            // Accumulated notes
                            if hasNotes {
                                if hasSummary { Divider().opacity(0.3) }
                                VStack(alignment: .leading, spacing: Spacing.sm) {
                                    Text(lang.t("项目笔记", "PROJECT NOTES"))
                                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                                    VStack(alignment: .leading, spacing: 6) {
                                        let entries = notes.components(separatedBy: "\n\n---\n").reversed()
                                        ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                                            noteEntryView(for: entry)
                                        }
                                    }
                                }
                                .padding(Spacing.lg)
                            }
                        }
                    }
                }
            }
        }
    }

    private func streamContextSummary(pid: Int) {
        guard !isGeneratingContext else { return }
        isGeneratingContext = true
        streamingContextDraft = ""
        Task {
            do {
                for try await chunk in await APIClient.shared.streamContextGenerate(projectId: pid) {
                    let c = chunk
                    await MainActor.run { streamingContextDraft += c }
                }
                let final = await MainActor.run { streamingContextDraft }
                await MainActor.run { dataStore.patchProjectContextSummary(apiProjectId: pid, summary: final) }
            } catch {}
            await MainActor.run { isGeneratingContext = false }
        }
    }

    // MARK: - Financial card (right column)

    // MARK: - Financial Card (3 sections)

    private var financialCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack(spacing: Spacing.sm) {
                    ZStack {
                        Circle()
                            .fill(Color(hex: "#22C55E").opacity(0.12))
                            .frame(width: 22, height: 22)
                        Image(systemName: "yensign")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(Color(hex: "#22C55E"))
                    }
                    Text(lang.t("财务情况", "Financials"))
                        .font(.system(size: 11, weight: .semibold)).foregroundColor(.onSurface)
                    Spacer()
                    if apiProjectId != nil {
                        Button {
                            newContractAmount = financials.map { String(format: "%.0f", $0.contractAmount) } ?? ""
                            showSetContractAmount = true
                        } label: {
                            Image(systemName: "pencil")
                                .font(.system(size: 11))
                                .foregroundColor(.primary500)
                        }
                        .buttonStyle(.plain)
                        .popover(isPresented: $showSetContractAmount, arrowEdge: .trailing) {
                            contractAmountPopover
                        }
                    }
                }
                .padding(Spacing.lg)

                Divider().opacity(0.4)

                if let fin = financials {
                    VStack(alignment: .leading, spacing: 0) {

                        // ── Section 1: 项目金额 ──────────────────────────
                        finSection(icon: "doc.text", label: lang.t("项目金额", "Contract")) {
                            let contract = fin.contractAmount
                            VStack(alignment: .leading, spacing: 6) {
                                Text(contract == 0
                                     ? lang.t("未设置合同金额", "Contract not set")
                                     : "¥\(formatAmount(contract))")
                                    .font(.system(size: 20, weight: .bold))
                                    .foregroundColor(contract == 0 ? .onSurfaceVariant.opacity(0.4) : .onSurface)

                                if contract > 0 {
                                    // Received progress vs contract
                                    let rcvPct = min(fin.totalReceived / contract, 1.0)
                                    let expPct = min(fin.totalExpense / contract, 1.0)
                                    VStack(spacing: 4) {
                                        finBarRow(
                                            label: lang.t("已收款", "Received"),
                                            amount: fin.totalReceived,
                                            pct: rcvPct,
                                            color: Color(hex: "#22C55E")
                                        )
                                        finBarRow(
                                            label: lang.t("已支出", "Expenses"),
                                            amount: fin.totalExpense,
                                            pct: expPct,
                                            color: Color(hex: "#EF4444")
                                        )
                                    }
                                    // Net
                                    HStack {
                                        Text(lang.t("净收益", "Net"))
                                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                                        Spacer()
                                        let net = fin.totalReceived - fin.totalExpense
                                        Text((net >= 0 ? "+" : "") + "¥\(formatAmount(net))")
                                            .font(TextStyle.titleSM).fontWeight(.semibold)
                                            .foregroundColor(net >= 0 ? Color(hex: "#22C55E") : Color(hex: "#EF4444"))
                                    }
                                }
                            }
                        }

                        finDivider()

                        // ── Section 2: 消耗情况 ──────────────────────────
                        finSection(icon: "flame", label: lang.t("消耗情况", "Costs & Burn")) {
                            let expenses = fin.payments.filter { $0.paymentType == "expense" }
                            if expenses.isEmpty {
                                Text(lang.t("暂无支出记录", "No expenses recorded"))
                                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant.opacity(0.5))
                            } else {
                                VStack(spacing: 4) {
                                    HStack {
                                        Text(lang.t("累计支出", "Total Expenses"))
                                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                                        Spacer()
                                        Text("¥\(formatAmount(fin.totalExpense))")
                                            .font(TextStyle.titleSM).fontWeight(.semibold)
                                            .foregroundColor(Color(hex: "#EF4444"))
                                    }
                                    if fin.contractAmount > 0 {
                                        let burnPct = min(fin.totalExpense / fin.contractAmount, 1.0)
                                        HStack {
                                            Text(lang.t("成本占比", "Cost Ratio"))
                                                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                                            Spacer()
                                            Text(String(format: "%.1f%%", burnPct * 100))
                                                .font(TextStyle.titleSM)
                                                .foregroundColor(burnPct > 0.4 ? Color(hex: "#EF4444") : .onSurface)
                                        }
                                    }
                                    ForEach(expenses.reversed().prefix(3)) { p in
                                        paymentRow(p)
                                    }
                                    if expenses.count > 3 {
                                        Text(lang.t("…共\(expenses.count)笔", "…\(expenses.count) total"))
                                            .font(.system(size: 10)).foregroundColor(.onSurfaceVariant.opacity(0.6))
                                    }
                                }
                            }
                        }

                        finDivider()

                        // ── Section 3: 开票+收款 ──────────────────────────
                        finSection(icon: "list.bullet.rectangle", label: lang.t("开票·收款", "Invoice & Payment")) {
                            VStack(alignment: .leading, spacing: 8) {
                                // Summary row
                                HStack(spacing: 0) {
                                    finKPICell(
                                        label: lang.t("已开票", "Invoiced"),
                                        value: "¥\(formatAmount(fin.totalInvoiced))",
                                        color: Color(hex: "#3B82F6")
                                    )
                                    Divider().frame(height: 36)
                                    finKPICell(
                                        label: lang.t("已收款", "Collected"),
                                        value: "¥\(formatAmount(fin.totalReceived))",
                                        color: Color(hex: "#22C55E")
                                    )
                                    Divider().frame(height: 36)
                                    finKPICell(
                                        label: lang.t("待回款", "Uncollected"),
                                        value: "¥\(formatAmount(fin.uncollected))",
                                        color: fin.uncollected > 0 ? Color(hex: "#F59E0B") : .onSurfaceVariant
                                    )
                                }
                                .padding(.vertical, 4)
                                .background(Color.surfaceContainerHighest.opacity(0.4))
                                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))

                                // Timeline header + add button
                                HStack {
                                    Text(lang.t("明细", "Ledger"))
                                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                                    Spacer()
                                    if apiProjectId != nil {
                                        Button {
                                            newPaymentAmount = ""; newPaymentDate = todayString()
                                            newPaymentNote = ""; newPaymentType = "invoiced"
                                            showAddPayment = true
                                        } label: {
                                            Image(systemName: "plus")
                                                .font(.system(size: 11, weight: .bold))
                                                .foregroundColor(.primary500)
                                        }
                                        .buttonStyle(.plain)
                                        .popover(isPresented: $showAddPayment, arrowEdge: .trailing) {
                                            addPaymentPopover
                                        }
                                    }
                                }

                                // Timeline entries (invoiced + received + milestone only)
                                let ledger = fin.payments.filter { $0.paymentType != "expense" }.reversed()
                                if ledger.isEmpty {
                                    Text(lang.t("暂无记录，点击 + 添加", "No records yet. Tap + to add."))
                                        .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant.opacity(0.5))
                                } else {
                                    ForEach(Array(ledger)) { p in
                                        paymentRow(p)
                                    }
                                }
                            }
                        }
                    }
                } else {
                    VStack(spacing: Spacing.sm) {
                        Image(systemName: "yensign.circle")
                            .font(.system(size: 24)).foregroundColor(.onSurfaceVariant.opacity(0.3))
                        Text(lang.t("点击 ✏ 设置合同金额开始追踪", "Tap ✏ to set contract amount"))
                            .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant.opacity(0.6))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.xl)
                }
            }
        }
    }

    @ViewBuilder
    private func finSection<Content: View>(icon: String, label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 10, weight: .semibold)).foregroundColor(.onSurfaceVariant)
                Text(label).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.3)
            }
            content()
        }
        .padding(Spacing.lg)
    }

    private func finDivider() -> some View {
        Divider().opacity(0.25)
    }

    @ViewBuilder
    private func finBarRow(label: String, amount: Double, pct: Double, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(label).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                Spacer()
                Text("¥\(formatAmount(amount))").font(TextStyle.titleSM).foregroundColor(color)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3).fill(Color.surfaceContainerHighest).frame(height: 5)
                    RoundedRectangle(cornerRadius: 3).fill(color).frame(width: geo.size.width * pct, height: 5)
                }
            }
            .frame(height: 5)
        }
    }

    @ViewBuilder
    private func finKPICell(label: String, value: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value).font(TextStyle.titleSM).fontWeight(.semibold).foregroundColor(color).lineLimit(1)
            Text(label).font(.system(size: 9)).foregroundColor(.onSurfaceVariant)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.sm)
    }

    @ViewBuilder
    private func paymentRow(_ p: APIProjectPayment) -> some View {
        HStack(spacing: Spacing.sm) {
            let (icon, color) = paymentTypeStyle(p.paymentType)
            Image(systemName: icon).font(.system(size: 13)).foregroundColor(color)
            VStack(alignment: .leading, spacing: 1) {
                Text(p.note.isEmpty ? paymentTypeLabel(p.paymentType) : p.note)
                    .font(TextStyle.labelSM).foregroundColor(.onSurface).lineLimit(1)
                Text(p.paymentDate).font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
            }
            Spacer()
            let sign = p.paymentType == "expense" ? "-" : "+"
            Text(sign + "¥\(formatAmount(Swift.abs(p.amount)))")
                .font(TextStyle.titleSM).foregroundColor(color)
            if let pid = apiProjectId {
                Button {
                    Task {
                        await dataStore.deleteProjectPayment(apiProjectId: pid, paymentId: p.id)
                        await loadFinancials()
                    }
                } label: {
                    Image(systemName: "xmark").font(.system(size: 9)).foregroundColor(.onSurfaceVariant.opacity(0.4))
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var contractAmountPopover: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(lang.t("设置合同金额", "Set Contract Amount"))
                .font(TextStyle.titleSM).foregroundColor(.onSurface)
            HStack {
                Text("¥").font(TextStyle.bodyMD).foregroundColor(.onSurfaceVariant)
                TextField("0", text: $newContractAmount)
                    .textFieldStyle(.plain).font(TextStyle.bodyMD).frame(width: 140)
            }
            .padding(Spacing.sm)
            .background(Color.surfaceContainerHighest)
            .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
            HStack {
                Spacer()
                Button(lang.t("取消", "Cancel")) { showSetContractAmount = false }
                    .buttonStyle(.plain).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                Button(lang.t("保存", "Save")) {
                    if let amt = Double(newContractAmount), let pid = apiProjectId {
                        showSetContractAmount = false
                        Task { await dataStore.updateContractAmount(apiProjectId: pid, amount: amt)
                               await loadFinancials() }
                    }
                }
                .buttonStyle(.plain).font(TextStyle.labelSM).fontWeight(.semibold).foregroundColor(.primary500)
                .disabled(Double(newContractAmount) == nil)
            }
        }
        .padding(Spacing.lg).frame(width: 220)
        .background(Color.surfaceContainerLowest)
    }

    @ViewBuilder
    private var addPaymentPopover: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(lang.t("添加记录", "Add Record"))
                .font(TextStyle.titleSM).foregroundColor(.onSurface)

            // Type picker
            VStack(alignment: .leading, spacing: 4) {
                Text(lang.t("类型", "Type")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                HStack(spacing: 6) {
                    ForEach([("invoiced","开票","Invoice"),("received","收款","Payment"),
                             ("milestone_payment","里程碑款","Milestone"),("expense","支出","Expense")],
                            id: \.0) { type, zh, en in
                        Button {
                            newPaymentType = type
                        } label: {
                            Text(lang.t(zh, en))
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(newPaymentType == type ? .white : .onSurfaceVariant)
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(newPaymentType == type ? paymentTypeStyle(type).1 : Color.surfaceContainerHighest)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Amount
            HStack {
                Text("¥").font(TextStyle.bodyMD).foregroundColor(.onSurfaceVariant)
                TextField("0", text: $newPaymentAmount)
                    .textFieldStyle(.plain).font(TextStyle.bodyMD).frame(width: 120)
            }
            .padding(Spacing.sm).background(Color.surfaceContainerHighest)
            .clipShape(RoundedRectangle(cornerRadius: Radius.sm))

            TextField(lang.t("日期 (YYYY-MM-DD)", "Date (YYYY-MM-DD)"), text: $newPaymentDate)
                .textFieldStyle(.plain).font(TextStyle.bodyMD)
                .padding(Spacing.sm).background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))

            TextField(lang.t("备注（可选）", "Note (optional)"), text: $newPaymentNote)
                .textFieldStyle(.plain).font(TextStyle.bodyMD)
                .padding(Spacing.sm).background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))

            HStack {
                Spacer()
                Button(lang.t("取消", "Cancel")) { showAddPayment = false }
                    .buttonStyle(.plain).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                Button(lang.t("添加", "Add")) {
                    if let amt = Double(newPaymentAmount), let pid = apiProjectId {
                        showAddPayment = false
                        Task {
                            await dataStore.addProjectPayment(apiProjectId: pid, amount: amt,
                                                              paymentDate: newPaymentDate,
                                                              note: newPaymentNote,
                                                              paymentType: newPaymentType)
                            await loadFinancials()
                        }
                    }
                }
                .buttonStyle(.plain).font(TextStyle.labelSM).fontWeight(.semibold).foregroundColor(.primary500)
                .disabled(Double(newPaymentAmount) == nil || newPaymentDate.isEmpty)
            }
        }
        .padding(Spacing.lg).frame(width: 260)
        .background(Color.surfaceContainerLowest)
    }

    private func formatAmount(_ v: Double) -> String {
        let a = Swift.abs(v)
        if a >= 1_000_000 { return String(format: "%.1fM", a / 1_000_000) }
        if a >= 10_000    { return String(format: "%.1f万", a / 10_000) }
        return String(format: "%.0f", a)
    }

    private func todayString() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    private func paymentTypeStyle(_ t: String) -> (String, Color) {
        switch t {
        case "invoiced":          return ("doc.text.fill",      Color(hex: "#3B82F6"))
        case "received":          return ("arrow.down.circle.fill", Color(hex: "#22C55E"))
        case "milestone_payment": return ("flag.fill",          Color(hex: "#8B5CF6"))
        case "expense":           return ("arrow.up.circle.fill",   Color(hex: "#EF4444"))
        default:                  return ("circle.fill",        Color.onSurfaceVariant)
        }
    }

    private func paymentTypeLabel(_ t: String) -> String {
        switch t {
        case "invoiced":          return lang.t("开票", "Invoice")
        case "received":          return lang.t("收款", "Payment")
        case "milestone_payment": return lang.t("里程碑款", "Milestone payment")
        case "expense":           return lang.t("支出", "Expense")
        default:                  return t
        }
    }

    // MARK: - AI Suggestions card (right column)

    private var aiSuggestionsCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 0) {
                sectionHeader(lang.t("AI 建议", "AI Suggestions"), icon: "sparkles", iconColor: Color(hex: "#8B5CF6"))
                Divider().opacity(0.4)

                let groups = statusSuggestionGroups
                ForEach(Array(groups.enumerated()), id: \.offset) { gi, group in
                    // Section label (only for named groups)
                    if let label = group.label {
                        HStack(spacing: 5) {
                            if let icon = group.groupIcon, let color = group.groupColor {
                                Image(systemName: icon)
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(color)
                            }
                            Text(label)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundColor(.onSurfaceVariant)
                                .tracking(0.4)
                            Rectangle()
                                .fill(Color.outlineVariant.opacity(0.5))
                                .frame(height: 0.5)
                        }
                        .padding(.horizontal, Spacing.lg)
                        .padding(.top, gi == 0 ? Spacing.sm : Spacing.md)
                        .padding(.bottom, 2)
                    }

                    VStack(spacing: 0) {
                        ForEach(Array(group.items.enumerated()), id: \.offset) { i, s in
                            Button {
                                // 填充输入框但不立即发送
                                inlineChatInput = s.prompt
                                // 如果有关联的 skill，设置到聊天输入框（需要传递给 sendInlineMessage）
                                // 这里暂时存储到一个临时状态，发送时使用
                                pendingSuggestionSkillId = s.skillId
                                // 不调用 sendInlineMessage()，让用户可以编辑后再发送
                            } label: {
                                HStack(alignment: .top, spacing: Spacing.sm) {
                                    Image(systemName: s.icon)
                                        .font(.system(size: 12))
                                        .foregroundColor(group.groupColor ?? .primary500)
                                        .frame(width: 20)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(s.title)
                                            .font(TextStyle.labelMD).foregroundColor(.onSurface)
                                        Text(s.subtitle)
                                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                                            .lineLimit(2)
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "arrow.right")
                                        .font(.system(size: 10))
                                        .foregroundColor(.primary500.opacity(0.4))
                                }
                                .padding(.horizontal, Spacing.lg)
                                .padding(.vertical, Spacing.sm + 2)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            if i < group.items.count - 1 {
                                Divider().opacity(0.25).padding(.leading, Spacing.lg + 20)
                            }
                        }
                    }

                    if gi < groups.count - 1 {
                        Divider().opacity(0.2).padding(.horizontal, Spacing.lg).padding(.top, Spacing.xs)
                    }
                }
                .padding(.bottom, Spacing.sm)
            }
        }
    }

    // MARK: - Project stats card (right column)

    private var projectStatsCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 0) {
                sectionHeader(lang.t("项目进展", "Progress"), icon: "chart.bar", iconColor: Color(hex: "#3B82F6"))
                Divider().opacity(0.4)
                VStack(spacing: Spacing.md) {
                    statRow(
                        label: lang.t("文件数量", "Files"),
                        value: "\(apiFiles.count)",
                        progress: nil
                    )
                    statRow(
                        label: lang.t("历史对话", "Conversations"),
                        value: "\(projectConversations.count)",
                        progress: nil
                    )
                }
                .padding(Spacing.lg)
            }
        }
    }

    // MARK: - Status-aware AI suggestions

    private struct Suggestion {
        let icon: String
        let title: String
        let subtitle: String
        let prompt: String
        let skillId: Int?  // 关联的 skill ID（可选）

        init(icon: String, title: String, subtitle: String, prompt: String, skillId: Int? = nil) {
            self.icon = icon
            self.title = title
            self.subtitle = subtitle
            self.prompt = prompt
            self.skillId = skillId
        }
    }
    private struct SuggestionGroup {
        let label: String?
        let groupIcon: String?
        let groupColor: Color?
        let items: [Suggestion]
    }

    /// Top suggestions for the chat empty-state quick-start grid (4 items max).
    private var quickSuggestions: [(icon: String, title: String, subtitle: String, prompt: String, color: Color)] {
        let groups = statusSuggestionGroups
        var result: [(icon: String, title: String, subtitle: String, prompt: String, color: Color)] = []
        if groups.count == 1 {
            let c = groups[0].groupColor ?? .primary500
            for s in groups[0].items.prefix(4) { result.append((s.icon, s.title, s.subtitle, s.prompt, c)) }
        } else {
            for group in groups {
                let c = group.groupColor ?? .primary500
                for s in group.items.prefix(2) { result.append((s.icon, s.title, s.subtitle, s.prompt, c)) }
            }
        }
        return result
    }

    private var statusSuggestionGroups: [SuggestionGroup] {
        switch liveProject.status {

        // ── 客户线索：早期机会评估 ────────────────────────────────────────────
        case .lead:
            return [SuggestionGroup(label: nil, groupIcon: nil, groupColor: Color(hex: "#0EA5E9"), items: [
                Suggestion(
                    icon: "person.text.rectangle",
                    title: lang.t("客户需求挖掘", "Uncover Client Needs"),
                    subtitle: lang.t("识别核心痛点与切入口", "Identify pain points & entry angles"),
                    prompt: lang.t(
                        "深入分析这个项目目标客户的业务现状和核心痛点。请从行业背景、组织挑战、当前解决方案的不足三个维度入手，识别3-5个最有价值的切入点，并说明我们如何针对这些痛点展示独特价值。",
                        "Deeply analyze the target client's business situation and core pain points. Cover industry context, organizational challenges, and gaps in current solutions. Identify the top 3-5 high-value entry angles and explain how we can demonstrate unique value against each.")
                ),
                Suggestion(
                    icon: "gauge.with.dots.needle.67percent",
                    title: lang.t("机会可行性评估", "Opportunity Feasibility"),
                    subtitle: lang.t("时机、规模、竞争力评估", "Assess timing, scale & competitiveness"),
                    prompt: lang.t(
                        "从四个维度评估这个项目机会的可行性：①时机成熟度（客户内部推动力是否到位）②机会规模（潜在合同金额和可扩展性）③竞争格局（主要对手及我们的胜算）④能力匹配（我们的优势与差距）。最终给出是否值得全力跟进的建议及理由。",
                        "Evaluate this opportunity across four dimensions: ①Timing (internal momentum at client) ②Size (potential contract value and scalability) ③Competitive landscape (key rivals and our odds) ④Capability fit (our strengths and gaps). Conclude with a recommendation on whether to pursue aggressively.")
                ),
                Suggestion(
                    icon: "hand.wave",
                    title: lang.t("首次接触策略", "First Contact Strategy"),
                    subtitle: lang.t("建立初步信任的切入方式", "Build initial trust & open doors"),
                    prompt: lang.t(
                        "为这个项目设计一套初次接触客户的策略：推荐最佳切入话题（避免直接推销）、展示哪些能力或洞察能引发兴趣、如何在第一次互动中建立专业信任感。同时建议通过什么渠道或契机接触最合适的联系人。",
                        "Design a first-contact strategy for this project: recommend the best conversation topics (avoid hard-sell), identify which capabilities or insights to showcase to spark interest, and suggest how to build professional credibility in the first interaction. Also recommend the best channel and timing to reach the right contact.")
                )
            ])]

        // ── 商机阶段：赢标核心 ─────────────────────────────────────────────────
        case .opportunity:
            return [SuggestionGroup(label: nil, groupIcon: nil, groupColor: Color(hex: "#F59E0B"), items: [
                Suggestion(
                    icon: "trophy",
                    title: lang.t("赢标策略制定", "Win Strategy"),
                    subtitle: lang.t("差异化定位与制胜论点", "Differentiation & winning arguments"),
                    prompt: lang.t(
                        "基于当前项目信息，帮我制定一套完整的赢标策略：①分析评委最看重的三大决策因素②我们相比竞争对手最核心的三个差异化优势③提案中必须重点呈现的制胜论点④避免踩雷的常见失分项。目标是最大化我们的中标概率。",
                        "Based on the current project info, build a complete win strategy: ①The three decision factors evaluators care most about ②Our top three differentiators vs. competitors ③The winning arguments that must dominate the proposal ④Common mistakes to avoid that cost points. Goal: maximize our probability of winning.")
                ),
                Suggestion(
                    icon: "figure.2.arms.open",
                    title: lang.t("决策链与干系人分析", "Decision Maker Mapping"),
                    subtitle: lang.t("识别关键人物与攻关策略", "Map stakeholders & influence tactics"),
                    prompt: lang.t(
                        "分析这个项目客户方的决策链：①识别最终决策者、主要影响者和把关人各是谁②推断每类角色的核心关切和评判维度③给出针对每个关键人物的个性化沟通策略，包括在提案和答辩中如何有针对性地回应他们的关切。",
                        "Map the client's decision-making chain: ①Identify the final decision-maker, key influencers, and gatekeepers ②Infer each role's core concerns and evaluation criteria ③Provide personalized engagement strategies for each key stakeholder, including how to address their specific concerns in the proposal and Q&A.")
                ),
                Suggestion(
                    icon: "text.badge.checkmark",
                    title: lang.t("提案核心论点打磨", "Proposal Core Arguments"),
                    subtitle: lang.t("打动评委的差异化价值主张", "Compelling, differentiated value props"),
                    prompt: lang.t(
                        "帮我为这个项目的提案打磨三个核心价值主张，每个要求：①一句话清晰表达（评委30秒能记住）②有具体数据或案例支撑③与竞争对手明显区分。同时建议如何在提案封面、执行摘要和关键页面中强化这三个论点。",
                        "Help me craft three core value propositions for this proposal. Each must: ①Be expressible in one sentence (memorable in 30 seconds) ②Be backed by specific data or case evidence ③Clearly differentiate us from competitors. Also suggest how to reinforce these three arguments on the cover, executive summary, and key slides.")
                ),
                Suggestion(
                    icon: "exclamationmark.bubble",
                    title: lang.t("客户异议预演", "Objection Pre-emption"),
                    subtitle: lang.t("预判质疑并准备有力应对", "Anticipate questions & craft responses"),
                    prompt: lang.t(
                        "预测客户评委在评审过程中最可能提出的5大疑虑或反对意见（如价格、经验、方法论、团队、时间等），并为每一条准备：①一句话有力回应②支撑数据或参考案例③如何主动在提案中提前消除这个疑虑。",
                        "Predict the five most likely client objections during evaluation (e.g. price, experience, methodology, team, timeline) and for each prepare: ①A one-line powerful response ②Supporting data or reference case ③How to proactively neutralize this concern within the proposal itself.")
                ),
                Suggestion(
                    icon: "dollarsign.circle",
                    title: lang.t("定价与报价策略", "Pricing Strategy"),
                    subtitle: lang.t("兼顾竞争力与利润的定价方案", "Competitive yet profitable pricing"),
                    prompt: lang.t(
                        "为这个项目设计科学的定价策略：①参考行业基准和项目复杂度，给出合理的报价区间②分析高报价和低报价各自的风险③建议最优报价方式（总价/模块化/阶段付款）④如果客户压价，哪些项目可以调整、哪些必须守住底线。",
                        "Design a pricing strategy for this project: ①Suggest a reasonable price range based on industry benchmarks and project complexity ②Analyze the risks of pricing too high vs. too low ③Recommend the best pricing format (lump sum / modular / milestone-based) ④If the client pushes back, identify which line items can flex and which are non-negotiable.")
                )
            ])]

        // ── 中标：项目启动 ────────────────────────────────────────────────────
        case .won:
            return [
                SuggestionGroup(
                    label: lang.t("项目管理", "Project Management"),
                    groupIcon: "calendar.badge.checkmark",
                    groupColor: Color(hex: "#3B82F6"),
                    items: [
                        Suggestion(
                            icon: "calendar",
                            title: lang.t("启动会议策划", "Kickoff Meeting Plan"),
                            subtitle: lang.t("议程、对齐清单与行动计划", "Agenda, alignment checklist & action plan"),
                            prompt: lang.t(
                                "帮我策划这个项目的启动会议。请设计：①完整的会议议程（含时长建议）②必须达成的对齐事项清单（目标、范围、角色、沟通机制）③会后行动计划模板④如何在会议中建立项目团队的信任感和执行节奏。",
                                "Help me plan the project kickoff meeting: ①Full meeting agenda with suggested time allocation ②Must-align checklist (objectives, scope, roles, communication cadence) ③Post-meeting action plan template ④How to establish trust and execution rhythm with the client team in this first meeting.")
                        ),
                        Suggestion(
                            icon: "list.bullet.indent",
                            title: lang.t("工作分解与进度计划", "WBS & Timeline"),
                            subtitle: lang.t("关键路径与资源分配", "Critical path & resource allocation"),
                            prompt: lang.t(
                                "基于项目目标和里程碑，帮我制定详细的工作分解结构（WBS）和整体进度计划：①按阶段列出所有关键任务②识别任务依赖关系和关键路径③建议人力资源分配方案④标记高风险节点和缓冲时间安排。",
                                "Based on project objectives and milestones, build a detailed WBS and master schedule: ①List all key tasks by phase ②Identify task dependencies and critical path ③Suggest resource allocation ④Flag high-risk milestones and recommend buffer time.")
                        )
                    ]
                ),
                SuggestionGroup(
                    label: lang.t("交付物规划", "Deliverable Planning"),
                    groupIcon: "doc.richtext",
                    groupColor: Color(hex: "#10B981"),
                    items: [
                        Suggestion(
                            icon: "checklist",
                            title: lang.t("交付物清单与验收标准", "Deliverables & Acceptance Criteria"),
                            subtitle: lang.t("明确范围、质量与验收条件", "Scope, quality standards & sign-off"),
                            prompt: lang.t(
                                "基于项目目标，设计完整的交付物清单：①列出每个交付物的名称、内容范围和格式要求②明确每项的质量标准和验收条件③建议客户签收流程④识别哪些交付物存在范围风险，建议如何在合同层面保护。",
                                "Design a complete deliverables list for this project: ①Name, content scope, and format requirements for each deliverable ②Quality standards and acceptance criteria per item ③Recommended client sign-off process ④Flag scope-risk deliverables and suggest contractual protections.")
                        ),
                        Suggestion(
                            icon: "pyramid",
                            title: lang.t("核心报告结构设计", "Report Structure Design"),
                            subtitle: lang.t("金字塔逻辑与章节论点框架", "Pyramid logic & chapter argument map"),
                            prompt: lang.t(
                                "为这个项目的核心交付报告设计完整的结构框架：①采用金字塔原理设计报告逻辑（结论先行）②建议各章节的核心论点和支撑结构③推荐执行摘要的写作格式④给出哪些内容适合用图表、哪些适合用文字的建议。",
                                "Design the full structural framework for this project's core deliverable report: ①Apply pyramid principle (conclusion-first) ②Suggest core arguments and supporting structure for each chapter ③Recommend the executive summary format ④Advise which content should be visual vs. narrative.")
                        )
                    ]
                )
            ]

        // ── 交付中：项目管理 + 交付物优化 ─────────────────────────────────────
        case .delivering:
            return [
                SuggestionGroup(
                    label: lang.t("项目管理", "Project Management"),
                    groupIcon: "chart.xyaxis.line",
                    groupColor: Color(hex: "#3B82F6"),
                    items: [
                        Suggestion(
                            icon: "exclamationmark.triangle",
                            title: lang.t("进度与风险扫描", "Progress & Risk Scan"),
                            subtitle: lang.t("识别偏差、瓶颈与应对措施", "Spot deviations, bottlenecks & mitigations"),
                            prompt: lang.t(
                                "审查当前项目状态，进行全面的进度与风险扫描：①识别与原计划的偏差及原因②列出当前最紧迫的3-5个风险（含风险等级）③对每个风险给出具体应对措施和责任人建议④如需调整里程碑计划，给出调整建议和与客户沟通的策略。",
                                "Perform a full progress and risk scan of the current project: ①Identify deviations from plan and root causes ②List the top 3-5 most urgent risks with severity levels ③Provide specific mitigations and suggested owners for each risk ④If milestones need adjustment, suggest how to revise and how to communicate the changes to the client.")
                        ),
                        Suggestion(
                            icon: "doc.richtext",
                            title: lang.t("客户沟通报告生成", "Client Status Report"),
                            subtitle: lang.t("专业周报：进展、决策与下周计划", "Professional update: progress, decisions & next steps"),
                            prompt: lang.t(
                                "基于项目当前状态，起草一份专业的客户沟通报告（周报/双周报）。格式包括：①本期亮点成果（3条）②进行中的关键工作②需要客户确认的决策事项③已识别的风险与应对④下一阶段计划与预期交付。风格要简洁、正式、结论导向。",
                                "Draft a professional client status report (weekly/bi-weekly) based on current project state. Include: ①Top 3 highlights this period ②Key work in progress ③Decisions requiring client input ④Identified risks and mitigations ⑤Next phase plan and expected deliverables. Style: concise, formal, conclusion-first.")
                        ),
                        Suggestion(
                            icon: "person.2.badge.gearshape",
                            title: lang.t("干系人管理策略", "Stakeholder Management"),
                            subtitle: lang.t("化解阻力，确保关键支持", "Resolve resistance & secure buy-in"),
                            prompt: lang.t(
                                "分析当前项目中客户方各干系人的立场和潜在关切，给出针对性的管理策略：①识别支持者、中立者和潜在阻力方②对阻力方分析其根本顾虑，给出化解策略③对关键决策节点，建议如何提前铺垫获得支持④推荐日常维护干系人关系的沟通频率和方式。",
                                "Analyze the stance and concerns of each key stakeholder on the client side, and provide targeted management strategies: ①Identify champions, neutral parties, and potential blockers ②For blockers, analyze root concerns and suggest de-escalation tactics ③For key decision points, recommend how to pre-align for approval ④Suggest communication cadence and format for ongoing stakeholder relationship management.")
                        )
                    ]
                ),
                SuggestionGroup(
                    label: lang.t("交付物优化", "Deliverable Enhancement"),
                    groupIcon: "sparkles.rectangle.stack",
                    groupColor: Color(hex: "#8B5CF6"),
                    items: [
                        Suggestion(
                            icon: "text.magnifyingglass",
                            title: lang.t("内容深度打磨", "Content Depth Review"),
                            subtitle: lang.t("加强分析厚度与洞察质量", "Strengthen analysis depth & insight quality"),
                            prompt: lang.t(
                                "针对当前交付物内容，进行深度打磨：①识别分析深度不足、结论缺乏支撑的部分②给出每个薄弱点的具体加强方向（数据、框架、案例）③建议哪些部分值得进一步调研或访谈④如何将分析结果升华为可操作的战略建议，而非停留在描述层面。",
                                "Review the current deliverable content for depth: ①Flag sections with insufficient analysis or unsupported conclusions ②Provide specific enhancement directions for each weak area (data, frameworks, cases) ③Recommend which areas warrant additional research or interviews ④Show how to elevate findings into actionable strategic recommendations rather than descriptive summaries.")
                        ),
                        Suggestion(
                            icon: "text.document",
                            title: lang.t("执行摘要提炼", "Executive Summary"),
                            subtitle: lang.t("让管理层30秒抓住核心结论", "Let executives grasp key insights in 30s"),
                            prompt: lang.t(
                                "将当前报告的核心内容提炼成一份高质量的执行摘要（Executive Summary）：①用3-5个要点呈现最重要的发现和结论②每个要点含一句核心洞察+一句关键数据③给出明确的行动建议（下一步做什么、谁来做、何时完成）④整体控制在一页以内，语言简洁有力。",
                                "Distill the report's core content into a high-quality Executive Summary: ①Present the 3-5 most important findings and conclusions as key points ②Each point = one core insight + one key data point ③Include clear action recommendations (what, who, when) ④Target one page maximum, written in concise and authoritative language.")
                        ),
                        Suggestion(
                            icon: "chart.pie.fill",
                            title: lang.t("可视化与数据呈现", "Visualization Guidance"),
                            subtitle: lang.t("把复杂分析转化为清晰图表", "Turn complex analysis into clear visuals"),
                            prompt: lang.t(
                                "分析当前报告中哪些内容适合可视化呈现，给出具体建议：①为每个关键分析模块推荐最适合的图表类型（如矩阵、瀑布图、散点图等）及其原因②标出目前文字叙述过重、应改用图表的部分③给出每个图表的核心要传递的信息和标题建议④特别指出哪些数据需要在图表中突出强调以支持核心结论。",
                                "Analyze which parts of the report are best visualized and provide specific guidance: ①Recommend the most suitable chart type for each key analysis module (e.g. matrix, waterfall, scatter) and explain why ②Flag text-heavy sections that should be converted to visuals ③Suggest the core message and title for each chart ④Specifically call out which data points need visual emphasis to support the key conclusions.")
                        )
                    ]
                )
            ]

        // ── 已归档：复盘与沉淀 ────────────────────────────────────────────────
        case .archived:
            return [SuggestionGroup(label: nil, groupIcon: nil, groupColor: Color(hex: "#6B7280"), items: [
                Suggestion(
                    icon: "arrow.uturn.backward.circle",
                    title: lang.t("项目完整复盘", "Full Retrospective"),
                    subtitle: lang.t("经验教训与最佳实践提炼", "Extract lessons learned & best practices"),
                    prompt: lang.t(
                        "对这个项目进行完整的复盘分析：①哪些做法是成功的，为什么？②哪些出现了问题或偏差，根本原因是什么？③如果重来，哪3件事应该从一开始就不同？④提炼出至少3条可复用的最佳实践，供未来同类项目参考。",
                        "Conduct a full retrospective on this project: ①What worked well and why? ②What went wrong or off-track, and what were the root causes? ③If starting over, what 3 things would you do differently from day one? ④Extract at least 3 reusable best practices for future similar projects.")
                ),
                Suggestion(
                    icon: "star.bubble",
                    title: lang.t("标准案例提炼", "Case Study"),
                    subtitle: lang.t("整理成可复用的参考案例", "Format as reusable reference case"),
                    prompt: lang.t(
                        "将这个项目整理成一份规范的咨询案例文档，包含：①客户背景与挑战（匿名化处理）②我们的解决方案与方法论③关键交付物和工作成果④量化的价值成果（数据优先）⑤该案例最适合用于哪类未来提案或销售场景。",
                        "Document this project as a formal consulting case study including: ①Client background and challenge (anonymized) ②Our solution approach and methodology ③Key deliverables and outputs ④Quantified value outcomes (data first) ⑤Which future proposal or sales contexts this case is best suited for.")
                ),
                Suggestion(
                    icon: "chart.bar.doc.horizontal",
                    title: lang.t("成果量化报告", "Impact Report"),
                    subtitle: lang.t("用数据证明价值创造", "Prove value creation with data"),
                    prompt: lang.t(
                        "基于项目交付结果，生成一份成果量化报告：①梳理所有可量化的成果指标（效率提升、成本节约、收入增长等）②对于难以量化的成果，给出定性描述框架③生成一段适合用于公司官网、案例库或客户推荐信的成果陈述④建议如何向客户申请量化数据验证和书面推荐。",
                        "Generate an impact report based on project outcomes: ①Compile all quantifiable outcome metrics (efficiency gains, cost savings, revenue impact, etc.) ②For intangible outcomes, provide a qualitative description framework ③Draft a results statement suitable for the company website, case library, or client testimonial ④Suggest how to approach the client for data validation and a written reference.")
                )
            ])]
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func sectionHeader(_ title: String, icon: String, iconColor: Color = .primary500) -> some View {
        HStack(spacing: Spacing.sm) {
            ZStack {
                Circle()
                    .fill(iconColor.opacity(0.12))
                    .frame(width: 22, height: 22)
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(iconColor)
            }
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.onSurface)
            Spacer()
        }
        .padding(Spacing.lg)
    }

    @ViewBuilder
    private func metaRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
            Spacer()
            Text(value).font(TextStyle.titleSM).foregroundColor(.onSurface)
        }
        .padding(.vertical, Spacing.sm + 2)
        Divider().opacity(0.25)
    }

    @ViewBuilder
    private func statRow(label: String, value: String, progress: Double?) -> some View {
        VStack(spacing: 4) {
            HStack {
                Text(label).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                Spacer()
                Text(value).font(TextStyle.titleSM).foregroundColor(.onSurface)
            }
            if let p = progress {
                ProgressBar(progress: p, height: 4,
                            color: p > 0.6 ? .primary500 : p > 0.3 ? .statusOnHold : .statusCompleted)
            }
        }
    }

    private func deleteConversation(_ conv: APIConversation) {
        Task {
            await dataStore.deleteConversation(id: conv.id)
            projectConversations.removeAll { $0.id == conv.id }
            if activeConversationId == conv.id {
                activeConversationId = projectConversations.first?.id
                if let next = activeConversationId {
                    chatMessages = await dataStore.loadMessages(conversationId: next)
                } else {
                    chatMessages = []
                }
            }
        }
    }

    private func handleFileImport(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let pid = apiProjectId else { return }
        // Guard against double-callback (macOS fileImporter known issue)
        guard !isUploadingFile else { return }
        let targetFolder = uploadTargetFolderId
        uploadTargetFolderId = nil
        let total = urls.count
        isUploadingFile = true
        uploadProgress = 0
        uploadProgressText = total == 1
            ? lang.t("上传中…", "Uploading…")
            : lang.t("0 / \(total)", "0 / \(total)")
        Task {
            for (idx, url) in urls.enumerated() {
                guard url.startAccessingSecurityScopedResource() else { continue }
                defer { url.stopAccessingSecurityScopedResource() }
                uploadProgressText = total == 1
                    ? lang.t(url.lastPathComponent, url.lastPathComponent)
                    : lang.t("\(idx + 1) / \(total)", "\(idx + 1) / \(total)")
                _ = await dataStore.uploadProjectFile(apiProjectId: pid, fileURL: url, folderId: targetFolder)
                uploadProgress = Double(idx + 1) / Double(total)
            }
            apiFiles = await dataStore.loadProjectFiles(apiProjectId: pid)
            isUploadingFile = false
            uploadProgress = 0
            uploadProgressText = ""
        }
    }
}

// MARK: - Live Milestone Row

struct LiveMilestoneRow: View {
    let milestone: APIMilestone
    let onToggle: (Bool) -> Void
    let onDelete: () -> Void
    @State private var isHovered = false
    @Environment(\.appLanguage) var lang

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            // Checkbox
            Button {
                onToggle(!milestone.isDone)
            } label: {
                ZStack {
                    if milestone.isDone {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Color.primary500)
                            .frame(width: 18, height: 18)
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.white)
                    } else {
                        RoundedRectangle(cornerRadius: 4)
                            .strokeBorder(Color.outlineVariant, lineWidth: 1.5)
                            .frame(width: 18, height: 18)
                    }
                }
                .padding(.top, 1)
            }
            .buttonStyle(.plain)

            // Title + meta
            VStack(alignment: .leading, spacing: 3) {
                Text(milestone.title)
                    .font(TextStyle.bodySM)
                    .foregroundColor(milestone.isDone ? .onSurfaceVariant : .onSurface)
                    .strikethrough(milestone.isDone, color: .onSurfaceVariant)
                HStack(spacing: Spacing.xs) {
                    if milestone.priority == "high" {
                        TagView(label: lang.t("高优先级", "Priority"), style: .deepTask)
                    }
                    if let due = milestone.dueDate, !due.isEmpty {
                        Text(due)
                            .font(TextStyle.labelSM)
                            .foregroundColor(milestone.priority == "high" ? .statusOnHold : .onSurfaceVariant)
                    }
                }
            }

            Spacer()

            // Delete (on hover)
            if isHovered {
                Button { onDelete() } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 11))
                        .foregroundColor(.statusFailed.opacity(0.7))
                }
                .buttonStyle(.plain)
                .transition(.opacity)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .onHover { isHovered = $0 }
        .animation(.easeInOut(duration: 0.12), value: isHovered)
    }
}

// MARK: - Live File Chip

struct LiveFileChip: View {
    let file: APIProjectFile
    let onDelete: () -> Void
    @State private var isHovered = false

    private var fileType: ProjectFile.FileType {
        switch file.fileType.lowercased() {
        case "pdf": return .pdf
        case "xlsx", "xls": return .xlsx
        case "pptx", "ppt": return .pptx
        default: return .docx
        }
    }

    private var sizeLabel: String {
        let kb = file.sizeBytes / 1024
        return kb > 1024 ? "\(kb / 1024) MB" : "\(kb) KB"
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            HStack(alignment: .top, spacing: Spacing.sm) {
                Image(systemName: fileType.iconName)
                    .font(.system(size: 16)).foregroundColor(fileType.iconColor)
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.name)
                        .font(TextStyle.labelSM).foregroundColor(.onSurface).lineLimit(2)
                    Text("\(file.fileType.uppercased()) • \(sizeLabel)")
                        .font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                }
                Spacer(minLength: 0)
            }
            .padding(Spacing.sm)
            .background(Color.surfaceContainerLowest)
            .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.sm)
                    .strokeBorder(isHovered ? Color.statusFailed.opacity(0.4) : Color.outlineVariant.opacity(0.3), lineWidth: 1)
            )

            if isHovered {
                Button { onDelete() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundColor(.statusFailed)
                        .background(Color.surfaceContainerLowest, in: Circle())
                }
                .buttonStyle(.plain)
                .offset(x: 5, y: -5)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .onHover { isHovered = $0 }
        .animation(.easeInOut(duration: 0.12), value: isHovered)
    }
}

// MARK: - Folder Section Row

struct FolderSectionRow: View {
    let folder: APIProjectFolder
    let files: [APIProjectFile]
    let isExpanded: Bool
    let onToggle: () -> Void
    let onUpload: () -> Void
    let onDeleteFile: (Int) -> Void

    @Environment(\.appLanguage) var lang

    private var fileTypeIcon: String {
        switch folder.name {
        case "项目需求":       return "checklist"
        case "方案和报价":     return "doc.text"
        case "项目交付文档":   return "shippingbox"
        case "项目归档信息":   return "archivebox"
        default:               return "folder"
        }
    }

    private var folderColor: Color {
        switch folder.sortOrder % 4 {
        case 0: return Color(red: 0.40, green: 0.58, blue: 0.97)
        case 1: return Color(red: 0.23, green: 0.72, blue: 0.56)
        case 2: return Color(red: 0.93, green: 0.60, blue: 0.25)
        default: return Color(red: 0.68, green: 0.46, blue: 0.93)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Folder header row
            Button(action: onToggle) {
                HStack(spacing: 8) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                        .frame(width: 12)

                    ZStack {
                        RoundedRectangle(cornerRadius: 5)
                            .fill(folderColor.opacity(0.15))
                            .frame(width: 22, height: 22)
                        Image(systemName: fileTypeIcon)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(folderColor)
                    }

                    Text(folder.name)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.onSurface)
                        .lineLimit(1)

                    Spacer()

                    Text("\(files.count)")
                        .font(.system(size: 10))
                        .foregroundColor(.onSurfaceVariant)

                    Button(action: onUpload) {
                        Image(systemName: "plus")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.primary500)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, Spacing.md)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // File rows (when expanded)
            if isExpanded {
                if files.isEmpty {
                    Button(action: onUpload) {
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.up.circle")
                                .font(.system(size: 11)).foregroundColor(.primary500.opacity(0.6))
                            Text(lang.t("上传文件", "Upload files"))
                                .font(.system(size: 11)).foregroundColor(.onSurfaceVariant)
                        }
                        .padding(.leading, 42)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                } else {
                    ForEach(files) { file in
                        FolderFileRow(file: file, onDelete: { onDeleteFile(file.id) })
                    }
                }
            }
        }
    }
}

// MARK: - Folder File Row

struct FolderFileRow: View {
    let file: APIProjectFile
    let onDelete: () -> Void
    @State private var isHovered = false

    private var fileType: ProjectFile.FileType {
        switch file.fileType.lowercased() {
        case "pdf": return .pdf
        case "xlsx", "xls": return .xlsx
        case "pptx", "ppt": return .pptx
        default: return .docx
        }
    }

    private var sizeLabel: String {
        let kb = file.sizeBytes / 1024
        return kb > 1024 ? "\(kb / 1024) MB" : "\(kb) KB"
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: fileType.iconName)
                .font(.system(size: 12))
                .foregroundColor(fileType.iconColor)
                .frame(width: 16)
                .padding(.leading, 42)

            VStack(alignment: .leading, spacing: 1) {
                Text(file.name)
                    .font(.system(size: 11))
                    .foregroundColor(.onSurface)
                    .lineLimit(1)
                if !file.summary.isEmpty && isHovered {
                    Text(file.summary)
                        .font(.system(size: 10))
                        .foregroundColor(.onSurfaceVariant)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                } else {
                    Text("\(file.fileType.uppercased()) · \(sizeLabel)")
                        .font(.system(size: 10))
                        .foregroundColor(.onSurfaceVariant)
                }
            }
            .animation(.easeInOut(duration: 0.15), value: isHovered)

            Spacer()

            if isHovered {
                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .font(.system(size: 10))
                        .foregroundColor(.statusFailed.opacity(0.7))
                }
                .buttonStyle(.plain)
                .transition(.opacity)
            }
        }
        .padding(.vertical, 5)
        .padding(.trailing, Spacing.md)
        .contentShape(Rectangle())
        .background(isHovered ? Color.surfaceContainerLowest : .clear)
        .onHover { isHovered = $0 }
        .animation(.easeInOut(duration: 0.12), value: isHovered)
    }
}

// MARK: - Keep existing simple FileChip for other uses
struct FileChip: View {
    let file: ProjectFile

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            Image(systemName: file.type.iconName)
                .font(.system(size: 16)).foregroundColor(file.type.iconColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.name).font(TextStyle.labelSM).foregroundColor(.onSurface).lineLimit(2)
                Text("\(file.type.rawValue) • \(file.size)").font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
            }
        }
        .padding(Spacing.sm)
        .background(Color.surfaceContainerLowest)
        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
        .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Color.outlineVariant.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Inline Chat Bubble

struct InlineChatBubble: View {
    let message: APIMessage
    var onSaveToProject: ((String) -> Void)? = nil
    @Environment(\.appLanguage) var lang
    @State private var isCopied = false
    @State private var isSaved = false

    var isUser: Bool { message.role == "user" }

    var body: some View {
        if isUser {
            // User: right-aligned compact bubble
            HStack {
                Spacer(minLength: 60)
                Text(message.content)
                    .font(TextStyle.bodySM)
                    .foregroundColor(.white)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(
                        LinearGradient(colors: [.primary500, Color(hex: "#6366F1")],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, 4)
        } else {
            // AI: icon + full-width MarkdownView, copy button always visible
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .top, spacing: Spacing.sm) {
                    ZStack {
                        Circle()
                            .fill(LinearGradient(colors: [.primary600, .primary500],
                                                 startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 26, height: 26)
                        Image(systemName: "sparkles")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.white)
                    }
                    .padding(.top, 2)
                    .frame(width: 26)

                    markdownAsSingleText(message.content)
                        .font(TextStyle.bodyMD)
                        .foregroundColor(.onSurface)
                        .lineSpacing(5)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                // Action bar — always visible for AI messages
                HStack {
                    Spacer().frame(width: 26 + Spacing.sm)
                    Button(action: copyContent) {
                        HStack(spacing: 4) {
                            Image(systemName: isCopied ? "checkmark" : "doc.on.doc")
                                .font(.system(size: 10))
                            Text(isCopied ? lang.t("已复制", "Copied") : lang.t("复制", "Copy"))
                                .font(.system(size: 11))
                        }
                        .foregroundColor(isCopied ? .primary500 : .onSurfaceVariant)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.surfaceContainerLow)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)

                    if let save = onSaveToProject {
                        Button {
                            save(message.content)
                            withAnimation(.easeInOut(duration: 0.15)) { isSaved = true }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                withAnimation(.easeInOut(duration: 0.15)) { isSaved = false }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: isSaved ? "checkmark" : "tray.and.arrow.down")
                                    .font(.system(size: 10))
                                Text(isSaved ? lang.t("已沉淀", "Saved") : lang.t("沉淀到项目", "Save to Project"))
                                    .font(.system(size: 11))
                            }
                            .foregroundColor(isSaved ? .statusActive : .onSurfaceVariant)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.surfaceContainerLow)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }

                    Spacer()
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.sm)
        }
    }

    private func copyContent() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(markdownToPlainText(message.content), forType: .string)
        withAnimation(.easeInOut(duration: 0.15)) { isCopied = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation(.easeInOut(duration: 0.15)) { isCopied = false }
        }
    }
}

struct InlineStreamingBubble: View {
    let content: String

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.sm) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [.primary600, .primary500],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 26, height: 26)
                Image(systemName: "sparkles")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white)
            }
            .padding(.top, 2)
            .frame(width: 26)

            if content.isEmpty {
                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { i in
                        Circle().fill(Color.primary500.opacity(0.5)).frame(width: 5, height: 5)
                            .animation(.easeInOut(duration: 0.6).repeatForever().delay(Double(i) * 0.2), value: content.isEmpty)
                    }
                }
                .padding(.top, 8)
            } else {
                MarkdownView(text: content)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm)
    }
}


// MARK: - Quick Suggestion Card (chat empty state)

private struct QuickSuggestionCard: View {
    let icon: String
    let title: String
    let subtitle: String
    let color: Color
    let index: Int
    let isVisible: Bool

    @State private var isHovering = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 7)
                    .fill(color.opacity(isHovering ? 0.18 : 0.1))
                    .frame(width: 30, height: 30)
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(color)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.onSurface)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 10))
                    .foregroundColor(.onSurfaceVariant)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isHovering ? color.opacity(0.06) : Color.surfaceContainerLow)
        .clipShape(RoundedRectangle(cornerRadius: 11))
        .overlay(
            RoundedRectangle(cornerRadius: 11)
                .strokeBorder(
                    isHovering ? color.opacity(0.4) : Color.outlineVariant.opacity(0.5),
                    lineWidth: 1
                )
        )
        .shadow(color: isHovering ? color.opacity(0.1) : .clear, radius: 8, x: 0, y: 3)
        .scaleEffect(isHovering ? 1.018 : 1.0)
        // Staggered entrance: fade up
        .opacity(isVisible ? 1 : 0)
        .offset(y: isVisible ? 0 : 16)
        .animation(
            .spring(response: 0.5, dampingFraction: 0.72)
                .delay(0.08 + Double(index) * 0.09),
            value: isVisible
        )
        // Hover micro-interaction
        .animation(.easeInOut(duration: 0.16), value: isHovering)
        .onHover { isHovering = $0 }
    }
}

// MARK: - Project display title helper
extension Project {
    var displayTitle: String { name }
}
