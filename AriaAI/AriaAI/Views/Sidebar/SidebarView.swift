import SwiftUI
import UniformTypeIdentifiers

struct SidebarView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @State private var hoveredScreen: AppScreen? = nil
    @State private var showHelp = false
    @State private var showStatus = false

    // Project-context state
    @State private var milestones: [APIMilestone] = []
    @State private var showAddMilestone = false
    @State private var newMilestoneTitle = ""
    @State private var descExpanded = false
    @State private var projectFiles: [APIProjectFile] = []
    @State private var apiFolders: [APIProjectFolder] = []
    @State private var isImportingFiles = false
    @State private var isUploadingFile = false
    @State private var uploadProgress: Double = 0
    @State private var uploadProgressText = ""
    @State private var expandedFolderIds: Set<Int> = []
    @State private var uploadTargetFolderId: Int? = nil

    private var selectedApiProject: APIProject? {
        guard let p = appState.selectedProject else { return nil }
        return dataStore.apiProjects.first { $0.name == p.name }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let project = appState.selectedProject {
                // ── Project context sidebar ─────────────────────────
                projectContextSidebar(project: project)
            } else {
                // ── Normal navigation sidebar ───────────────────────
                normalSidebar
            }
        }
        .background(.surfaceContainerLow)
        .onChange(of: appState.selectedProject?.name) { _, _ in
            Task { await reloadProjectData() }
        }
        .task {
            if appState.selectedProject != nil { await reloadProjectData() }
        }
        .fileImporter(
            isPresented: $isImportingFiles,
            allowedContentTypes: [.pdf, .data,
                UTType(filenameExtension: "docx") ?? .data,
                UTType(filenameExtension: "pptx") ?? .data,
                UTType(filenameExtension: "xlsx") ?? .data],
            allowsMultipleSelection: true
        ) { result in
            guard let pid = selectedApiProject?.id, case .success(let urls) = result else { return }
            // Guard against double-callback (macOS fileImporter known issue)
            guard !isUploadingFile else { return }
            let targetFolder = uploadTargetFolderId
            uploadTargetFolderId = nil
            let total = urls.count
            isUploadingFile = true
            uploadProgress = 0
            uploadProgressText = total == 1
                ? lang.t("上传中…", "Uploading…")
                : lang.t("0/\(total)", "0/\(total)")
            Task {
                for (idx, url) in urls.enumerated() {
                    guard url.startAccessingSecurityScopedResource() else { continue }
                    defer { url.stopAccessingSecurityScopedResource() }
                    uploadProgressText = total == 1
                        ? url.lastPathComponent
                        : lang.t("\(idx + 1)/\(total)", "\(idx + 1)/\(total)")
                    _ = await dataStore.uploadProjectFile(apiProjectId: pid, fileURL: url, folderId: targetFolder)
                    uploadProgress = Double(idx + 1) / Double(total)
                }
                projectFiles = await dataStore.loadProjectFiles(apiProjectId: pid)
                isUploadingFile = false
                uploadProgress = 0
                uploadProgressText = ""
            }
        }
    }

    // MARK: - Normal sidebar

    private var normalSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Brand Header
            HStack(spacing: Spacing.sm) {
                AILogoView()
                VStack(alignment: .leading, spacing: 1) {
                    Text("Aria AI")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.onSurface)
                    Text(lang.t("精英咨询版", "Elite Consulting Edition"))
                        .font(TextStyle.labelSM)
                        .foregroundColor(.onSurfaceVariant)
                }
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.top, Spacing.xl)
            .padding(.bottom, Spacing.lg)

            // New Chat Button
            Button { appState.selectedScreen = .chat } label: {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                    Text(lang.t("新建对话", "New Chat")).font(TextStyle.labelMD)
                }
                .frame(maxWidth: .infinity)
                .foregroundColor(.white)
                .padding(.vertical, Spacing.sm + 2)
                .background(LinearGradient(colors: [.primary600, .primary500], startPoint: .topLeading, endPoint: .bottomTrailing))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, Spacing.lg)
            .padding(.bottom, Spacing.lg)

            VStack(alignment: .leading, spacing: 2) {
                navItem(.chat); navItem(.skills); navItem(.projects)
                navItem(.clients); navItem(.knowledgeBase)
            }
            .padding(.horizontal, Spacing.sm)

            Spacer()

            VStack(alignment: .leading, spacing: 2) {
                navItem(.schedules); navItem(.templates)
            }
            .padding(.horizontal, Spacing.sm)

            Divider().opacity(0.4).padding(.vertical, Spacing.sm)

            VStack(alignment: .leading, spacing: 2) {
                Button { showStatus = true } label: {
                    HStack(spacing: Spacing.md) {
                        Image(systemName: "dot.radiowaves.left.and.right")
                            .font(.system(size: 14))
                            .foregroundColor(.onSurfaceVariant)
                            .frame(width: 18)
                        Text(lang.t("连接状态", "Connection Status"))
                            .font(TextStyle.bodySM)
                            .foregroundColor(.onSurfaceVariant)
                        Spacer()
                        Circle()
                            .fill(sidebarSyncDotColor)
                            .frame(width: 6, height: 6)
                    }
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm + 1)
                }
                .buttonStyle(.plain)
                .popover(isPresented: $showStatus, arrowEdge: .trailing) { StatusPopoverContent() }
                sidebarFooterItem(icon: "questionmark.circle", label: lang.t("帮助中心", "Help Center")) { showHelp = true }
                    .popover(isPresented: $showHelp, arrowEdge: .trailing) { helpPopover }
            }
            .padding(.horizontal, Spacing.sm)

            navItem(.settings).padding(.horizontal, Spacing.sm)

            sidebarFooterItem(icon: "rectangle.portrait.and.arrow.right", label: lang.t("退出登录", "Sign Out")) {
                Task {
                    await dataStore.logout()
                    appState.isAuthenticated = false
                }
            }
            .padding(.horizontal, Spacing.sm)
            .padding(.bottom, Spacing.lg)
        }
    }

    // MARK: - Project context sidebar

    @ViewBuilder
    private func projectContextSidebar(project: Project) -> some View {
        VStack(alignment: .leading, spacing: 0) {

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {

                    // ── 项目概要 ─────────────────────────────────────
                    sidebarSection(label: lang.t("项目概要", "PROFILE"), icon: "doc.text") {
                        let apiProj = selectedApiProject
                        let statusColor = Color(hex: project.status.color)
                        VStack(alignment: .leading, spacing: 8) {
                            // Status badge + change menu
                            if let pid = selectedApiProject?.id {
                                Menu {
                                    ForEach(Project.ProjectStatus.allCases, id: \.self) { s in
                                        if s != project.status {
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
                                        Text(project.status.label(for: lang))
                                            .font(.system(size: 10, weight: .medium)).foregroundColor(statusColor)
                                        Image(systemName: "chevron.down")
                                            .font(.system(size: 8)).foregroundColor(statusColor.opacity(0.7))
                                    }
                                    .padding(.horizontal, 7).padding(.vertical, 3)
                                    .background(statusColor.opacity(0.1)).clipShape(Capsule())
                                }
                                .menuStyle(.borderlessButton)
                            }
                            // Meta rows
                            profileMetaRow(lang.t("客户", "Client"), value: project.client)
                            profileMetaRow(lang.t("周期", "Period"), value: project.period)
                            // Description (collapsible for long text)
                            if let desc = apiProj?.description, !desc.isEmpty {
                                Divider().opacity(0.2)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(desc)
                                        .font(TextStyle.bodySM).foregroundColor(.onSurface)
                                        .lineSpacing(3)
                                        .lineLimit(descExpanded ? nil : 3)
                                        .fixedSize(horizontal: false, vertical: true)
                                    if desc.count > 80 {
                                        Button {
                                            withAnimation(.easeInOut(duration: 0.2)) { descExpanded.toggle() }
                                        } label: {
                                            Text(descExpanded ? lang.t("收起", "Less") : lang.t("更多", "More"))
                                                .font(.system(size: 10, weight: .medium))
                                                .foregroundColor(.primary500)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                            // Key stats
                            Divider().opacity(0.2)
                            let freshness = dataStore.projects.first { $0.name == project.name }?.contextFreshness ?? project.contextFreshness
                            let msDone = milestones.filter(\.isDone).count
                            let msTotal = milestones.count
                            HStack(spacing: 0) {
                                sidebarStatCell(
                                    label: lang.t("里程碑", "Milestones"),
                                    value: msTotal == 0 ? "-" : "\(msDone)/\(msTotal)",
                                    progress: msTotal > 0 ? Double(msDone) / Double(msTotal) : nil,
                                    color: .primary500
                                )
                                Divider().frame(height: 32)
                                sidebarStatCell(
                                    label: lang.t("上下文新鲜度", "Freshness"),
                                    value: "\(Int(freshness * 100))%",
                                    progress: freshness,
                                    color: freshness > 0.6 ? Color(hex: "#22C55E") : Color(hex: "#F59E0B")
                                )
                            }
                            .background(Color.surfaceContainerHighest.opacity(0.4))
                            .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                        }
                    }

                    Divider().opacity(0.2)

                    // ── 文件库 ───────────────────────────────────────
                    sidebarSection(label: lang.t("文件库", "FILES"), icon: "folder") {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(apiFolders) { folder in
                                let folderFiles = projectFiles.filter { $0.folderId == folder.id }
                                let isExpanded = expandedFolderIds.contains(folder.id)
                                sidebarFolderRow(folder: folder, files: folderFiles, isExpanded: isExpanded)
                            }
                            let unfoldered = projectFiles.filter { $0.folderId == nil }
                            if !unfoldered.isEmpty {
                                ForEach(unfoldered) { file in
                                    sidebarFolderFileRow(file: file, indent: false)
                                }
                            }
                            if apiFolders.isEmpty && projectFiles.isEmpty {
                                Button { uploadTargetFolderId = nil; isImportingFiles = true } label: {
                                    HStack(spacing: 6) {
                                        Image(systemName: "doc.badge.plus").font(.system(size: 11)).foregroundColor(.primary500.opacity(0.6))
                                        Text(lang.t("上传项目文件", "Upload files"))
                                            .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(Spacing.sm)
                                    .background(Color.surfaceContainerHighest.opacity(0.5))
                                    .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                                    .overlay(RoundedRectangle(cornerRadius: Radius.sm)
                                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4]))
                                        .foregroundColor(Color.outlineVariant.opacity(0.4)))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    } headerTrailing: {
                        HStack(spacing: 6) {
                            if isUploadingFile {
                                VStack(alignment: .trailing, spacing: 2) {
                                    ProgressView(value: uploadProgress)
                                        .progressViewStyle(.linear)
                                        .frame(width: 60)
                                        .tint(.primary500)
                                    Text(uploadProgressText)
                                        .font(.system(size: 9))
                                        .foregroundColor(.onSurfaceVariant)
                                        .lineLimit(1)
                                }
                            } else {
                                Text("\(projectFiles.count)").font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                            }
                        }
                    }

                    Divider().opacity(0.2)

                    // ── 项目进展 ─────────────────────────────────────
                    sidebarSection(label: lang.t("项目进展", "PROGRESS"), icon: "flag") {
                        VStack(alignment: .leading, spacing: 6) {
                            // Progress bar + count
                            let done = milestones.filter(\.isDone).count
                            let total = milestones.count
                            if total > 0 {
                                HStack(spacing: 6) {
                                    GeometryReader { geo in
                                        ZStack(alignment: .leading) {
                                            RoundedRectangle(cornerRadius: 2).fill(Color.surfaceContainerHighest).frame(height: 4)
                                            RoundedRectangle(cornerRadius: 2).fill(Color.primary500)
                                                .frame(width: geo.size.width * Double(done) / Double(total), height: 4)
                                        }
                                    }
                                    .frame(height: 4)
                                    Text("\(done)/\(total)").font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                                }
                            }

                            // Add form
                            if showAddMilestone {
                                HStack(spacing: Spacing.xs) {
                                    TextField(lang.t("里程碑名称…", "Title…"), text: $newMilestoneTitle)
                                        .textFieldStyle(.plain).font(TextStyle.bodySM)
                                        .padding(.horizontal, 7).padding(.vertical, 5)
                                        .background(Color.surfaceContainerHighest)
                                        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                                        .onSubmit { submitMilestone() }
                                    Button(lang.t("添加", "Add")) { submitMilestone() }
                                        .buttonStyle(.plain).font(TextStyle.labelSM).fontWeight(.semibold)
                                        .foregroundColor(.primary500)
                                        .disabled(newMilestoneTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                    Button { showAddMilestone = false } label: {
                                        Image(systemName: "xmark").font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                                    }.buttonStyle(.plain)
                                }
                            }

                            // Milestone rows
                            if milestones.isEmpty && !showAddMilestone {
                                Text(lang.t("暂无里程碑，点击 + 添加", "No milestones. Tap + to add."))
                                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant.opacity(0.5))
                            } else {
                                VStack(spacing: 0) {
                                    ForEach(milestones) { ms in
                                        sidebarMilestoneRow(ms)
                                        if ms.id != milestones.last?.id {
                                            Divider().opacity(0.15).padding(.leading, 22)
                                        }
                                    }
                                }
                            }
                        }
                    } headerTrailing: {
                        Button {
                            showAddMilestone.toggle()
                            if showAddMilestone { newMilestoneTitle = "" }
                        } label: {
                            Image(systemName: "plus").font(.system(size: 11, weight: .bold)).foregroundColor(.primary500)
                        }.buttonStyle(.plain)
                    }

                }
            }

            Divider().opacity(0.25)

            // ── Bottom mini nav ──────────────────────────────────
            VStack(alignment: .leading, spacing: 2) {
                miniNavItem(icon: "bubble.left",   label: lang.t("对话", "Chat"))     { appState.selectedScreen = .chat }
                miniNavItem(icon: "bolt",           label: lang.t("技能", "Skills"))   { appState.selectedScreen = .skills }
                miniNavItem(icon: "gearshape",      label: lang.t("设置", "Settings")) { appState.selectedScreen = .settings }
            }
            .padding(.horizontal, Spacing.sm).padding(.vertical, Spacing.sm)
        }
    }

    // MARK: - Sidebar section builder

    @ViewBuilder
    private func sidebarSection<Content: View, Trailing: View>(
        label: String, icon: String,
        @ViewBuilder content: () -> Content,
        @ViewBuilder headerTrailing: () -> Trailing
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 5) {
                    Image(systemName: icon)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.primary500.opacity(0.8))
                    Text(label)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                        .tracking(0.5)
                }
                Spacer()
                headerTrailing()
            }
            .padding(.horizontal, Spacing.lg).padding(.top, Spacing.md).padding(.bottom, Spacing.sm)
            content()
                .padding(.horizontal, Spacing.lg).padding(.bottom, Spacing.md)
        }
    }

    @ViewBuilder
    private func sidebarSection<Content: View>(
        label: String, icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        sidebarSection(label: label, icon: icon, content: content) { EmptyView() }
    }

    @ViewBuilder
    private func sidebarStatCell(label: String, value: String, progress: Double?, color: Color) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.system(size: 12, weight: .semibold)).foregroundColor(color)
            if let p = progress {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 1.5).fill(Color.surfaceContainerHighest).frame(height: 3)
                        RoundedRectangle(cornerRadius: 1.5).fill(color).frame(width: geo.size.width * p, height: 3)
                    }
                }
                .frame(height: 3)
            }
            Text(label).font(.system(size: 9)).foregroundColor(.onSurfaceVariant)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.sm)
    }

    @ViewBuilder
    private func profileMetaRow(_ label: String, value: String) -> some View {
        HStack(spacing: 4) {
            Text(label).font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
            Spacer()
            Text(value).font(.system(size: 11, weight: .medium)).foregroundColor(.onSurface).lineLimit(1)
        }
    }

    @ViewBuilder
    private func sidebarFolderRow(folder: APIProjectFolder, files: [APIProjectFile], isExpanded: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    if isExpanded { expandedFolderIds.remove(folder.id) }
                    else { expandedFolderIds.insert(folder.id) }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                        .frame(width: 10)
                    Image(systemName: "folder")
                        .font(.system(size: 11))
                        .foregroundColor(.primary500.opacity(0.7))
                    Text(folder.name)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.onSurface)
                        .lineLimit(1)
                    Spacer()
                    if !files.isEmpty {
                        Text("\(files.count)")
                            .font(.system(size: 10))
                            .foregroundColor(.onSurfaceVariant)
                    }
                    Button {
                        uploadTargetFolderId = folder.id
                        isImportingFiles = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(.primary500)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.vertical, 5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                if files.isEmpty {
                    Button {
                        uploadTargetFolderId = folder.id
                        isImportingFiles = true
                    } label: {
                        Text(lang.t("上传文件", "Upload files"))
                            .font(.system(size: 10))
                            .foregroundColor(.onSurfaceVariant.opacity(0.6))
                            .padding(.leading, 18)
                            .padding(.vertical, 3)
                    }
                    .buttonStyle(.plain)
                } else {
                    ForEach(files) { file in
                        sidebarFolderFileRow(file: file, indent: true)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func sidebarFolderFileRow(file: APIProjectFile, indent: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: fileTypeIcon(file.fileType))
                .font(.system(size: 10))
                .foregroundColor(.primary500.opacity(0.6))
                .frame(width: 14)
                .padding(.leading, indent ? 16 : 0)
            Text(file.name)
                .font(.system(size: 11))
                .foregroundColor(.onSurface)
                .lineLimit(1)
            Spacer()
            if let pid = selectedApiProject?.id {
                Button {
                    Task {
                        await dataStore.deleteProjectFile(apiProjectId: pid, fileId: file.id)
                        projectFiles = await dataStore.loadProjectFiles(apiProjectId: pid)
                    }
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 9))
                        .foregroundColor(.onSurfaceVariant.opacity(0.35))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 3)
    }

    private func fileTypeIcon(_ type: String) -> String {
        switch type.lowercased() {
        case "pdf": return "doc.richtext"
        case "xlsx", "xls": return "tablecells"
        case "pptx", "ppt": return "play.rectangle"
        default: return "doc.text"
        }
    }

    @ViewBuilder
    private func sidebarMilestoneRow(_ ms: APIMilestone) -> some View {
        HStack(spacing: Spacing.sm) {
            Button {
                guard let pid = selectedApiProject?.id else { return }
                Task {
                    await dataStore.toggleMilestone(apiProjectId: pid, milestoneId: ms.id, isDone: !ms.isDone)
                    await reloadProjectData()
                }
            } label: {
                Image(systemName: ms.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 14))
                    .foregroundColor(ms.isDone ? .primary500 : .onSurfaceVariant.opacity(0.5))
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 1) {
                Text(ms.title)
                    .font(TextStyle.bodySM)
                    .foregroundColor(ms.isDone ? .onSurfaceVariant : .onSurface)
                    .strikethrough(ms.isDone, color: .onSurfaceVariant)
                    .lineLimit(2)
                if let due = ms.dueDate, !due.isEmpty {
                    Text(due).font(.system(size: 9)).foregroundColor(.onSurfaceVariant.opacity(0.7))
                }
            }

            Spacer()

            // Priority dot
            if ms.priority == "high" {
                Circle().fill(Color(hex: "#EF4444")).frame(width: 5, height: 5)
            } else if ms.priority == "medium" {
                Circle().fill(Color(hex: "#F59E0B")).frame(width: 5, height: 5)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.sm + 1)
    }

    @ViewBuilder
    private func miniNavItem(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                Image(systemName: icon).font(.system(size: 13)).foregroundColor(.onSurfaceVariant).frame(width: 18)
                Text(label).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                Spacer()
            }
            .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
        }
        .buttonStyle(.plain)
    }

    private func reloadProjectData() async {
        guard let pid = selectedApiProject?.id else {
            milestones = []; projectFiles = []; apiFolders = []; return
        }
        async let ms = dataStore.loadProjectMilestones(apiProjectId: pid)
        async let fs = dataStore.loadProjectFiles(apiProjectId: pid)
        async let fds = dataStore.loadProjectFolders(apiProjectId: pid)
        milestones = await ms
        projectFiles = await fs
        apiFolders = await fds
        expandedFolderIds = Set(apiFolders.map { $0.id })
    }

    private func submitMilestone() {
        let title = newMilestoneTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let pid = selectedApiProject?.id else { return }
        showAddMilestone = false
        Task {
            _ = await dataStore.createMilestone(apiProjectId: pid, title: title)
            await reloadProjectData()
        }
    }

    private var helpPopover: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(lang.t("帮助中心", "Help Center"))
                .font(TextStyle.titleSM).foregroundColor(.onSurface)

            Divider().opacity(0.4)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(lang.t("快捷键", "Keyboard Shortcuts"))
                    .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                shortcutRow(lang.t("新建对话", "New Chat"), key: "⌘ N")
                shortcutRow(lang.t("发送消息", "Send Message"), key: "↵ Return")
                shortcutRow(lang.t("插入换行", "New Line"), key: "⇧↵")
                shortcutRow(lang.t("选择技能", "Pick Skill"), key: "@ 符号")
                shortcutRow(lang.t("引用文档", "Reference Doc"), key: "# 符号")
            }

            Divider().opacity(0.4)

            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(lang.t("使用技巧", "Tips"))
                    .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                tipRow(lang.t("在技能中心选择技能后，AI 会按照专业框架引导你完成任务。",
                               "Select a skill from the Skills Center — the AI will guide you through a professional framework."))
                tipRow(lang.t("在聊天中使用 # 关联项目上下文，让 AI 更精准地理解背景。",
                               "Use # in chat to attach project context so the AI understands the background."))
                tipRow(lang.t("上传文档到知识库后，可在聊天中用 / 直接引用。",
                               "Upload docs to the Knowledge Base, then reference them in chat with /."))
            }
        }
        .padding(Spacing.lg)
        .frame(width: 300)
        .background(Color.surfaceContainerLowest)
    }

    @ViewBuilder
    private func shortcutRow(_ label: String, key: String) -> some View {
        HStack {
            Text(label).font(TextStyle.bodySM).foregroundColor(.onSurface)
            Spacer()
            Text(key)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.onSurfaceVariant)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Color.surfaceContainerHigh)
                .clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }

    @ViewBuilder
    private func tipRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.xs) {
            Text("•").font(TextStyle.bodySM).foregroundColor(.primary500)
            Text(text).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func navItem(_ screen: AppScreen) -> some View {
        let isActive = appState.selectedScreen == screen
        Button {
            if screen == .projects {
                appState.selectedProject = nil
            }
            appState.selectedScreen = screen
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: screen.icon)
                    .font(.system(size: 14, weight: isActive ? .semibold : .regular))
                    .foregroundColor(isActive ? .primary500 : .onSurfaceVariant)
                    .frame(width: 18)
                Text(screen.label(for: lang))
                    .font(isActive ? TextStyle.titleSM : TextStyle.bodySM)
                    .foregroundColor(isActive ? .onPrimaryFixed : .onSurfaceVariant)
                Spacer()
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm + 1)
            .background(
                isActive
                    ? Color.primaryFixed
                    : (hoveredScreen == screen ? Color.surfaceBright : Color.clear)
            )
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
        .onHover { h in hoveredScreen = h ? screen : nil }
        .animation(.easeInOut(duration: 0.15), value: isActive)
    }

    private var sidebarSyncDotColor: Color {
        let docs = dataStore.apiDocuments
        guard !docs.isEmpty else { return dataStore.isLoading ? .onSurfaceVariant : .statusActive }
        let failed = docs.filter { $0.vectorStatus == "failed" }.count
        let synced = docs.filter { $0.vectorStatus == "synced" }.count
        if failed > 0 && synced + failed == docs.count { return .statusFailed }
        if synced == docs.count { return .statusActive }
        return .primary500
    }

    @ViewBuilder
    private func sidebarFooterItem(icon: String, label: String, action: (() -> Void)? = nil) -> some View {
        Button { action?() } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundColor(.onSurfaceVariant)
                    .frame(width: 18)
                Text(label)
                    .font(TextStyle.bodySM)
                    .foregroundColor(.onSurfaceVariant)
                Spacer()
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm + 1)
        }
        .buttonStyle(.plain)
    }
}
