import Foundation
import SwiftUI

/// Central live-data store — fetches from FastAPI, publishes to views.
@MainActor
final class DataStore: ObservableObject {

    // MARK: Published state
    @Published var projects: [Project] = []
    @Published var conversations: [APIConversation] = []
    @Published var skills: [Skill] = []
    @Published var documents: [KnowledgeDocument] = []
    @Published var scheduledTasks: [ScheduledTask] = []
    @Published var templates: [Template] = []
    @Published var clients: [ClientRecord] = []
    @Published var apiKeyConfigured: Bool = false

    // Raw API models (needed for IDs when calling follow-up endpoints)
    @Published var apiProjects: [APIProject] = []
    @Published var apiSkills: [APISkill] = []
    @Published var apiDocuments: [APIKnowledgeDocument] = []
    @Published var apiSchedules: [APIScheduledTask] = []
    @Published var apiTemplates: [APITemplate] = []
    @Published var apiClients: [APIClientRecord] = []

    @Published var isLoading: Bool = false
    @Published var error: String? = nil

    // Message cache: conversationId → messages (for instant re-open)
    private var messageCache: [Int: [APIMessage]] = [:]
    // Whether there are older messages not yet loaded
    var hasMoreMessages: [Int: Bool] = [:]

    // MARK: - Bootstrap

