import SwiftUI

struct ClientsView: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang

    @State private var selectedClientId: UUID? = nil
    @State private var searchText = ""
    @State private var showAddClient = false

    var filteredClients: [ClientRecord] {
        guard !searchText.isEmpty else { return dataStore.clients }
        return dataStore.clients.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.industry.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Page header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(lang.t("客户管理", "Client Management"))
                        .font(TextStyle.headlineMD)
                        .foregroundColor(.onSurface)
                    Text(lang.t("管理客户档案，关联项目与知识库文档", "Manage client profiles, linked projects and documents"))
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                }
                Spacer()
                Button {
                    showAddClient = true
                } label: {
                    HStack(spacing: Spacing.xs) {
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .bold))
                        Text(lang.t("新增客户", "Add Client"))
                            .font(TextStyle.labelMD)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, Spacing.lg)
                    .padding(.vertical, Spacing.sm + 2)
                    .background(Color.primary500)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, Spacing.xxl)
            .padding(.vertical, Spacing.lg)
            .background(.surfaceContainerLowest)
            .overlay(Divider(), alignment: .bottom)

            // Two-panel layout
            HStack(spacing: 0) {
                // Left: client list
                clientListPanel
                    .frame(width: 280)

                Divider()

                // Right: detail
                if let selectedId = selectedClientId,
                   let client = dataStore.clients.first(where: { $0.id == selectedId }) {
                    ClientDetailView(client: client)
                } else {
                    emptyState
                }
            }
        }
        .sheet(isPresented: $showAddClient) {
            AddClientSheet(isPresented: $showAddClient)
        }
        .task {
            await dataStore.loadClients()
            if selectedClientId == nil {
                selectedClientId = dataStore.clients.first?.id
            }
        }
        .onChange(of: dataStore.clients.count) { _, _ in
            if selectedClientId == nil {
                selectedClientId = dataStore.clients.first?.id
            }
        }
    }

    // MARK: - Left Panel

    private var clientListPanel: some View {
        VStack(spacing: 0) {
            // Search
            HStack(spacing: Spacing.sm) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13))
                    .foregroundColor(.onSurfaceVariant)
                TextField(lang.t("搜索客户…", "Search clients…"), text: $searchText)
                    .textFieldStyle(.plain)
                    .font(TextStyle.bodySM)
            }
            .padding(Spacing.md)
            .background(Color.surfaceContainerHighest)
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            .padding(Spacing.md)

            if filteredClients.isEmpty {
                Spacer()
                Text(dataStore.clients.isEmpty
                     ? lang.t("暂无客户，点击右上角添加", "No clients yet — click Add Client")
                     : lang.t("无匹配结果", "No results"))
                    .font(TextStyle.bodySM)
                    .foregroundColor(.onSurfaceVariant)
                    .multilineTextAlignment(.center)
                    .padding()
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(filteredClients) { client in
                            clientRow(client)
                        }
                    }
                    .padding(.horizontal, Spacing.sm)
                    .padding(.bottom, Spacing.lg)
                }
            }
        }
        .background(.surfaceContainerLowest)
    }

    @ViewBuilder
    private func clientRow(_ client: ClientRecord) -> some View {
        let isSelected = selectedClientId == client.id
        Button {
            selectedClientId = client.id
        } label: {
            HStack(spacing: Spacing.md) {
                // Avatar
                ZStack {
                    Circle()
                        .fill(Color.primary500.opacity(0.12))
                        .frame(width: 36, height: 36)
                    Text(String(client.name.prefix(2)).uppercased())
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.primary500)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(client.name)
                        .font(TextStyle.titleSM)
                        .foregroundColor(.onSurface)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        if !client.industry.isEmpty {
                            Text(client.industry)
                                .font(TextStyle.labelSM)
                                .foregroundColor(.onSurfaceVariant)
                                .lineLimit(1)
                        }
                        if client.documentCount > 0 {
                            Text("·")
                                .font(TextStyle.labelSM)
                                .foregroundColor(.onSurfaceVariant)
                            Text(lang.t("\(client.documentCount) 份文档", "\(client.documentCount) docs"))
                                .font(TextStyle.labelSM)
                                .foregroundColor(.onSurfaceVariant)
                        }
                    }
                }
                Spacer()
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm + 2)
            .background(isSelected ? Color.primaryFixed : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: Spacing.lg) {
            Image(systemName: "person.2")
                .font(.system(size: 40, weight: .light))
                .foregroundColor(.onSurfaceVariant.opacity(0.4))
            Text(lang.t("选择左侧客户查看详情", "Select a client to view details"))
                .font(TextStyle.bodyMD)
                .foregroundColor(.onSurfaceVariant)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.surfaceBase)
    }
}

