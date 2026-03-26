import SwiftUI
import AppKit

struct TemplatesView: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @State private var searchText = ""
    @State private var isUploading = false
    @State private var uploadError: String? = nil
    @State private var showFilterPopover = false
    @State private var selectedCategory: String? = nil

    var templates: [Template] { dataStore.templates.isEmpty ? SampleData.templates(for: lang) : dataStore.templates }

    private var allCategories: [String] {
        let cats = templates.map { $0.category }
        return Array(Set(cats)).sorted()
    }

    private var filteredTemplates: [Template] {
        guard let cat = selectedCategory else { return templates }
        return templates.filter { $0.category == cat }
    }

    var recentActivity: [(id: Int, name: String, modified: String, project: String, status: String, statusColor: Color)] {
        let f = DateFormatter()
        f.dateStyle = .medium; f.timeStyle = .none
        let sorted = dataStore.apiTemplates.sorted { $0.uploadedAt > $1.uploadedAt }.prefix(3)
        if sorted.isEmpty { return [] }
        return sorted.enumerated().map { idx, t in
            let statusLabel: String
            let statusColor: Color
            switch t.status {
            case "active":   statusLabel = lang.t("活跃", "ACTIVE");   statusColor = .statusActive
            case "archived": statusLabel = lang.t("已归档", "ARCHIVED"); statusColor = .onSurfaceVariant
            default:         statusLabel = lang.t("草稿", "DRAFT");     statusColor = .statusOnHold
            }
            let diff = Date().timeIntervalSince(t.uploadedAt)
            let modifiedLabel: String
            if diff < 3600 { modifiedLabel = lang.t("\(Int(diff/60))分钟前", "\(Int(diff/60))m ago") }
            else if diff < 86400 { modifiedLabel = lang.t("\(Int(diff/3600))小时前", "\(Int(diff/3600))h ago") }
            else { modifiedLabel = lang.t("\(Int(diff/86400))天前", "\(Int(diff/86400))d ago") }
            return (idx, t.name, modifiedLabel, t.category, statusLabel, statusColor)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBarView(
                title: lang.t("模板库", "Template Library"),
                subtitle: lang.t("管理和部署专业 PPTX / DOCX 文档框架", "Manage and deploy professional PPTX and DOCX document frameworks.")
            ) {
                SecondaryButton(
                    selectedCategory != nil ? lang.t("已筛选", "Filtered") : lang.t("筛选", "Filter"),
                    icon: "slider.horizontal.3"
                ) {
                    showFilterPopover = true
                }
                .popover(isPresented: $showFilterPopover, arrowEdge: .bottom) {
                    filterPopover
                }
                PrimaryButton(isUploading ? lang.t("上传中…", "Uploading…") : lang.t("上传模板", "Upload Template"), icon: "arrow.up.doc") {
                    pickAndUploadTemplate()
                }
                .disabled(isUploading)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xxl) {
                    // Grid
                    if let err = uploadError {
                        HStack(spacing: Spacing.sm) {
                            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.statusFailed)
                            Text(err).font(TextStyle.bodySM).foregroundColor(.statusFailed)
                            Spacer()
                            Button { uploadError = nil } label: {
                                Image(systemName: "xmark").font(.system(size: 11)).foregroundColor(.onSurfaceVariant)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(Spacing.md)
                        .background(Color.statusFailed.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }

                    LazyVGrid(
                        columns: [GridItem(.flexible(), spacing: Spacing.lg), GridItem(.flexible(), spacing: Spacing.lg), GridItem(.flexible(), spacing: Spacing.lg)],
                        spacing: Spacing.lg
                    ) {
                        ForEach(filteredTemplates) { TemplateCard(template: $0) }
                        AddTemplateCard(onTap: { pickAndUploadTemplate() })
                    }

                    // Recent Activity
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        SectionHeader(title: lang.t("最近活动", "Recent Activity"))

                        HStack {
                            Text(lang.t("模板名称", "TEMPLATE NAME")).frame(maxWidth: .infinity, alignment: .leading)
                            Text(lang.t("最后修改", "LAST MODIFIED")).frame(width: 160, alignment: .leading)
                            Text(lang.t("关联项目", "ASSIGNED PROJECTS")).frame(width: 200, alignment: .leading)
                            Text(lang.t("状态", "STATUS")).frame(width: 80, alignment: .trailing)
                        }
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                        .padding(.horizontal, Spacing.lg)

                        VStack(spacing: 0) {
                            ForEach(recentActivity, id: \.id) { item in
                                HStack {
                                    HStack(spacing: Spacing.sm) {
                                        RoundedRectangle(cornerRadius: 4).fill(Color.primary500).frame(width: 4, height: 32)
                                        Text(item.name).font(TextStyle.bodyMD).foregroundColor(.onSurface)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)

                                    Text(item.modified).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant).frame(width: 160, alignment: .leading)
                                    Text(item.project).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant).frame(width: 200, alignment: .leading)
                                    Text(item.status).font(TextStyle.labelSM).foregroundColor(item.statusColor).frame(width: 80, alignment: .trailing)
                                }
                                .padding(.horizontal, Spacing.lg)
                                .padding(.vertical, Spacing.md)

                                if item.id < recentActivity.count - 1 {
                                    Color.surfaceContainerHigh.frame(height: 1).opacity(0.5)
                                }
                            }
                        }
                        .background(Color.surfaceContainerLowest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
                    }
                }
                .padding(Spacing.xxl)
            }
            .background(.surfaceBase)
        }
    }

    @ViewBuilder private var filterPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(lang.t("按分类筛选", "Filter by Category"))
                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                .padding(.horizontal, Spacing.md).padding(.top, Spacing.md).padding(.bottom, Spacing.xs)
            Divider()
            VStack(alignment: .leading, spacing: 2) {
                Button {
                    selectedCategory = nil
                    showFilterPopover = false
                } label: {
                    HStack {
                        Text(lang.t("全部", "All")).font(TextStyle.bodyMD).foregroundColor(.onSurface)
                        Spacer()
                        if selectedCategory == nil {
                            Image(systemName: "checkmark").font(.system(size: 11)).foregroundColor(.primary500)
                        }
                    }
                    .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                }
                .buttonStyle(.plain)
                ForEach(allCategories, id: \.self) { cat in
                    Button {
                        selectedCategory = cat
                        showFilterPopover = false
                    } label: {
                        HStack {
                            Text(cat).font(TextStyle.bodyMD).foregroundColor(.onSurface)
                            Spacer()
                            if selectedCategory == cat {
                                Image(systemName: "checkmark").font(.system(size: 11)).foregroundColor(.primary500)
                            }
                        }
                        .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, Spacing.xs)
        }
        .frame(width: 200)
        .background(Color.surfaceContainerLowest)
    }

    private func pickAndUploadTemplate() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.init(filenameExtension: "pptx")!, .init(filenameExtension: "docx")!, .pdf]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        isUploading = true
        uploadError = nil
        Task {
            let ok = await dataStore.uploadTemplate(fileURL: url)
            isUploading = false
            if !ok { uploadError = dataStore.error ?? lang.t("上传失败", "Upload failed") }
        }
    }
}