    func loadAll() async {
        isLoading = true
        error = nil
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadProjects() }
            group.addTask { await self.loadConversations() }
            group.addTask { await self.loadSkills() }
            group.addTask { await self.loadDocuments() }
            group.addTask { await self.loadSchedules() }
            group.addTask { await self.loadTemplates() }
            group.addTask { await self.loadClients() }
            group.addTask { await self.checkApiKey() }
        }
        isLoading = false
    }

    // MARK: - Projects

    func loadProjects() async {
        do {
            let raw: [APIProject] = try await APIClient.shared.get("/projects")
            print("[DEBUG] Loaded \(raw.count) projects")
            for p in raw {
                print("[DEBUG] Project id=\(p.id), name='\(p.name)', contextSummary length=\(p.contextSummary.count)")
            }
            apiProjects = raw
            projects = raw.map { $0.toLocal() }
        } catch {
            print("[DEBUG] loadProjects error: \(error)")
            self.error = error.localizedDescription
        }
    }

    @discardableResult
    func createProject(name: String, client: String, description: String = "", status: String = "lead") async -> Bool {
        struct Body: Encodable { let name, client, description, status: String }
        do {
            let new: APIProject = try await APIClient.shared.post(
                "/projects",
                body: Body(name: name, client: client, description: description, status: status)
            )
            apiProjects.append(new)
            projects = apiProjects.map { $0.toLocal() }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func updateProjectStatus(apiId: Int, status: String) async {
        struct Body: Encodable { let status: String }
        do {
            let updated: APIProject = try await APIClient.shared.patch("/projects/\(apiId)", body: Body(status: status))
            if let idx = apiProjects.firstIndex(where: { $0.id == apiId }) {
                apiProjects[idx] = updated
                projects = apiProjects.map { $0.toLocal() }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteProject(apiId: Int) async {
        do {
            try await APIClient.shared.delete("/projects/\(apiId)")
            apiProjects.removeAll { $0.id == apiId }
            projects = apiProjects.map { $0.toLocal() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Conversations

    func loadConversations(projectId: Int? = nil) async {
        var path = "/chat/conversations"
        if let pid = projectId { path += "?project_id=\(pid)" }
        do {
            conversations = try await APIClient.shared.get(path)
            // Prefetch messages for the first 8 conversations so clicks are instant
            let ids = conversations.prefix(8).map { $0.id }
            Task { await prefetchMessages(ids: ids) }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Fetch conversations for a specific project without touching the global `conversations` array.
    func fetchProjectConversations(projectId: Int) async -> [APIConversation] {
        do {
            let result: [APIConversation] = try await APIClient.shared.get("/chat/conversations?project_id=\(projectId)")
            let ids = result.prefix(8).map { $0.id }
            Task { await prefetchMessages(ids: ids) }
            return result
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    /// Concurrently warms the message cache for the given conversation IDs.
    private func prefetchMessages(ids: [Int]) async {
        let missing = ids.filter { messageCache[$0] == nil }
        guard !missing.isEmpty else { return }
        await withTaskGroup(of: Void.self) { group in
            for id in missing {
                group.addTask { _ = await self.loadMessages(conversationId: id) }
            }
        }
    }

    /// Create optimistic conversation for instant UI feedback (returns immediately)
    func createOptimisticConversation(projectId: Int? = nil, skillId: Int? = nil) -> APIConversation {
        let tempId = -Int.random(in: 1000...9999)
        let conv = APIConversation(
            id: tempId,
            title: "New Workstream",
            projectId: projectId,
            skillId: skillId,
            createdAt: Date(),
            updatedAt: Date()
        )
        conversations.insert(conv, at: 0)
        return conv
    }
    
    /// Finalize optimistic conversation with API call
    func finalizeConversation(tempId: Int, projectId: Int? = nil, skillId: Int? = nil) async -> APIConversation? {
        var query: [String: String] = [:]
        if let p = projectId { query["project_id"] = "\(p)" }
        if let s = skillId { query["skill_id"] = "\(s)" }
        
        do {
            let conv: APIConversation = try await APIClient.shared.post("/chat/conversations", query: query)
            if let idx = conversations.firstIndex(where: { $0.id == tempId }) {
                conversations[idx] = conv
            }
            return conv
        } catch {
            conversations.removeAll { $0.id == tempId }
            self.error = error.localizedDescription
            return nil
        }
    }
    
    /// Legacy method: Create conversation with optimistic update (for other callers)
    func createConversation(projectId: Int? = nil, skillId: Int? = nil) async -> APIConversation? {
        let tempConv = createOptimisticConversation(projectId: projectId, skillId: skillId)
        return await finalizeConversation(tempId: tempConv.id, projectId: projectId, skillId: skillId)
    }

    func deleteConversation(id: Int) async {
        // Optimistic: remove locally first for instant UI response
        let removed = conversations.first { $0.id == id }
        conversations.removeAll { $0.id == id }
        messageCache.removeValue(forKey: id)
        do {
            try await APIClient.shared.delete("/chat/conversations/\(id)")
        } catch {
            // Restore on failure
            if let conv = removed { conversations.insert(conv, at: 0) }
            self.error = error.localizedDescription
        }
    }

    func cachedMessages(conversationId: Int) -> [APIMessage]? {
        messageCache[conversationId]
    }

    private let pageSize = 30

    func loadMessages(conversationId: Int) async -> [APIMessage] {
        do {
            let msgs: [APIMessage] = try await APIClient.shared.get(
                "/chat/conversations/\(conversationId)/messages",
                query: ["limit": "\(pageSize)"]
            )
            messageCache[conversationId] = msgs
            hasMoreMessages[conversationId] = msgs.count >= pageSize
            return msgs
        } catch {
            self.error = error.localizedDescription
            return messageCache[conversationId] ?? []
        }
    }

    /// Load older messages before the current oldest. Returns the prepended slice.
    func loadMoreMessages(conversationId: Int) async -> [APIMessage] {
        let oldest = messageCache[conversationId]?.first
        var query: [String: String] = ["limit": "\(pageSize)"]
        if let oldestId = oldest?.id {
            query["before_id"] = "\(oldestId)"
        }
        do {
            let older: [APIMessage] = try await APIClient.shared.get(
                "/chat/conversations/\(conversationId)/messages",
                query: query
            )
            if older.isEmpty {
                hasMoreMessages[conversationId] = false
                return []
            }
            let existing = messageCache[conversationId] ?? []
            messageCache[conversationId] = older + existing
            hasMoreMessages[conversationId] = older.count >= pageSize
            return older
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    func cacheMessages(_ msgs: [APIMessage], conversationId: Int) {
        messageCache[conversationId] = msgs
    }

    // MARK: - Skills

    func loadSkills() async {
        do {
            // Run seed/migrate in parallel, then fetch final list once
            struct Empty: Decodable {}
            struct SeedResult: Decodable { let count: Int }
            struct MigrateResult: Decodable { let updated: Int }
            async let _seed: SeedResult = APIClient.shared.post("/skills/seed-pro", body: EmptyBody())
            async let _migrate: MigrateResult = APIClient.shared.post("/skills/migrate-categories", body: EmptyBody())
            _ = try await (_seed, _migrate)
            let all: [APISkill] = try await APIClient.shared.get("/skills")
            apiSkills = all
            skills = all.map { $0.toLocal() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createSkill(name: String, category: String, description: String,
                     systemPrompt: String, userTemplate: String,
                     estimatedTime: String, tools: [String]) async -> Bool {
        struct Body: Encodable {
            let name, category, description, systemPrompt, userTemplate, estimatedTime, toolsJson: String
        }
        let toolsJson = (try? String(data: JSONEncoder().encode(tools), encoding: .utf8)) ?? "[]"
        do {
            let _: APISkill = try await APIClient.shared.post("/skills", body: Body(
                name: name, category: category, description: description,
                systemPrompt: systemPrompt, userTemplate: userTemplate,
                estimatedTime: estimatedTime, toolsJson: toolsJson
            ))
            await loadSkills()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteSkill(apiId: Int) async -> Bool {
        do {
            try await APIClient.shared.delete("/skills/\(apiId)")
            await loadSkills()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // MARK: - Documents

    func loadDocuments() async {
        do {
            let raw: [APIKnowledgeDocument] = try await APIClient.shared.get("/knowledge/documents")
            apiDocuments = raw
            documents = raw.map { $0.toLocal() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func uploadKnowledgeDocument(fileURL: URL, category: String = "") async -> Bool {
        do {
            let data = try await APIClient.shared.uploadFile(
                path: "/knowledge/documents",
                fileURL: fileURL,
                extraFields: category.isEmpty ? [:] : ["category": category]
            )
            if let new = try? APIClient.shared.decoder.decode(APIKnowledgeDocument.self, from: data) {
                apiDocuments.append(new)
                documents = apiDocuments.map { $0.toLocal() }
            } else {
                await loadDocuments()
            }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func uploadProjectFile(apiProjectId: Int, fileURL: URL, folderId: Int? = nil) async -> Bool {
        do {
            var extraFields: [String: String] = [:]
            if let fid = folderId { extraFields["folder_id"] = "\(fid)" }
            _ = try await APIClient.shared.uploadFile(
                path: "/projects/\(apiProjectId)/files",
                fileURL: fileURL,
                extraFields: extraFields
            )
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func loadProjectFiles(apiProjectId: Int) async -> [APIProjectFile] {
        do {
            return try await APIClient.shared.get("/projects/\(apiProjectId)/files")
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    func loadProjectFolders(apiProjectId: Int) async -> [APIProjectFolder] {
        do {
            return try await APIClient.shared.get("/projects/\(apiProjectId)/folders")
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    // MARK: - Financials

    func loadProjectFinancials(apiProjectId: Int) async -> APIProjectFinancials? {
        do {
            return try await APIClient.shared.get("/projects/\(apiProjectId)/financials")
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func updateContractAmount(apiProjectId: Int, amount: Double) async {
        struct Body: Encodable { let contractAmount: Double }
        do {
            let updated: APIProject = try await APIClient.shared.patch(
                "/projects/\(apiProjectId)",
                body: Body(contractAmount: amount)
            )
            if let idx = apiProjects.firstIndex(where: { $0.id == apiProjectId }) {
                apiProjects[idx] = updated
                projects = apiProjects.map { $0.toLocal() }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @discardableResult
    func addProjectPayment(apiProjectId: Int, amount: Double, paymentDate: String,
                           note: String = "", paymentType: String = "received") async -> APIProjectPayment? {
        struct Body: Encodable { let amount: Double; let paymentDate: String; let note: String; let paymentType: String }
        do {
            return try await APIClient.shared.post(
                "/projects/\(apiProjectId)/financials",
                body: Body(amount: amount, paymentDate: paymentDate, note: note, paymentType: paymentType)
            )
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func deleteProjectPayment(apiProjectId: Int, paymentId: Int) async {
        do {
            try await APIClient.shared.delete("/projects/\(apiProjectId)/financials/\(paymentId)")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteProjectFile(apiProjectId: Int, fileId: Int) async {
        do {
            try await APIClient.shared.delete("/projects/\(apiProjectId)/files/\(fileId)")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadProjectMilestones(apiProjectId: Int) async -> [APIMilestone] {
        do {
            return try await APIClient.shared.get("/projects/\(apiProjectId)/milestones")
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    func createMilestone(apiProjectId: Int, title: String, priority: String = "medium", dueDate: String? = nil) async -> APIMilestone? {
        struct Body: Encodable { let title: String; let priority: String; let dueDate: String? }
        do {
            let ms: APIMilestone = try await APIClient.shared.post(
                "/projects/\(apiProjectId)/milestones",
                body: Body(title: title, priority: priority, dueDate: dueDate)
            )
            return ms
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func toggleMilestone(apiProjectId: Int, milestoneId: Int, isDone: Bool) async {
        struct Body: Encodable { let isDone: Bool }
        do {
            let _: APIMilestone = try await APIClient.shared.patch(
                "/projects/\(apiProjectId)/milestones/\(milestoneId)",
                body: Body(isDone: isDone)
            )
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteMilestone(apiProjectId: Int, milestoneId: Int) async {
        do {
            try await APIClient.shared.delete("/projects/\(apiProjectId)/milestones/\(milestoneId)")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteDocument(apiId: Int) async {
        do {
            try await APIClient.shared.delete("/knowledge/documents/\(apiId)")
            apiDocuments.removeAll { $0.id == apiId }
            documents = apiDocuments.map { $0.toLocal() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Schedules

    func loadSchedules() async {
        do {
            let raw: [APIScheduledTask] = try await APIClient.shared.get("/schedules")
            apiSchedules = raw
            scheduledTasks = raw.map { task in
                let projectName = task.projectId.flatMap { pid in apiProjects.first { $0.id == pid }?.name }
                return task.toLocal(projectName: projectName)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func toggleTask(apiId: Int, enabled: Bool) async {
        struct Body: Encodable { let isEnabled: Bool }
        do {
            let updated: APIScheduledTask = try await APIClient.shared.patch(
                "/schedules/\(apiId)",
                body: Body(isEnabled: enabled)
            )
            if let idx = apiSchedules.firstIndex(where: { $0.id == apiId }) {
                apiSchedules[idx] = updated
                let projectName = updated.projectId.flatMap { pid in apiProjects.first { $0.id == pid }?.name }
                scheduledTasks[idx] = updated.toLocal(projectName: projectName)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @discardableResult
    func createScheduledTask(name: String, prompt: String, frequency: String, projectId: Int? = nil, skillId: Int? = nil) async -> Bool {
        struct Body: Encodable { let name, prompt, frequency: String; let projectId: Int?; let skillId: Int? }
        do {
            let new: APIScheduledTask = try await APIClient.shared.post(
                "/schedules",
                body: Body(name: name, prompt: prompt, frequency: frequency, projectId: projectId, skillId: skillId)
            )
            apiSchedules.append(new)
            let projectName = new.projectId.flatMap { pid in apiProjects.first { $0.id == pid }?.name }
            scheduledTasks.append(new.toLocal(projectName: projectName))
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteScheduledTask(apiId: Int) async {
        do {
            try await APIClient.shared.delete("/schedules/\(apiId)")
            apiSchedules.removeAll { $0.id == apiId }
            scheduledTasks = apiSchedules.map { task in
                let projectName = task.projectId.flatMap { pid in apiProjects.first { $0.id == pid }?.name }
                return task.toLocal(projectName: projectName)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Clients

    func loadClients() async {
        do {
            let raw: [APIClientRecord] = try await APIClient.shared.get("/clients")
            apiClients = raw
            clients = raw.map { $0.toLocal() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @discardableResult
    func createClient(name: String, industry: String = "", contact: String = "", notes: String = "") async -> Bool {
        struct Body: Encodable { let name, industry, contact, notes: String }
        do {
            let new: APIClientRecord = try await APIClient.shared.post(
                "/clients",
                body: Body(name: name, industry: industry, contact: contact, notes: notes)
            )
            apiClients.append(new)
            clients = apiClients.map { $0.toLocal() }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    @discardableResult
    func updateClient(apiId: Int, name: String, industry: String, contact: String, notes: String) async -> Bool {
        struct Body: Encodable { let name, industry, contact, notes: String }
        do {
            let updated: APIClientRecord = try await APIClient.shared.put(
                "/clients/\(apiId)",
                body: Body(name: name, industry: industry, contact: contact, notes: notes)
            )
            if let idx = apiClients.firstIndex(where: { $0.id == apiId }) {
                apiClients[idx] = updated
                clients = apiClients.map { $0.toLocal() }
            }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteClient(apiId: Int) async {
        do {
            try await APIClient.shared.delete("/clients/\(apiId)")
            apiClients.removeAll { $0.id == apiId }
            clients = apiClients.map { $0.toLocal() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func linkDocument(clientApiId: Int, docApiId: Int) async {
        do {
            try await APIClient.shared.post("/clients/\(clientApiId)/documents/\(docApiId)", body: EmptyBody())
            // Update doc's clientId locally, refresh only the affected client
            if let dIdx = apiDocuments.firstIndex(where: { $0.id == docApiId }) {
                apiDocuments[dIdx].clientId = clientApiId
                documents = apiDocuments.map { $0.toLocal() }
            }
            if let cIdx = apiClients.firstIndex(where: { $0.id == clientApiId }) {
                apiClients[cIdx].documentCount += 1
                clients = apiClients.map { $0.toLocal() }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func unlinkDocument(clientApiId: Int, docApiId: Int) async {
        do {
            try await APIClient.shared.delete("/clients/\(clientApiId)/documents/\(docApiId)")
            if let dIdx = apiDocuments.firstIndex(where: { $0.id == docApiId }) {
                apiDocuments[dIdx].clientId = nil
                documents = apiDocuments.map { $0.toLocal() }
            }
            if let cIdx = apiClients.firstIndex(where: { $0.id == clientApiId }) {
                apiClients[cIdx].documentCount = max(0, apiClients[cIdx].documentCount - 1)
                clients = apiClients.map { $0.toLocal() }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadClientDocuments(clientApiId: Int) async -> [APIKnowledgeDocument] {
        do {
            return try await APIClient.shared.get("/clients/\(clientApiId)/documents")
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    func suggestProject(query: String, clientName: String = "", clientIndustry: String = "") async -> [APIProjectSuggestion] {
        struct Body: Encodable { let query, clientName, clientIndustry: String }
        do {
            return try await APIClient.shared.post(
                "/projects/ai-suggest",
                body: Body(query: query, clientName: clientName, clientIndustry: clientIndustry)
            )
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    func suggestClient(query: String) async -> [APIClientSuggestion] {
        struct Body: Encodable { let query: String }
        do {
            return try await APIClient.shared.post("/clients/ai-suggest", body: Body(query: query))
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    // MARK: - Templates

    func loadTemplates() async {
        do {
            let raw: [APITemplate] = try await APIClient.shared.get("/templates")
            apiTemplates = raw
            templates = raw.map { $0.toLocal() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func uploadTemplate(fileURL: URL, category: String = "") async -> Bool {
        do {
            let data = try await APIClient.shared.uploadFile(
                path: "/templates",
                fileURL: fileURL,
                extraFields: category.isEmpty ? [:] : ["category": category]
            )
            if let new = try? APIClient.shared.decoder.decode(APITemplate.self, from: data) {
                apiTemplates.append(new)
                templates = apiTemplates.map { $0.toLocal() }
            } else {
                await loadTemplates()
            }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteTemplate(apiId: Int) async {
        do {
            try await APIClient.shared.delete("/templates/\(apiId)")
            apiTemplates.removeAll { $0.id == apiId }
            templates = apiTemplates.map { $0.toLocal() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Settings / API Key

    func checkApiKey() async {
        do {
            let status: APIKeyStatus = try await APIClient.shared.get("/settings/api-key-status")
            apiKeyConfigured = status.configured
        } catch {
            apiKeyConfigured = false
        }
    }

    func saveApiKey(_ key: String) async -> Bool {
        struct Body: Encodable { let apiKey: String }
        do {
            try await APIClient.shared.post("/settings/api-key", body: Body(apiKey: key))
            apiKeyConfigured = true
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func saveApiBaseURL(_ url: String) async {
        UserDefaults.standard.set(url, forKey: "apiBaseURL")
    }

    // MARK: - AI Settings cache keys
    private enum AISettingsCache {
        static let llmProvider   = "cache_llm_provider"
        static let selectedModel = "cache_selected_model"
        static let proxyURL      = "cache_api_base_url"
        static let httpMode      = "cache_claude_http_mode"
        static let kimiConfigured = "cache_kimi_configured"
        static let kimiMasked    = "cache_kimi_masked"
    }

    /// Read all AI settings from local cache — returns instantly, no network.
    func readCachedAISettings() -> (provider: String, model: String, proxyURL: String, httpMode: String, kimiConfigured: Bool, kimiMasked: String) {
        let ud = UserDefaults.standard
        return (
            provider:       ud.string(forKey: AISettingsCache.llmProvider)   ?? "claude",
            model:          ud.string(forKey: AISettingsCache.selectedModel)  ?? "",
            proxyURL:       ud.string(forKey: AISettingsCache.proxyURL)       ?? "",
            httpMode:       ud.string(forKey: AISettingsCache.httpMode)       ?? "auto",
            kimiConfigured: ud.bool(forKey: AISettingsCache.kimiConfigured),
            kimiMasked:     ud.string(forKey: AISettingsCache.kimiMasked)     ?? ""
        )
    }

    /// Fetch all DB-stored settings in ONE request, then return the relevant fields.
    func refreshAISettingsFromAPI() async -> (provider: String, model: String, proxyURL: String, httpMode: String) {
        do {
            let all: [String: String] = try await APIClient.shared.get("/settings/")
            let provider = all["llm_provider"]    ?? "claude"
            let model    = all["selected_model"]  ?? ""
            let proxy    = all["api_base_url"]    ?? ""
            let mode     = all["claude_http_mode"] ?? "auto"
            let ud = UserDefaults.standard
            ud.set(provider, forKey: AISettingsCache.llmProvider)
            ud.set(model,    forKey: AISettingsCache.selectedModel)
            ud.set(proxy,    forKey: AISettingsCache.proxyURL)
            ud.set(mode,     forKey: AISettingsCache.httpMode)
            return (provider, model, proxy, mode)
        } catch {
            let c = readCachedAISettings()
            return (c.provider, c.model, c.proxyURL, c.httpMode)
        }
    }

    func loadClaudeProxyURL() async -> String {
        let all = await refreshAISettingsFromAPI()
        return all.proxyURL
    }

    func saveClaudeProxyURL(_ url: String) async {
        UserDefaults.standard.set(url, forKey: AISettingsCache.proxyURL)
        struct Body: Encodable { let value: String }
        do {
            struct SettingOut: Decodable { let key: String; let value: String }
            let _: SettingOut = try await APIClient.shared.put("/settings/api_base_url", body: Body(value: url))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadClaudeHttpMode() async -> String {
        let all = await refreshAISettingsFromAPI()
        return all.httpMode
    }

    func saveClaudeHttpMode(_ mode: String) async {
        UserDefaults.standard.set(mode, forKey: AISettingsCache.httpMode)
        struct Body: Encodable { let value: String }
        do {
            struct SettingOut: Decodable { let key: String; let value: String }
            let _: SettingOut = try await APIClient.shared.put("/settings/claude_http_mode", body: Body(value: mode))
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Kimi / Provider

    func kimiApiKeyStatus() async -> (configured: Bool, masked: String) {
        struct StatusResponse: Decodable { let configured: Bool; let masked: String? }
        do {
            let s: StatusResponse = try await APIClient.shared.get("/settings/kimi-api-key-status")
            let ud = UserDefaults.standard
            ud.set(s.configured,    forKey: AISettingsCache.kimiConfigured)
            ud.set(s.masked ?? "", forKey: AISettingsCache.kimiMasked)
            return (s.configured, s.masked ?? "")
        } catch {
            return (false, "")
        }
    }

    func saveKimiApiKey(_ key: String) async -> Bool {
        struct Body: Encodable { let apiKey: String }
        do {
            try await APIClient.shared.post("/settings/kimi-api-key", body: Body(apiKey: key))
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func loadLLMProvider() async -> String {
        let all = await refreshAISettingsFromAPI()
        return all.provider
    }

    func saveLLMProvider(_ provider: String) async {
        UserDefaults.standard.set(provider, forKey: AISettingsCache.llmProvider)
        struct Body: Encodable { let value: String }
        do {
            struct SettingOut: Decodable { let key: String; let value: String }
            let _: SettingOut = try await APIClient.shared.put("/settings/llm_provider", body: Body(value: provider))
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadSelectedModel() async -> String {
        let all = await refreshAISettingsFromAPI()
        return all.model
    }

    func saveSelectedModel(_ model: String) async {
        UserDefaults.standard.set(model, forKey: AISettingsCache.selectedModel)
        struct Body: Encodable { let value: String }
        do {
            struct SettingOut: Decodable { let key: String; let value: String }
            let _: SettingOut = try await APIClient.shared.put("/settings/selected_model", body: Body(value: model))
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Auth / User Management

    struct AppUser: Codable, Identifiable, Equatable {
        let id: Int
        let email: String
        let displayName: String
        let isAdmin: Bool
        let isActive: Bool
    }

    @Published var currentUser: AppUser? = nil
    @Published var allUsers: [AppUser] = []

    /// Returns nil on success, error message on failure.
    func login(email: String, password: String) async -> String? {
        struct LoginBody: Encodable { let email, password: String }
        struct LoginResp: Decodable {
            let token: String
            let user: AppUser
        }
        do {
            let resp: LoginResp = try await APIClient.shared.post("/auth/login", body: LoginBody(email: email, password: password))
            UserDefaults.standard.set(resp.token, forKey: "authToken")
            // Persist credentials for pre-fill on next login / session expiry
            UserDefaults.standard.set(email, forKey: "savedEmail")
            KeychainHelper.save(password: password, account: email)
            currentUser = resp.user
            return nil
        } catch let e as APIError {
            switch e {
            case .badStatus(401): return "邮箱或密码错误"
            case .badStatus(403): return "账号已被禁用"
            default: return "登录失败，请检查后端连接"
            }
        } catch {
            return "登录失败，请检查后端连接"
        }
    }

    func logout() async {
        try? await APIClient.shared.post("/auth/logout", body: EmptyBody())
        UserDefaults.standard.removeObject(forKey: "authToken")
        currentUser = nil
        allUsers = []
    }

    func loadUsers() async {
        do {
            let users: [AppUser] = try await APIClient.shared.get("/auth/users")
            allUsers = users
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createUser(email: String, password: String, displayName: String, isAdmin: Bool) async -> String? {
        struct Body: Encodable { let email, password, displayName: String; let isAdmin: Bool }
        do {
            let _: AppUser = try await APIClient.shared.post("/auth/users", body: Body(email: email, password: password, displayName: displayName, isAdmin: isAdmin))
            await loadUsers()
            return nil
        } catch let e as APIError {
            switch e {
            case .badStatus(409): return "该邮箱已存在"
            case .badStatus(400): return "密码至少6位"
            default: return e.localizedDescription
            }
        } catch {
            return error.localizedDescription
        }
    }

    func toggleUserActive(userId: Int, isActive: Bool) async -> String? {
        struct Body: Encodable { let isActive: Bool }
        do {
            let _: AppUser = try await APIClient.shared.patch("/auth/users/\(userId)", body: Body(isActive: isActive))
            await loadUsers()
            return nil
        } catch let e as APIError {
            if case .badStatus(400) = e { return "不能禁用最后一个管理员" }
            return e.localizedDescription
        } catch { return error.localizedDescription }
    }

    func deleteUser(userId: Int) async -> String? {
        do {
            try await APIClient.shared.delete("/auth/users/\(userId)")
            await loadUsers()
            return nil
        } catch let e as APIError {
            if case .badStatus(400) = e { return "不能删除最后一个管理员或自己" }
            return e.localizedDescription
        } catch { return error.localizedDescription }
    }

    func resetUserPassword(userId: Int, newPassword: String) async -> String? {
        struct Body: Encodable { let newPassword: String }
        do {
            try await APIClient.shared.post("/auth/users/\(userId)/reset-password", body: Body(newPassword: newPassword))
            return nil
        } catch let e as APIError {
            if case .badStatus(400) = e { return "密码至少6位" }
            return e.localizedDescription
        } catch { return error.localizedDescription }
    }

    // MARK: - V1.1 Project context & notes

    @discardableResult
    func generateProjectContext(apiProjectId: Int) async -> String? {
        struct Response: Decodable { let contextSummary: String }
        do {
            let res: Response = try await APIClient.shared.post("/projects/\(apiProjectId)/generate-context", body: EmptyBody())
            // Reload first, then patch — so our value wins over any stale decoded data
            await loadProjects()
            if let idx = apiProjects.firstIndex(where: { $0.id == apiProjectId }) {
                apiProjects[idx].contextSummary = res.contextSummary
            }
            return res.contextSummary
        } catch {
            print("[DataStore] generateProjectContext error: \(error)")
            return nil
        }
    }

    func loadProjectDetail(apiProjectId: Int) async -> APIProjectDetail? {
        do {
            return try await APIClient.shared.get("/projects/\(apiProjectId)/detail")
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func patchProjectContextSummary(apiProjectId: Int, summary: String) {
        if let idx = apiProjects.firstIndex(where: { $0.id == apiProjectId }) {
            apiProjects[idx].contextSummary = summary
        }
    }

    @discardableResult
    func saveProjectNote(apiProjectId: Int, content: String, append: Bool = true) async -> Bool {
        struct Body: Encodable { let content: String; let append: Bool }
        struct NoteResponse: Decodable { let notes: String }
        do {
            let res: NoteResponse = try await APIClient.shared.post("/projects/\(apiProjectId)/notes", body: Body(content: content, append: append))
            await loadProjects()
            if let idx = apiProjects.firstIndex(where: { $0.id == apiProjectId }) {
                apiProjects[idx].notes = res.notes
            }
            return true
        } catch {
            return false
        }
    }
}

private struct EmptyBody: Encodable {}
