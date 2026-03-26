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
            apiProjects = raw
            projects = raw.map { $0.toLocal() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    @discardableResult
    func createProject(name: String, client: String, description: String = "", status: String = "lead") async -> Bool {
        struct Body: Encodable { let name, client, description, status: String }
        do {
            let _: APIProject = try await APIClient.shared.post(
                "/projects",
                body: Body(name: name, client: client, description: description, status: status)
            )
            await loadProjects()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func updateProjectStatus(apiId: Int, status: String) async {
        struct Body: Encodable { let status: String }
        do {
            let _: APIProject = try await APIClient.shared.patch("/projects/\(apiId)", body: Body(status: status))
            await loadProjects()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteProject(apiId: Int) async {
        do {
            try await APIClient.shared.delete("/projects/\(apiId)")
            await loadProjects()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Conversations

    func loadConversations() async {
        do {
            conversations = try await APIClient.shared.get("/chat/conversations")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createConversation(projectId: Int? = nil, skillId: Int? = nil) async -> APIConversation? {
        var query: [String: String] = [:]
        if let p = projectId { query["project_id"] = "\(p)" }
        if let s = skillId { query["skill_id"] = "\(s)" }
        do {
            let conv: APIConversation = try await APIClient.shared.post("/chat/conversations", query: query)
            await loadConversations()
            return conv
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func deleteConversation(id: Int) async {
        do {
            try await APIClient.shared.delete("/chat/conversations/\(id)")
            await loadConversations()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadMessages(conversationId: Int) async -> [APIMessage] {
        do {
            return try await APIClient.shared.get("/chat/conversations/\(conversationId)/messages")
        } catch {
            self.error = error.localizedDescription
            return []
        }
    }

    // MARK: - Skills

    func loadSkills() async {
        do {
            let raw: [APISkill] = try await APIClient.shared.get("/skills")
            if raw.isEmpty {
                struct Empty: Decodable {}
                let _: Empty = try await APIClient.shared.post("/skills/seed", body: EmptyBody())
            }
            // Always run seed-pro to ensure guided workflow skills exist (idempotent)
            struct SeedResult: Decodable { let count: Int }
            let _: SeedResult = try await APIClient.shared.post("/skills/seed-pro", body: EmptyBody())
            // Migrate old-format categories (quick_tool → business domain) — idempotent
            struct MigrateResult: Decodable { let updated: Int }
            let _: MigrateResult = try await APIClient.shared.post("/skills/migrate-categories", body: EmptyBody())
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
            _ = try await APIClient.shared.uploadFile(
                path: "/knowledge/documents",
                fileURL: fileURL,
                extraFields: category.isEmpty ? [:] : ["category": category]
            )
            await loadDocuments()
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
            let _: APIProject = try await APIClient.shared.patch(
                "/projects/\(apiProjectId)",
                body: Body(contractAmount: amount)
            )
            await loadProjects()
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
            await loadDocuments()
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
            let _: APIScheduledTask = try await APIClient.shared.patch(
                "/schedules/\(apiId)",
                body: Body(isEnabled: enabled)
            )
            await loadSchedules()
        } catch {
            self.error = error.localizedDescription
        }
    }

    @discardableResult
    func createScheduledTask(name: String, prompt: String, frequency: String, projectId: Int? = nil, skillId: Int? = nil) async -> Bool {
        struct Body: Encodable { let name, prompt, frequency: String; let projectId: Int?; let skillId: Int? }
        do {
            let _: APIScheduledTask = try await APIClient.shared.post(
                "/schedules",
                body: Body(name: name, prompt: prompt, frequency: frequency, projectId: projectId, skillId: skillId)
            )
            await loadSchedules()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteScheduledTask(apiId: Int) async {
        do {
            try await APIClient.shared.delete("/schedules/\(apiId)")
            await loadSchedules()
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
            let _: APIClientRecord = try await APIClient.shared.post(
                "/clients",
                body: Body(name: name, industry: industry, contact: contact, notes: notes)
            )
            await loadClients()
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
            let _: APIClientRecord = try await APIClient.shared.put(
                "/clients/\(apiId)",
                body: Body(name: name, industry: industry, contact: contact, notes: notes)
            )
            await loadClients()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteClient(apiId: Int) async {
        do {
            try await APIClient.shared.delete("/clients/\(apiId)")
            await loadClients()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func linkDocument(clientApiId: Int, docApiId: Int) async {
        do {
            try await APIClient.shared.post("/clients/\(clientApiId)/documents/\(docApiId)", body: EmptyBody())
            await loadClients()
            await loadDocuments()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func unlinkDocument(clientApiId: Int, docApiId: Int) async {
        do {
            try await APIClient.shared.delete("/clients/\(clientApiId)/documents/\(docApiId)")
            await loadClients()
            await loadDocuments()
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
            _ = try await APIClient.shared.uploadFile(
                path: "/templates",
                fileURL: fileURL,
                extraFields: category.isEmpty ? [:] : ["category": category]
            )
            await loadTemplates()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteTemplate(apiId: Int) async {
        do {
            try await APIClient.shared.delete("/templates/\(apiId)")
            await loadTemplates()
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
}

private struct EmptyBody: Encodable {}
