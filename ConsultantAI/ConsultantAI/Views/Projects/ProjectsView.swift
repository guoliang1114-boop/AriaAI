import SwiftUI

struct ProjectsView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang

    // "bd" | "delivery" | "archive"
    @State private var selectedStage: Project.ProjectStatus.Stage = .bd
    @State private var showNewProject = false
    @State private var apiLatencyMs: Int? = nil

    var syncPercentage: Int {
        let docs = dataStore.apiDocuments
        guard !docs.isEmpty else { return 100 }
        let synced = docs.filter { $0.vectorStatus == "synced" }.count
        return Int(Double(synced) / Double(docs.count) * 100)
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBarView(
                title: lang.t("项目组合", "Project Portfolio"),
                subtitle: lang.t("商机拓展 · 执行交付 · 已归档", "Pipeline · Delivery · Archive")
            ) {
                HStack(spacing: Spacing.sm) {
                    stageTab(lang.t("商机拓展", "BD Pipeline"), stage: .bd,
                             count: dataStore.projects.filter { $0.status.stage == .bd }.count)
                    stageTab(lang.t("执行交付", "Delivering"), stage: .delivery,
                             count: dataStore.projects.filter { $0.status.stage == .delivery }.count)
                    stageTab(lang.t("已归档", "Archived"), stage: .archive,
                             count: dataStore.projects.filter { $0.status.stage == .archive }.count)
                }
                Spacer()
                PrimaryButton(lang.t("新建项目", "New Project"), icon: "plus") { showNewProject = true }
            }
            .sheet(isPresented: $showNewProject) {
                NewProjectSheet(isPresented: $showNewProject)
            }

            Group {
                switch selectedStage {
                case .bd:       BDKanbanView()
                case .delivery: DeliveryGridView()
                case .archive:  ArchiveGridView()
                }
            }
            .transition(.opacity)
            .animation(.easeInOut(duration: 0.15), value: selectedStage)

            // Status bar
            HStack(spacing: Spacing.xl) {
                let syncPct = syncPercentage
                statusChip(
                    lang.t("全局同步", "GLOBAL SYNC"),
                    value: syncPct == 100 ? lang.t("已同步", "Synced") : lang.t("同步中 (\(syncPct)%)", "In progress (\(syncPct)%)"),
                    valueColor: syncPct == 100 ? .statusActive : .primary500
                )
                statusChip(
                    lang.t("API 延迟", "API LATENCY"),
                    value: apiLatencyMs.map { "\($0)ms" } ?? "–",
                    valueColor: apiLatencyMs.map { $0 < 500 ? Color.statusActive : Color.statusOnHold } ?? .onSurfaceVariant
                )
                Spacer()
                statusChip(lang.t("模型版本", "MODEL VERSION"),
                           value: UserDefaults.standard.string(forKey: "selectedModel") ?? "Claude Sonnet 4.6",
                           valueColor: .onSurfaceVariant)
            }
            .padding(.horizontal, Spacing.xxl)
            .padding(.vertical, Spacing.md)
            .background(.surfaceContainerLowest)
        }
        .task { await measureLatency() }
    }

    private func measureLatency() async {
        let start = Date()
        _ = try? await APIClient.shared.get("/projects") as [APIProject]
        let ms = Int(Date().timeIntervalSince(start) * 1000)
        apiLatencyMs = ms
    }

    @ViewBuilder
    private func stageTab(_ label: String, stage: Project.ProjectStatus.Stage, count: Int) -> some View {
        let isActive = selectedStage == stage
        Button { withAnimation { selectedStage = stage } } label: {
            HStack(spacing: 5) {
                Text(label).font(TextStyle.labelMD)
                if count > 0 {
                    Text("\(count)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(isActive ? .white : .onSurfaceVariant)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(isActive ? Color.white.opacity(0.25) : Color.surfaceContainerHighest)
                        .clipShape(Capsule())
                }
            }
            .foregroundColor(isActive ? .white : .onSurfaceVariant)
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.xs + 2)
            .background(isActive ? Color.primary500 : Color.surfaceContainerHigh)
            .clipShape(RoundedRectangle(cornerRadius: Radius.pill))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func statusChip(_ label: String, value: String, valueColor: Color) -> some View {
        HStack(spacing: Spacing.xs) {
            Text(label).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
            Text(value).font(TextStyle.labelSM).fontWeight(.semibold).foregroundColor(valueColor)
        }
    }
}

// MARK: - BD Kanban (线索 | 商机 | 中标)

struct BDKanbanView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @State private var showNewProject = false

    private let columns: [Project.ProjectStatus] = [.lead, .opportunity, .won]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(columns, id: \.self) { status in
                kanbanColumn(status)
                if status != .won { Divider() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.surfaceBase)
        .sheet(isPresented: $showNewProject) {
            NewProjectSheet(isPresented: $showNewProject)
        }
    }

    @ViewBuilder
    private func kanbanColumn(_ status: Project.ProjectStatus) -> some View {
        let projects = dataStore.projects.filter { $0.status == status }
        let color = Color(hex: status.color)

        VStack(alignment: .leading, spacing: 0) {
            // Column header
            HStack(spacing: Spacing.sm) {
                Circle().fill(color).frame(width: 8, height: 8)
                Text(status.label(for: lang))
                    .font(TextStyle.titleSM)
                    .foregroundColor(.onSurface)
                Spacer()
                Text("\(projects.count)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(color)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(color.opacity(0.1))
                    .clipShape(Capsule())
            }
            .padding(.horizontal, Spacing.lg)
            .padding(.vertical, Spacing.md)
            .background(color.opacity(0.04))

            Divider()

            ScrollView {
                LazyVStack(spacing: Spacing.sm) {
                    ForEach(projects) { project in
                        ProjectCard(
                            project: project,
                            onOpen: { appState.selectedProject = project },
                            onDelete: {
                                if let api = dataStore.apiProjects.first(where: { $0.name == project.name }) {
                                    Task { await dataStore.deleteProject(apiId: api.id) }
                                }
                            },
                            onPromote: project.status.next.map { nextStatus in {
                                if let api = dataStore.apiProjects.first(where: { $0.name == project.name }) {
                                    Task { await dataStore.updateProjectStatus(apiId: api.id, status: nextStatus.rawValue) }
                                }
                            }},
                            onChangeStatus: { newStatus in
                                if let api = dataStore.apiProjects.first(where: { $0.name == project.name }) {
                                    Task { await dataStore.updateProjectStatus(apiId: api.id, status: newStatus.rawValue) }
                                }
                            }
                        )
                    }

                    // Add project button at bottom of column
                    Button { showNewProject = true } label: {
                        HStack(spacing: Spacing.xs) {
                            Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                            Text(lang.t("添加项目", "Add project")).font(TextStyle.labelSM)
                        }
                        .foregroundColor(.onSurfaceVariant)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.sm)
                        .background(Color.surfaceContainerHigh.opacity(0.5))
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)
                }
                .padding(Spacing.md)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Delivery Grid

struct DeliveryGridView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @State private var showNewProject = false

    var projects: [Project] { dataStore.projects.filter { $0.status.stage == .delivery } }

    var body: some View {
        ScrollView {
            if projects.isEmpty {
                emptyState(
                    icon: "bolt",
                    title: lang.t("暂无执行中的项目", "No projects in delivery"),
                    sub: lang.t("中标项目推进后会出现在这里", "Won projects will appear here once promoted")
                )
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
                    spacing: Spacing.lg
                ) {
                    ForEach(projects) { project in
                        ProjectCard(
                            project: project,
                            onOpen: { appState.selectedProject = project },
                            onDelete: {
                                if let api = dataStore.apiProjects.first(where: { $0.name == project.name }) {
                                    Task { await dataStore.deleteProject(apiId: api.id) }
                                }
                            },
                            onChangeStatus: { newStatus in
                                if let api = dataStore.apiProjects.first(where: { $0.name == project.name }) {
                                    Task { await dataStore.updateProjectStatus(apiId: api.id, status: newStatus.rawValue) }
                                }
                            }
                        )
                    }
                    NewWorkspaceCard { showNewProject = true }
                }
                .padding(Spacing.xxl)
            }
        }
        .background(.surfaceBase)
        .sheet(isPresented: $showNewProject) { NewProjectSheet(isPresented: $showNewProject) }
    }
}

// MARK: - Archive Grid

struct ArchiveGridView: View {
    @EnvironmentObject var appState: AppStateManager
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang

    var projects: [Project] { dataStore.projects.filter { $0.status.stage == .archive } }

    var body: some View {
        ScrollView {
            if projects.isEmpty {
                emptyState(
                    icon: "archivebox",
                    title: lang.t("暂无归档项目", "No archived projects"),
                    sub: lang.t("归档的项目会保留在这里", "Archived projects will be kept here")
                )
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
                    spacing: Spacing.lg
                ) {
                    ForEach(projects) { project in
                        ProjectCard(
                            project: project,
                            onOpen: { appState.selectedProject = project },
                            onDelete: {
                                if let api = dataStore.apiProjects.first(where: { $0.name == project.name }) {
                                    Task { await dataStore.deleteProject(apiId: api.id) }
                                }
                            },
                            onChangeStatus: { newStatus in
                                if let api = dataStore.apiProjects.first(where: { $0.name == project.name }) {
                                    Task { await dataStore.updateProjectStatus(apiId: api.id, status: newStatus.rawValue) }
                                }
                            }
                        )
                    }
                }
                .padding(Spacing.xxl)
            }
        }
        .background(.surfaceBase)
    }
}

@ViewBuilder
private func emptyState(icon: String, title: String, sub: String) -> some View {
    VStack(spacing: Spacing.lg) {
        Image(systemName: icon)
            .font(.system(size: 36, weight: .light))
            .foregroundColor(.onSurfaceVariant.opacity(0.35))
        VStack(spacing: 4) {
            Text(title).font(TextStyle.titleSM).foregroundColor(.onSurfaceVariant)
            Text(sub).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant.opacity(0.7))
        }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(.top, 80)
}

// MARK: - Project Card
struct ProjectCard: View {
    let project: Project
    let onOpen: () -> Void
    let onDelete: () -> Void
    var onPromote: (() -> Void)? = nil
    var onArchive: (() -> Void)? = nil
    var onChangeStatus: ((Project.ProjectStatus) -> Void)? = nil
    @Environment(\.appLanguage) var lang
    @State private var isHovered = false
    @State private var confirmDelete = false

    private var statusColor: Color { Color(hex: project.status.color) }

    private var actionLabel: String {
        switch project.status.stage {
        case .bd:       return lang.t("查看详情 →", "VIEW DETAILS →")
        case .delivery: return lang.t("打开项目 →", "OPEN PROJECT →")
        case .archive:  return lang.t("查看归档 ↻", "VIEW ARCHIVE ↻")
        }
    }

    var body: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Header
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack {
                        // Status badge
                        HStack(spacing: 5) {
                            Circle().fill(statusColor).frame(width: 7, height: 7)
                            Text(project.status.label(for: lang))
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundColor(statusColor)
                        }
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(statusColor.opacity(0.1))
                        .clipShape(Capsule())

                        Spacer()

                        Menu {
                            if let promote = onPromote, let nextStatus = project.status.next {
                                Button {
                                    promote()
                                } label: {
                                    Label(lang.t("推进至「\(nextStatus.label(for: lang))」", "Promote to \(nextStatus.label(for: lang))"),
                                          systemImage: "arrow.right.circle")
                                }
                                Divider()
                            }
                            if let change = onChangeStatus {
                                Menu {
                                    ForEach(Project.ProjectStatus.allCases, id: \.self) { s in
                                        if s != project.status {
                                            Button {
                                                change(s)
                                            } label: {
                                                Label(s.label(for: lang), systemImage: s == .archived ? "archivebox" : "circle.fill")
                                            }
                                        }
                                    }
                                } label: {
                                    Label(lang.t("修改状态", "Change Status"), systemImage: "arrow.triangle.2.circlepath")
                                }
                            }
                            Divider()
                            Button(role: .destructive) { confirmDelete = true } label: {
                                Label(lang.t("删除项目", "Delete Project"), systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .foregroundColor(.onSurfaceVariant)
                                .font(.system(size: 13))
                        }
                        .menuStyle(.borderlessButton)
                        .fixedSize()
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(project.name).font(TextStyle.titleMD).foregroundColor(.onSurface)
                        Text(project.client).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    }
                }
                .padding(Spacing.lg)

                Divider().opacity(0.4)

                // Stats
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    metaRow(lang.t("上下文新鲜度", "CONTEXT FRESHNESS")) {
                        ProgressBar(progress: project.contextFreshness, height: 5,
                                    color: project.contextFreshness > 0.6 ? .primary500 : project.contextFreshness > 0.3 ? .statusOnHold : .statusCompleted)
                            .frame(maxWidth: 100)
                    }
                    metaRow(lang.t("文件数", "FILES COUNT")) {
                        Text("\(project.filesCount)").font(TextStyle.titleSM).foregroundColor(.onSurface)
                    }
                }
                .padding(Spacing.lg)

                Divider().opacity(0.4)

                // Action row
                HStack {
                    AvatarView(initials: String(project.client.prefix(1)))
                    Spacer()
                    Button { onOpen() } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "arrow.up.right.square")
                                .font(.system(size: 10, weight: .semibold))
                            Text(lang.t("打开", "Open"))
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(LinearGradient(colors: [.primary500, Color(hex: "#6366F1")],
                                                   startPoint: .topLeading, endPoint: .bottomTrailing))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(Spacing.lg)
            }
        }
        .scaleEffect(isHovered ? 1.01 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: isHovered)
        .onHover { isHovered = $0 }
        .alert(lang.t("删除「\(project.name)」？", "Delete \"\(project.name)\"?"), isPresented: $confirmDelete) {
            Button(lang.t("删除", "Delete"), role: .destructive) { onDelete() }
            Button(lang.t("取消", "Cancel"), role: .cancel) {}
        } message: {
            Text(lang.t(
                "此项目及其所有文件和里程碑将被永久删除。",
                "This project and all its files and milestones will be permanently deleted."
            ))
        }
    }

    @ViewBuilder
    private func metaRow<V: View>(_ label: String, @ViewBuilder value: () -> V) -> some View {
        HStack {
            Text(label).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
            Spacer()
            value()
        }
    }
}