// MARK: - Client Detail

struct ClientDetailView: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang

    let client: ClientRecord

    @State private var isEditing = false
    @State private var showLinkDocs = false
    @State private var linkedDocs: [APIKnowledgeDocument] = []
    @State private var isDeleting = false

    // edit fields
    @State private var editName = ""
    @State private var editIndustry = ""
    @State private var editContact = ""
    @State private var editNotes = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {

                // Header card
                CardContainer {
                    HStack(alignment: .top, spacing: Spacing.lg) {
                        ZStack {
                            Circle()
                                .fill(Color.primary500.opacity(0.12))
                                .frame(width: 56, height: 56)
                            Text(String(client.name.prefix(2)).uppercased())
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundColor(.primary500)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            if isEditing {
                                TextField(lang.t("客户名称", "Client name"), text: $editName)
                                    .textFieldStyle(.plain)
                                    .font(TextStyle.titleMD)
                            } else {
                                Text(client.name)
                                    .font(TextStyle.titleMD)
                                    .foregroundColor(.onSurface)
                            }
                            if isEditing {
                                TextField(lang.t("行业", "Industry"), text: $editIndustry)
                                    .textFieldStyle(.plain)
                                    .font(TextStyle.bodySM)
                                    .foregroundColor(.onSurfaceVariant)
                            } else if !client.industry.isEmpty {
                                Text(client.industry)
                                    .font(TextStyle.bodySM)
                                    .foregroundColor(.onSurfaceVariant)
                            }
                        }

                        Spacer()

                        HStack(spacing: Spacing.sm) {
                            if isEditing {
                                SecondaryButton(lang.t("取消", "Cancel"), icon: "xmark") {
                                    isEditing = false
                                }
                                PrimaryButton(lang.t("保存", "Save"), icon: "checkmark") {
                                    Task {
                                        await dataStore.updateClient(
                                            apiId: client.apiId,
                                            name: editName,
                                            industry: editIndustry,
                                            contact: editContact,
                                            notes: editNotes
                                        )
                                        isEditing = false
                                    }
                                }
                            } else {
                                SecondaryButton(lang.t("编辑", "Edit"), icon: "pencil") {
                                    editName = client.name
                                    editIndustry = client.industry
                                    editContact = client.contact
                                    editNotes = client.notes
                                    isEditing = true
                                }
                                Button {
                                    isDeleting = true
                                } label: {
                                    Image(systemName: "trash")
                                        .font(.system(size: 13))
                                        .foregroundColor(.statusFailed)
                                        .padding(Spacing.sm)
                                        .background(Color.statusFailed.opacity(0.08))
                                        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                                }
                                .buttonStyle(.plain)
                                .confirmationDialog(
                                    lang.t("确认删除客户「\(client.name)」？此操作无法撤销。",
                                           "Delete client \"\(client.name)\"? This cannot be undone."),
                                    isPresented: $isDeleting,
                                    titleVisibility: .visible
                                ) {
                                    Button(lang.t("删除", "Delete"), role: .destructive) {
                                        Task { await dataStore.deleteClient(apiId: client.apiId) }
                                    }
                                }
                            }
                        }
                    }
                    .padding(Spacing.xl)
                }

                // Contact & Notes
                if isEditing || !client.contact.isEmpty || !client.notes.isEmpty {
                    CardContainer {
                        VStack(alignment: .leading, spacing: Spacing.lg) {
                            sectionHeader(lang.t("联系人 & 备注", "Contact & Notes"), icon: "person.text.rectangle")

                            if isEditing {
                                detailField(lang.t("联系人", "Contact"), text: $editContact)
                                detailField(lang.t("备注", "Notes"), text: $editNotes)
                            } else {
                                if !client.contact.isEmpty {
                                    infoRow(lang.t("联系人", "Contact"), value: client.contact)
                                }
                                if !client.notes.isEmpty {
                                    infoRow(lang.t("备注", "Notes"), value: client.notes)
                                }
                            }
                        }
                        .padding(Spacing.xl)
                    }
                }

                // Projects
                if !client.projectNames.isEmpty {
                    CardContainer {
                        VStack(alignment: .leading, spacing: Spacing.lg) {
                            sectionHeader(lang.t("关联项目", "Linked Projects"), icon: "folder")
                            ForEach(client.projectNames, id: \.self) { name in
                                HStack(spacing: Spacing.sm) {
                                    Image(systemName: "folder.fill")
                                        .font(.system(size: 12))
                                        .foregroundColor(.primary500)
                                    Text(name)
                                        .font(TextStyle.bodyMD)
                                        .foregroundColor(.onSurface)
                                    Spacer()
                                }
                                .padding(.vertical, 2)
                            }
                        }
                        .padding(Spacing.xl)
                    }
                }

                // Documents
                CardContainer {
                    VStack(alignment: .leading, spacing: Spacing.lg) {
                        HStack {
                            sectionHeader(lang.t("关联文档", "Linked Documents"), icon: "doc.text")
                            Spacer()
                            Button {
                                showLinkDocs = true
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "plus")
                                        .font(.system(size: 11, weight: .bold))
                                    Text(lang.t("关联", "Link"))
                                        .font(TextStyle.labelSM)
                                }
                                .foregroundColor(.primary500)
                                .padding(.horizontal, Spacing.sm)
                                .padding(.vertical, 4)
                                .background(Color.primary500.opacity(0.08))
                                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                            }
                            .buttonStyle(.plain)
                        }

                        if linkedDocs.isEmpty {
                            Text(lang.t("暂无关联文档", "No linked documents"))
                                .font(TextStyle.bodySM)
                                .foregroundColor(.onSurfaceVariant)
                        } else {
                            ForEach(linkedDocs) { doc in
                                HStack(spacing: Spacing.sm) {
                                    Image(systemName: doc.fileType.uppercased().fileTypeIconName)
                                        .font(.system(size: 12))
                                        .foregroundColor(doc.fileType.uppercased().fileTypeIconColor)
                                    Text(doc.name)
                                        .font(TextStyle.bodyMD)
                                        .foregroundColor(.onSurface)
                                        .lineLimit(1)
                                    Spacer()
                                    Button {
                                        Task {
                                            await dataStore.unlinkDocument(clientApiId: client.apiId, docApiId: doc.id)
                                            linkedDocs = await dataStore.loadClientDocuments(clientApiId: client.apiId)
                                        }
                                    } label: {
                                        Image(systemName: "xmark")
                                            .font(.system(size: 10, weight: .bold))
                                            .foregroundColor(.onSurfaceVariant)
                                    }
                                    .buttonStyle(.plain)
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                    .padding(Spacing.xl)
                }
            }
            .padding(Spacing.xxl)
        }
        .background(.surfaceBase)
        .sheet(isPresented: $showLinkDocs) {
            LinkDocumentsSheet(
                isPresented: $showLinkDocs,
                clientApiId: client.apiId,
                linkedDocIds: Set(linkedDocs.map { $0.id })
            ) {
                Task {
                    linkedDocs = await dataStore.loadClientDocuments(clientApiId: client.apiId)
                }
            }
        }
        .task(id: client.apiId) {
            linkedDocs = await dataStore.loadClientDocuments(clientApiId: client.apiId)
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func sectionHeader(_ title: String, icon: String) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.primary500)
            Text(title)
                .font(TextStyle.titleSM)
                .foregroundColor(.onSurface)
        }
    }

    @ViewBuilder
    private func infoRow(_ label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.md) {
            Text(label)
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
                .frame(width: 60, alignment: .leading)
            Text(value)
                .font(TextStyle.bodyMD)
                .foregroundColor(.onSurface)
            Spacer()
        }
    }

    @ViewBuilder
    private func detailField(_ label: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
            TextField(label, text: text)
                .textFieldStyle(.plain)
                .font(TextStyle.bodyMD)
                .padding(Spacing.sm)
                .background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
        }
    }
}