// MARK: - Template Card
struct TemplateCard: View {
    let template: Template
    @Environment(\.appLanguage) var lang
    @EnvironmentObject var dataStore: DataStore
    @State private var isHovered = false
    @State private var showDetails = false
    @State private var showProjectPicker = false
    @State private var showRename = false
    @State private var renameText = ""

    private var thumbnailGradient: [Color] {
        let palettes: [[Color]] = [
            [Color(hex: "#1a3a6b"), Color(hex: "#2d5986")],
            [Color(hex: "#2d6a4f"), Color(hex: "#52b788")],
            [Color(hex: "#6b3a1f"), Color(hex: "#c67c3a")],
            [Color(hex: "#1a1a2e"), Color(hex: "#16213e")],
            [Color(hex: "#2e4057"), Color(hex: "#048a81")]
        ]
        return palettes[abs(template.name.hashValue) % palettes.count]
    }

    var body: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Thumbnail
                ZStack {
                    RoundedRectangle(cornerRadius: Radius.md)
                        .fill(LinearGradient(colors: thumbnailGradient, startPoint: .topLeading, endPoint: .bottomTrailing))
                    Image(systemName: template.thumbnail).font(.system(size: 32)).foregroundColor(.white.opacity(0.6))
                }
                .frame(height: 120).padding(Spacing.md)

                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack {
                        HStack(spacing: 4) {
                            TagView(label: template.category, style: .deepTask)
                            ForEach(template.tags, id: \.self) { TagView(label: $0, style: .quickTool) }
                        }
                        Spacer()
                        if template.status != nil {
                            Image(systemName: "checkmark.seal.fill").foregroundColor(.statusActive).font(.system(size: 13))
                        }
                        Button { showRename = true } label: {
                            Image(systemName: "square.and.pencil").foregroundColor(.onSurfaceVariant).font(.system(size: 12))
                        }
                        .buttonStyle(.plain)
                        .popover(isPresented: $showRename, arrowEdge: .top) {
                            renamePopover
                        }
                    }

                    Text(template.name).font(TextStyle.titleSM).foregroundColor(.onSurface)

