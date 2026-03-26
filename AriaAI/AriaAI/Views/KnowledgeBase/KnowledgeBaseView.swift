import SwiftUI
import UniformTypeIdentifiers

struct KnowledgeBaseView: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @State private var searchText = ""
    @State private var activeFilters: [String] = {
        let saved = UserDefaults.standard.stringArray(forKey: "kbActiveFilters") ?? []
        return saved
    }()
    @State private var isImporting = false
    @State private var isUploading = false
    @State private var uploadError: String? = nil
    @State private var showFilterInput = false
    @State private var newFilterText = ""

    private let allowedTypes: [UTType] = [
        .pdf,
        UTType(filenameExtension: "docx") ?? .data,
        UTType(filenameExtension: "xlsx") ?? .data,
        .plainText,
    ]

    var documents: [KnowledgeDocument] {
        dataStore.documents.isEmpty ? SampleData.documents(for: lang) : dataStore.documents
    }

    var body: some View {
        HStack(spacing: 0) {
            // Main content
            VStack(spacing: 0) {
                TopBarView(
                    title: lang.t("知识库管理", "Knowledge Base"),
                    subtitle: lang.t("让 AI 读你公司的东西 · 向量化索引", "Premium Knowledge Indexing")
                ) {
                    SecondaryButton(lang.t("全部同步", "Sync All"), icon: "arrow.triangle.2.circlepath") {
                        Task { await dataStore.loadDocuments() }
                    }
                    PrimaryButton(lang.t("上传文档", "Upload Document"), icon: "arrow.up.doc") {
                        isImporting = true
                    }
                }

                ScrollView {
                    VStack(spacing: Spacing.xl) {
                        uploadZone
                        documentTable
                    }
                    .padding(Spacing.xxl)
                }
                .background(.surfaceBase)
            }

            rightPanel
        }
        .fileImporter(
            isPresented: $isImporting,
            allowedContentTypes: allowedTypes,
            allowsMultipleSelection: true
        ) { result in
            handleImport(result)
        }
    }

    // MARK: - Upload zone

    @ViewBuilder private var uploadZone: some View {
        Button { isImporting = true } label: {
            VStack(spacing: Spacing.md) {
                if isUploading {
                    ProgressView().controlSize(.large)
                    Text(lang.t("上传并建立索引中…", "Uploading & indexing…"))
                        .font(TextStyle.titleSM).foregroundColor(.onSurfaceVariant)
                } else {
                    Image(systemName: "doc.badge.plus")
                        .font(.system(size: 36)).foregroundColor(.primary500.opacity(0.6))
                    VStack(spacing: 4) {
                        Text(lang.t("点击上传文档", "Click to Upload Documents"))
                            .font(TextStyle.titleSM).foregroundColor(.onSurface)
                        Text(lang.t("PDF、Word、Excel — 自动向量化索引", "PDF, Word, Excel — auto-indexed into vector store"))
                            .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                        if let err = uploadError {
                            Text(err).font(TextStyle.labelSM).foregroundColor(.statusFailed)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.xxl)
            .background(Color.surfaceContainerLowest)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(
                        style: StrokeStyle(lineWidth: 1.5, dash: [6]),
                        antialiased: true
                    )
                    .foregroundColor(isUploading
                        ? Color.primary500.opacity(0.5)
                        : Color.outlineVariant.opacity(0.5))
            )
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.2), value: isUploading)
    }

    // MARK: - Document table

    @ViewBuilder private var documentTable: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack {
                Text(lang.t("当前文档", "ACTIVE DOCUMENTS"))
                    .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.6)
                Spacer()
                Image(systemName: "line.3.horizontal.decrease").foregroundColor(.onSurfaceVariant)
                Image(systemName: "arrow.up.arrow.down").foregroundColor(.onSurfaceVariant)
            }

            HStack {
                Text(lang.t("文档名称", "DOCUMENT NAME")).frame(maxWidth: .infinity, alignment: .leading)
                Text(lang.t("分类", "CATEGORY")).frame(width: 130, alignment: .leading)
                Text(lang.t("向量状态", "VECTOR STATUS")).frame(width: 130, alignment: .leading)
                Text(lang.t("日期", "DATE")).frame(width: 100, alignment: .trailing)
            }
            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
            .padding(.horizontal, Spacing.lg)

            SeparatedList(documents) { doc in
                DocumentRow(document: doc, onDelete: {
                    if let apiDoc = dataStore.apiDocuments.first(where: { $0.name == doc.name }) {
                        Task { await dataStore.deleteDocument(apiId: apiDoc.id) }
                    }
                })
            }
        }
    }

    // MARK: - Right panel

    private var rightPanel: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text(lang.t("知识库概览", "KNOWLEDGE BASE INSIGHTS"))
                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.6)

            CardContainer {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(lang.t("文档数", "DOCUMENTS")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                    let docCount = dataStore.apiDocuments.isEmpty ? dataStore.documents.count : dataStore.apiDocuments.count
                    Text("\(docCount)").font(TextStyle.headlineMD).foregroundColor(.onSurface)
                    let syncedCount = dataStore.apiDocuments.filter { $0.vectorStatus == "synced" }.count
                    Text(lang.t("\(syncedCount) 份已向量化", "\(syncedCount) vectorized"))
                        .font(TextStyle.labelSM).foregroundColor(.statusActive)
                }
                .padding(Spacing.lg)
            }

            CardContainer {
                VStack(alignment: .leading, spacing: 4) {
                    Text(lang.t("向量总数", "TOTAL VECTORS")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                    let totalVectors = dataStore.apiDocuments.isEmpty
                        ? 0
                        : dataStore.apiDocuments.reduce(0) { $0 + $1.chunkCount }
                    Text(totalVectors == 0 ? "–" : "\(totalVectors)")
                        .font(TextStyle.headlineMD).foregroundColor(.onSurface)
                    Text(lang.t("\(dataStore.apiDocuments.count) 份文档已索引", "\(dataStore.apiDocuments.count) documents indexed"))
                        .font(TextStyle.labelSM).foregroundColor(.statusActive)
                }
                .padding(Spacing.lg)
            }

            VStack(alignment: .leading, spacing: Spacing.sm) {
                Text(lang.t("RAG 过滤器", "ACTIVE RAG FILTERS")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                HStack(spacing: Spacing.xs) {
                    ForEach(activeFilters, id: \.self) { filter in
                        HStack(spacing: 4) {
                            Text(filter).font(TextStyle.labelSM).foregroundColor(.primary500)
                            Button {
                            activeFilters.removeAll { $0 == filter }
                            UserDefaults.standard.set(activeFilters, forKey: "kbActiveFilters")
                        } label: {
                                Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundColor(.primary500)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, Spacing.sm).padding(.vertical, 4)
                        .background(Color.primaryFixed)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.pill))
                    }
                }
                Button(lang.t("+ 添加全局过滤器", "+ ADD GLOBAL FILTER")) {
                    newFilterText = ""
                    showFilterInput = true
                }
                .buttonStyle(.plain)
                .font(TextStyle.labelSM).foregroundColor(.primary500)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
                .background(Color.primaryFixed.opacity(0.5))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                .popover(isPresented: $showFilterInput, arrowEdge: .bottom) {
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        Text(lang.t("添加过滤器", "Add Filter"))
                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                        TextField(lang.t("过滤器名称", "Filter name"), text: $newFilterText)
                            .textFieldStyle(.plain).font(TextStyle.bodyMD)
                            .padding(Spacing.sm)
                            .background(Color.surfaceContainerHighest)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                            .onSubmit { addFilter() }
                        HStack {
                            SecondaryButton(lang.t("取消", "Cancel")) { showFilterInput = false }
                            PrimaryButton(lang.t("添加", "Add"), icon: "plus") { addFilter() }
                                .disabled(newFilterText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                    .padding(Spacing.lg)
                    .frame(width: 220)
                    .background(Color.surfaceContainerLowest)
                }
            }

            Spacer()

            HStack(spacing: Spacing.sm) {
                Circle().fill(Color.statusActive).frame(width: 7, height: 7)
                Text(lang.t("索引引擎在线", "Indexing Engine Online")).font(TextStyle.labelSM).foregroundColor(.onSurface)
            }
            Text(lang.t("系统持续优化向量嵌入。", "System continuously optimizing embeddings."))
                .font(.system(size: 11)).foregroundColor(.onSurfaceVariant)
        }
        .padding(Spacing.xl)
        .frame(width: Layout.rightPanelWidth)
        .background(.surfaceContainerLowest)
    }

    // MARK: - Filter helper

    private func addFilter() {
        let f = newFilterText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !f.isEmpty, !activeFilters.contains(f) else { showFilterInput = false; return }
        activeFilters.append(f)
        UserDefaults.standard.set(activeFilters, forKey: "kbActiveFilters")
        showFilterInput = false
    }

    // MARK: - Upload handler

    private func handleImport(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let err):
            uploadError = err.localizedDescription
        case .success(let urls):
            uploadError = nil
            isUploading = true
            Task {
                for url in urls {
                    guard url.startAccessingSecurityScopedResource() else { continue }
                    defer { url.stopAccessingSecurityScopedResource() }
                    _ = await dataStore.uploadKnowledgeDocument(fileURL: url)
                }
                isUploading = false
            }
        }
    }
}