// MARK: - Add Client Sheet

struct AddClientSheet: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @Binding var isPresented: Bool

    @State private var name = ""
    @State private var industry = ""
    @State private var contact = ""
    @State private var notes = ""
    @State private var isSaving = false

    // AI fill state
    @State private var aiQuery = ""
    @State private var isAILoading = false
    @State private var suggestions: [APIClientSuggestion] = []
    @State private var showSuggestions = false
    @State private var aiError: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            // Header
            HStack {
                Text(lang.t("新增客户", "Add Client"))
                    .font(TextStyle.headlineSM)
                    .foregroundColor(.onSurface)
                Spacer()
                // AI Fill button
                Button {
                    aiQuery = name.isEmpty ? "" : name
                    showSuggestions = false
                    suggestions = []
                    aiError = nil
                    // trigger fill inline
                    if !aiQuery.isEmpty { runAISuggest() }
                } label: {
                    HStack(spacing: 4) {
                        if isAILoading {
                            ProgressView()
                                .scaleEffect(0.7)
                                .frame(width: 14, height: 14)
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
                .disabled(isAILoading)
            }

            // AI query field — only shown if name is empty
            if name.isEmpty && !isAILoading && suggestions.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(lang.t("输入公司名称后点击「AI 填写」，AI 将自动补全信息",
                                "Enter a company name and tap \"AI Fill\" — AI will complete the profile"))
                        .font(TextStyle.labelSM)
                        .foregroundColor(.onSurfaceVariant)
                }
            }

            // Suggestion picker (if multiple returned)
            if showSuggestions && suggestions.count > 1 {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text(lang.t("找到多个匹配，请选择或继续修改：", "Multiple matches found — pick one or edit below:"))
                        .font(TextStyle.labelSM)
                        .foregroundColor(.onSurfaceVariant)
                    ForEach(suggestions.indices, id: \.self) { i in
                        suggestionCard(suggestions[i], index: i)
                    }
                }
                .padding(Spacing.md)
                .background(Color.primary500.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.md)
                        .stroke(Color.primary500.opacity(0.2), lineWidth: 1)
                )
            }

            if let err = aiError {
                Text(err)
                    .font(TextStyle.labelSM)
                    .foregroundColor(.statusFailed)
            }

            // Form fields
            sheetField(lang.t("客户名称 *", "Client Name *"), text: $name, placeholder: lang.t("例如：华为技术", "e.g. Acme Corp"))
            sheetField(lang.t("行业", "Industry"), text: $industry, placeholder: lang.t("例如：科技、金融…", "e.g. Technology, Finance…"))
            sheetField(lang.t("联系人", "Contact"), text: $contact, placeholder: lang.t("联系人姓名", "Contact person name"))
            sheetField(lang.t("备注", "Notes"), text: $notes, placeholder: lang.t("其他备注信息", "Additional notes"))

            HStack(spacing: Spacing.md) {
                SecondaryButton(lang.t("取消", "Cancel"), icon: "xmark") {
                    isPresented = false
                }
                PrimaryButton(isSaving ? lang.t("保存中…", "Saving…") : lang.t("添加", "Add"), icon: "plus") {
                    isSaving = true
                    Task {
                        await dataStore.createClient(name: name, industry: industry, contact: contact, notes: notes)
                        isSaving = false
                        isPresented = false
                    }
                }
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
            }
        }
        .padding(Spacing.xxl)
        .frame(width: 480)
    }

    // MARK: - AI

    private func runAISuggest() {
        let query = aiQuery.isEmpty ? name : aiQuery
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        isAILoading = true
        aiError = nil
        Task {
            let results = await dataStore.suggestClient(query: query)
            isAILoading = false
            if results.isEmpty {
                aiError = lang.t("AI 未返回结果，请手动填写", "AI returned no results — fill manually")
            } else if results.count == 1 {
                applysuggestion(results[0])
                showSuggestions = false
            } else {
                suggestions = results
                showSuggestions = true
                // Auto-fill with first suggestion
                applysuggestion(results[0])
            }
        }
    }

    private func applysuggestion(_ s: APIClientSuggestion) {
        name = s.name
        industry = s.industry
        contact = s.contact
        notes = s.notes
    }

    // MARK: - Subviews

    @ViewBuilder
    private func suggestionCard(_ s: APIClientSuggestion, index: Int) -> some View {
        Button {
            applysuggestion(s)
            showSuggestions = false
        } label: {
            HStack(spacing: Spacing.md) {
                ZStack {
                    Circle()
                        .fill(Color.primary500.opacity(0.12))
                        .frame(width: 28, height: 28)
                    Text(String(s.name.prefix(2)).uppercased())
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.primary500)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.name)
                        .font(TextStyle.titleSM)
                        .foregroundColor(.onSurface)
                    Text(s.industry)
                        .font(TextStyle.labelSM)
                        .foregroundColor(.onSurfaceVariant)
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
    private func sheetField(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .font(TextStyle.bodyMD)
                .padding(Spacing.md)
                .background(Color.surfaceContainerHighest)
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
    }
}

// MARK: - Link Documents Sheet

struct LinkDocumentsSheet: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @Binding var isPresented: Bool

    let clientApiId: Int
    let linkedDocIds: Set<Int>
    let onDone: () -> Void

    @State private var pendingLink: Set<Int> = []
    @State private var pendingUnlink: Set<Int> = []
    @State private var isSaving = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            Text(lang.t("关联知识库文档", "Link Knowledge Base Documents"))
                .font(TextStyle.headlineSM)
                .foregroundColor(.onSurface)

            Text(lang.t("选择要关联到此客户的文档", "Select documents to link to this client"))
                .font(TextStyle.bodySM)
                .foregroundColor(.onSurfaceVariant)

            if dataStore.apiDocuments.isEmpty {
                Text(lang.t("知识库暂无文档", "No documents in knowledge base"))
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurfaceVariant)
                    .frame(maxWidth: .infinity)
                    .padding(Spacing.xxl)
            } else {
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(dataStore.apiDocuments) { doc in
                            docRow(doc)
                        }
                    }
                }
                .frame(maxHeight: 320)
            }

            HStack(spacing: Spacing.md) {
                SecondaryButton(lang.t("取消", "Cancel"), icon: "xmark") {
                    isPresented = false
                }
                PrimaryButton(isSaving ? lang.t("保存中…", "Saving…") : lang.t("确认", "Confirm"), icon: "checkmark") {
                    isSaving = true
                    Task {
                        for id in pendingLink {
                            await dataStore.linkDocument(clientApiId: clientApiId, docApiId: id)
                        }
                        for id in pendingUnlink {
                            await dataStore.unlinkDocument(clientApiId: clientApiId, docApiId: id)
                        }
                        isSaving = false
                        onDone()
                        isPresented = false
                    }
                }
                .disabled((pendingLink.isEmpty && pendingUnlink.isEmpty) || isSaving)
            }
        }
        .padding(Spacing.xxl)
        .frame(width: 500)
        .onAppear {
            pendingLink = []
            pendingUnlink = []
        }
    }

    @ViewBuilder
    private func docRow(_ doc: APIKnowledgeDocument) -> some View {
        let isLinked = linkedDocIds.contains(doc.id) || pendingLink.contains(doc.id)
        let willUnlink = pendingUnlink.contains(doc.id)
        let effectiveLinked = isLinked && !willUnlink

        Button {
            if effectiveLinked {
                if linkedDocIds.contains(doc.id) {
                    pendingUnlink.insert(doc.id)
                    pendingLink.remove(doc.id)
                } else {
                    pendingLink.remove(doc.id)
                }
            } else {
                if pendingUnlink.contains(doc.id) {
                    pendingUnlink.remove(doc.id)
                } else {
                    pendingLink.insert(doc.id)
                }
            }
        } label: {
            HStack(spacing: Spacing.md) {
                Image(systemName: effectiveLinked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 16))
                    .foregroundColor(effectiveLinked ? .primary500 : .onSurfaceVariant)

                Image(systemName: doc.fileType.uppercased().fileTypeIconName)
                    .font(.system(size: 12))
                    .foregroundColor(doc.fileType.uppercased().fileTypeIconColor)

                Text(doc.name)
                    .font(TextStyle.bodyMD)
                    .foregroundColor(.onSurface)
                    .lineLimit(1)

                Spacer()

                Text(doc.category)
                    .font(TextStyle.labelSM)
                    .foregroundColor(.onSurfaceVariant)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.vertical, Spacing.sm + 2)
            .background(effectiveLinked ? Color.primaryFixed : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
    }
}