                    HStack(spacing: Spacing.sm) {
                        SecondaryButton(lang.t("详情", "Details")) {
                            showDetails = true
                        }
                        .sheet(isPresented: $showDetails) {
                            TemplateDetailsSheet(template: template)
                        }

                        PrimaryButton(lang.t("分配到项目", "Assign to Project")) {
                            showProjectPicker = true
                        }
                        .popover(isPresented: $showProjectPicker, arrowEdge: .bottom) {
                            templateProjectPickerPopover
                        }
                    }
                }
                .padding(Spacing.md)
            }
        }
        .onHover { isHovered = $0 }
    }

    @ViewBuilder private var renamePopover: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(lang.t("重命名模板", "Rename Template"))
                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
            TextField(template.name, text: $renameText)
                .textFieldStyle(.plain).font(TextStyle.bodyMD)
                .padding(Spacing.sm)
                .background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                .onAppear { renameText = template.name }
                .onSubmit { commitRename() }
            HStack {
                SecondaryButton(lang.t("取消", "Cancel")) { showRename = false }
                PrimaryButton(lang.t("保存", "Save"), icon: "checkmark") { commitRename() }
                    .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(Spacing.lg)
        .frame(width: 240)
        .background(Color.surfaceContainerLowest)
    }

    private func commitRename() {
        let newName = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !newName.isEmpty, let apiId = template.apiId else { showRename = false; return }
        struct Body: Encodable { let name: String }
        Task {
            _ = try? await APIClient.shared.patch("/templates/\(apiId)", body: Body(name: newName)) as APITemplate
            await dataStore.loadTemplates()
        }
        showRename = false
    }

    @ViewBuilder private var templateProjectPickerPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(lang.t("分配到项目", "Assign to Project"))
                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                .padding(.horizontal, Spacing.md).padding(.top, Spacing.md).padding(.bottom, Spacing.xs)
            Divider()
            if dataStore.projects.isEmpty {
                Text(lang.t("暂无项目，请先创建项目", "No projects yet. Create a project first."))
                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant).padding(Spacing.md)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(dataStore.projects) { project in
                        Button {
                            showProjectPicker = false
                        } label: {
                            HStack(spacing: Spacing.sm) {
                                Circle().fill(Color.statusActive).frame(width: 6, height: 6)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(project.name).font(TextStyle.labelMD).foregroundColor(.onSurface)
                                    Text(lang.t("已分配 ✓", "Assigned ✓"))
                                        .font(.system(size: 10)).foregroundColor(.statusActive)
                                }
                                Spacer()
                            }
                            .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(width: 220)
        .background(Color.surfaceContainerLowest)
    }
}

// MARK: - Template Details Sheet
struct TemplateDetailsSheet: View {
    let template: Template
    @Environment(\.dismiss) var dismiss
    @Environment(\.appLanguage) var lang

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            HStack {
                Text(lang.t("模板详情", "Template Details"))
                    .font(TextStyle.headlineSM).foregroundColor(.onSurface)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                }
                .buttonStyle(.plain)
            }

            Divider().opacity(0.4)

            VStack(alignment: .leading, spacing: Spacing.lg) {
                detailRow(lang.t("名称", "Name"), value: template.name)
                detailRow(lang.t("分类", "Category"), value: template.category)
                detailRow(lang.t("标签", "Tags"), value: template.tags.isEmpty ? "–" : template.tags.joined(separator: ", "))
                detailRow(lang.t("最后修改", "Last Modified"), value: template.lastModified)
                detailRow(lang.t("状态", "Status"), value: template.status ?? lang.t("草稿", "Draft"))
                if let project = template.assignedProject {
                    detailRow(lang.t("关联项目", "Assigned Project"), value: project)
                }
            }

            Spacer()

            HStack {
                Spacer()
                SecondaryButton(lang.t("关闭", "Close")) { dismiss() }
            }
        }
        .padding(Spacing.xxl)
        .frame(width: 400, height: 340)
        .background(Color.surfaceContainerLowest)
    }

    @ViewBuilder
    private func detailRow(_ label: String, value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                .frame(width: 90, alignment: .leading)
            Text(value)
                .font(TextStyle.bodyMD).foregroundColor(.onSurface)
        }
    }
}

// MARK: - Add Template Card
struct AddTemplateCard: View {
    var onTap: () -> Void = {}
    @Environment(\.appLanguage) var lang
    @State private var isHovered = false

    var body: some View {
        CardContainer {
            VStack(spacing: Spacing.md) {
                ZStack {
                    Circle().fill(Color.primary500.opacity(0.1)).frame(width: 48, height: 48)
                    Image(systemName: "plus").font(.system(size: 20, weight: .semibold)).foregroundColor(.primary500)
                }
                VStack(spacing: 4) {
                    Text(lang.t("添加新模板", "Add New Template")).font(TextStyle.titleSM).foregroundColor(.onSurface)
                    Text(lang.t("上传或创建新的 PPTX / DOCX 扩展你的模板库", "Upload or create a new PPTX or DOCX to expand your library."))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 220).padding(Spacing.xl)
            .overlay(
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5]))
                    .foregroundColor(Color.outlineVariant.opacity(isHovered ? 0.8 : 0.4))
            )
        }
        .contentShape(RoundedRectangle(cornerRadius: Radius.lg))
        .onTapGesture { onTap() }
        .onHover { isHovered = $0 }
        .animation(.easeInOut(duration: 0.15), value: isHovered)
    }
}