// MARK: - New Project Sheet
struct NewProjectSheet: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @Binding var isPresented: Bool

    @State private var name = ""
    @State private var selectedClient: ClientRecord? = nil
    @State private var description = ""
    @State private var selectedStatus: Project.ProjectStatus = .lead
    @State private var isSaving = false
    @State private var errorMessage: String? = nil

    // AI fill state
    @State private var aiQuery = ""
    @State private var isAILoading = false
    @State private var suggestions: [APIProjectSuggestion] = []
    @State private var showSuggestions = false
    @State private var aiError: String? = nil

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        selectedClient != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(lang.t("新建项目", "New Project"))
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.onSurface)
                    Text(lang.t("创建一个新的 AI 增强项目空间", "Create a new AI-enhanced project environment."))
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                }
                Spacer()
                // AI Fill button
                Button { runAISuggest() } label: {
                    HStack(spacing: 4) {
                        if isAILoading {
                            ProgressView().scaleEffect(0.7).frame(width: 14, height: 14)
                        } else {
                            Image(systemName: "sparkles")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        Text(isAILoading ? lang.t("AI 生成中…", "AI filling…") : lang.t("AI 填写", "AI Fill"))
                            .font(TextStyle.labelMD)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, Spacing.md)
                    .padding(.vertical, Spacing.sm)
                    .background(isAILoading ? Color.primary500.opacity(0.6) : Color.primary500)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
                .disabled(isAILoading || aiQuery.trimmingCharacters(in: .whitespaces).isEmpty)

                Button { isPresented = false } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                        .frame(width: 28, height: 28)
                        .background(Color.surfaceContainerHigh)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(Spacing.xl)

            Divider().opacity(0.4)

            // Form
            VStack(alignment: .leading, spacing: Spacing.lg) {
                // AI query field
                VStack(alignment: .leading, spacing: 6) {
                    Text(lang.t("项目想法（AI 填写用）", "Project idea (for AI Fill)"))
                        .font(TextStyle.labelSM)
                        .foregroundColor(.onSurfaceVariant)
                    TextField(
                        lang.t("简述项目目标，AI 将自动生成名称和描述…", "Describe the project goal, AI will generate name & description…"),
                        text: $aiQuery
                    )
                    .textFieldStyle(.plain)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                    .padding(Spacing.sm)
                    .background(Color.primary500.opacity(0.04))
                    .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.sm)
                            .strokeBorder(Color.primary500.opacity(0.25), lineWidth: 1)
                    )
                    .onSubmit { runAISuggest() }
                }

                // Suggestion cards
                if showSuggestions && suggestions.count > 1 {
                    VStack(alignment: .leading, spacing: Spacing.sm) {
                        Text(lang.t("选择一个方向，或在下方继续编辑：", "Pick a direction, or keep editing below:"))
                            .font(TextStyle.labelSM)
                            .foregroundColor(.onSurfaceVariant)
                        ForEach(suggestions.indices, id: \.self) { i in
                            suggestionCard(suggestions[i])
                        }
                    }
                    .padding(Spacing.md)
                    .background(Color.primary500.opacity(0.04))
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.primary500.opacity(0.2), lineWidth: 1))
                }

                if let err = aiError {
                    Text(err).font(TextStyle.labelSM).foregroundColor(.statusFailed)
                }

                Divider().opacity(0.3)

                clientPickerField
                statusPickerField
                formField(
                    label: lang.t("项目名称 *", "Project Name *"),
                    placeholder: lang.t("例：市场进入战略", "e.g. Market Entry Strategy"),
                    text: $name
                )
                formField(
                    label: lang.t("描述", "Description"),
                    placeholder: lang.t("项目范围简要说明…", "Brief overview of the project scope…"),
                    text: $description,
                    multiline: true
                )
            }
            .padding(Spacing.xl)

            if let err = errorMessage {
                Text(err)
                    .font(TextStyle.bodySM)
                    .foregroundColor(Color(hex: "#b3261e"))
                    .padding(.horizontal, Spacing.xl)
                    .padding(.bottom, Spacing.sm)
            }

            Divider().opacity(0.4)

            // Action row
            HStack {
                Spacer()
                Button(lang.t("取消", "Cancel")) { isPresented = false }
                    .buttonStyle(.plain)
                    .font(TextStyle.labelMD)
                    .foregroundColor(.onSurfaceVariant)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)

                Button {
                    guard canSave else { return }
                    isSaving = true
                    errorMessage = nil
                    Task {
                        let ok = await dataStore.createProject(
                            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                            client: selectedClient?.name ?? "",
                            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
                            status: selectedStatus.rawValue
                        )
                        isSaving = false
                        if ok {
                            isPresented = false
                        } else {
                            errorMessage = dataStore.error ?? lang.t("创建失败", "Failed to create project")
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        if isSaving { ProgressView().controlSize(.mini).tint(.white) }
                        Text(isSaving ? lang.t("创建中…", "Creating…") : lang.t("创建项目", "Create Project"))
                            .font(TextStyle.labelMD).foregroundColor(.white)
                    }
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm)
                    .background(canSave
                        ? AnyShapeStyle(LinearGradient(colors: [.primary600, .primary500], startPoint: .topLeading, endPoint: .bottomTrailing))
                        : AnyShapeStyle(Color.onSurfaceVariant.opacity(0.4)))
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
                .disabled(!canSave || isSaving)
            }
            .padding(Spacing.xl)
        }
        .frame(width: 480)
        .background(Color.surfaceContainerLowest)
    }

    // MARK: - AI

    private func runAISuggest() {
        let query = aiQuery.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return }
        isAILoading = true
        aiError = nil
        showSuggestions = false
        Task {
            let results = await dataStore.suggestProject(
                query: query,
                clientName: selectedClient?.name ?? "",
                clientIndustry: selectedClient?.industry ?? ""
            )
            isAILoading = false
            if results.isEmpty {
                aiError = lang.t("AI 未返回结果，请手动填写", "AI returned no results — fill manually")
            } else {
                applySuggestion(results[0])
                if results.count > 1 {
                    suggestions = results
                    showSuggestions = true
                }
            }
        }
    }

    private func applySuggestion(_ s: APIProjectSuggestion) {
        name = s.name
        description = s.description
    }

    @ViewBuilder
    private func suggestionCard(_ s: APIProjectSuggestion) -> some View {
        Button { applySuggestion(s); showSuggestions = false } label: {
            HStack(alignment: .top, spacing: Spacing.md) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12))
                    .foregroundColor(.primary500)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(s.name)
                        .font(TextStyle.titleSM)
                        .foregroundColor(.onSurface)
                    Text(s.description)
                        .font(TextStyle.labelSM)
                        .foregroundColor(.onSurfaceVariant)
                        .lineLimit(2)
                }
                Spacer()
                Image(systemName: "arrow.right.circle")
                    .font(.system(size: 14))
                    .foregroundColor(.primary500.opacity(0.6))
            }
            .padding(Spacing.md)
            .background(Color.surfaceContainerLowest)
            .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var statusPickerField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(lang.t("初始状态", "Initial Status"))
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
            HStack(spacing: Spacing.sm) {
                ForEach(Project.ProjectStatus.allCases, id: \.self) { s in
                    let isSelected = selectedStatus == s
                    let color = Color(hex: s.color)
                    Button { selectedStatus = s } label: {
                        HStack(spacing: 5) {
                            Circle().fill(color).frame(width: 6, height: 6)
                            Text(s.label(for: lang))
                                .font(.system(size: 11, weight: isSelected ? .semibold : .regular))
                                .foregroundColor(isSelected ? color : .onSurfaceVariant)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(isSelected ? color.opacity(0.12) : Color.surfaceContainerHigh)
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(isSelected ? color.opacity(0.5) : Color.clear, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private var clientPickerField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(lang.t("客户 *", "Client *"))
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)

            if dataStore.clients.isEmpty {
                HStack(spacing: Spacing.sm) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 12))
                        .foregroundColor(.statusOnHold)
                    Text(lang.t("暂无客户，请先前往「客户管理」新增", "No clients yet — go to Clients to add one first"))
                        .font(TextStyle.bodySM)
                        .foregroundColor(.statusOnHold)
                }
                .padding(Spacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.statusOnHold.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Color.statusOnHold.opacity(0.3), lineWidth: 1))
            } else {
                Menu {
                    ForEach(dataStore.clients) { client in
                        Button {
                            selectedClient = client
                        } label: {
                            HStack {
                                Text(client.name)
                                if !client.industry.isEmpty {
                                    Text("· \(client.industry)")
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                } label: {
                    HStack {
                        if let c = selectedClient {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(c.name)
                                    .font(TextStyle.bodyMD)
                                    .foregroundColor(.onSurface)
                                if !c.industry.isEmpty {
                                    Text(c.industry)
                                        .font(TextStyle.labelSM)
                                        .foregroundColor(.onSurfaceVariant)
                                }
                            }
                        } else {
                            Text(lang.t("选择客户…", "Select a client…"))
                                .font(TextStyle.bodyMD)
                                .foregroundColor(.onSurfaceVariant.opacity(0.6))
                        }
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.onSurfaceVariant)
                    }
                    .padding(Spacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.surfaceContainerLow)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                    .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Color.outlineVariant.opacity(0.5), lineWidth: 1))
                }
                .menuStyle(.borderlessButton)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func formField(label: String, placeholder: String, text: Binding<String>, multiline: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
            if multiline {
                TextEditor(text: text)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                    .frame(height: 80)
                    .padding(Spacing.sm)
                    .background(Color.surfaceContainerLow)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.sm)
                            .strokeBorder(Color.outlineVariant.opacity(0.5), lineWidth: 1)
                    )
            } else {
                TextField(placeholder, text: text)
                    .textFieldStyle(.plain)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                    .padding(Spacing.sm)
                    .background(Color.surfaceContainerLow)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.sm)
                            .strokeBorder(Color.outlineVariant.opacity(0.5), lineWidth: 1)
                    )
            }
        }
    }
}