// MARK: - Document Row
struct DocumentRow: View {
    let document: KnowledgeDocument
    var onDelete: () -> Void = {}
    @Environment(\.appLanguage) var lang
    @State private var isHovered = false
    @State private var confirmDelete = false

    var body: some View {
        HStack {
            HStack(spacing: Spacing.sm) {
                Image(systemName: document.fileType.fileTypeIconName)
                    .foregroundColor(document.fileType.fileTypeIconColor)
                    .font(.system(size: 14))
                Text(document.name).font(TextStyle.bodyMD).foregroundColor(.onSurface).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                let parts = document.category.split(separator: " ").map(String.init)
                TagView(label: parts.first ?? document.category, style: .deepTask)
                if parts.count > 1 { TagView(label: parts[1], style: .quickTool) }
            }
            .frame(width: 130, alignment: .leading)

            VStack(alignment: .leading, spacing: 4) {
                switch document.vectorStatus {
                case .synced:
                    Text(lang.t("已同步 100%", "Synced 100%")).font(TextStyle.labelSM).foregroundColor(.statusActive)
                case .processing:
                    VStack(alignment: .leading, spacing: 3) {
                        Text(lang.t("处理中 \(Int(document.vectorProgress * 100))%", "Processing \(Int(document.vectorProgress * 100))%"))
                            .font(TextStyle.labelSM).foregroundColor(.statusOnHold)
                        ProgressBar(progress: document.vectorProgress, height: 4, color: .statusOnHold)
                    }
                case .failed:
                    Text(lang.t("失败", "Failed")).font(TextStyle.labelSM).foregroundColor(.statusFailed)
                }
            }
            .frame(width: 130, alignment: .leading)

            HStack(spacing: Spacing.sm) {
                Text(document.date).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                    .frame(width: 80, alignment: .trailing)
                if isHovered {
                    Button { confirmDelete = true } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 12))
                            .foregroundColor(.statusFailed.opacity(0.7))
                    }
                    .buttonStyle(.plain)
                    .frame(width: 20)
                } else {
                    Spacer().frame(width: 20)
                }
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .background(isHovered ? Color.surfaceContainerHigh.opacity(0.4) : Color.clear)
        .onHover { isHovered = $0 }
        .alert(lang.t("删除文档？", "Delete document?"), isPresented: $confirmDelete) {
            Button(lang.t("删除", "Delete"), role: .destructive) { onDelete() }
            Button(lang.t("取消", "Cancel"), role: .cancel) {}
        } message: {
            Text(lang.t("「\(document.name)」将从知识库中永久删除。", "\"\(document.name)\" will be permanently removed from the knowledge base."))
        }
    }
}