// MARK: - New Workspace Card
struct NewWorkspaceCard: View {
    let onTap: () -> Void
    @Environment(\.appLanguage) var lang
    @State private var isHovered = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Radius.lg)
                .fill(Color.surfaceContainerLowest)
            VStack(spacing: Spacing.md) {
                ZStack {
                    Circle().fill(Color.primary500.opacity(0.1)).frame(width: 48, height: 48)
                    Image(systemName: "plus").font(.system(size: 20, weight: .semibold)).foregroundColor(.primary500)
                }
                VStack(spacing: Spacing.xs) {
                    Text(lang.t("新建工作空间", "Initiate New Workspace")).font(TextStyle.titleSM).foregroundColor(.onSurface)
                    Text(lang.t("创建新的 AI 增强项目环境", "Create a new AI-enhanced project environment."))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xl)
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5]))
                .foregroundColor(Color.outlineVariant.opacity(isHovered ? 0.8 : 0.4))
        }
        .shadow(color: Color.primary600.opacity(0.06), radius: 20, x: 0, y: 4)
        .contentShape(RoundedRectangle(cornerRadius: Radius.lg))
        .onTapGesture { onTap() }
        .onHover { isHovered = $0 }
        .animation(.easeInOut(duration: 0.15), value: isHovered)
    }
}
