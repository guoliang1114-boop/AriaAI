import Foundation
import SwiftUI

enum AppStage: Equatable { case splash, onboarding, login, main }
enum AppTab: Hashable { case chat, activity, inspiration, goals, library }
enum MessageRole: String, Codable, Equatable { case assistant, user }
enum ApprovalStatus: String, Codable { case pending = "待审批", approved = "已同意", rejected = "已拒绝" }

struct ApprovalItem: Identifiable, Codable {
    let id: UUID
    let title: String
    let detail: String
    var status: ApprovalStatus = .pending
}

struct ChatMessage: Identifiable, Codable {
    let id: UUID
    let role: MessageRole
    let text: String
    let date: Date
    var replyTo: String?
    var approvalID: UUID?

    init(id: UUID = UUID(), role: MessageRole, text: String, date: Date = Date(),
         replyTo: String? = nil, approvalID: UUID? = nil) {
        self.id = id
        self.role = role
        self.text = text
        self.date = date
        self.replyTo = replyTo
        self.approvalID = approvalID
    }
}

struct Conversation: Identifiable, Codable {
    let id: UUID
    var title: String
    var subtitle: String
    var messages: [ChatMessage]
}

struct ComposerDraft: Equatable, Codable {
    var text = ""
    var replyTo: String? = nil
}

struct MessageSearchResult: Identifiable {
    let conversationID: UUID
    let conversationTitle: String
    let message: ChatMessage
    var id: UUID { message.id }
}

/// Credentials stay ephemeral. Only explicitly selected demo state reaches the local snapshot.
@MainActor
final class AppStore: ObservableObject {
    @Published var stage: AppStage = .splash
    @Published var selectedTab: AppTab = .chat
    @Published var profileEmail = ""
    @Published private var drafts: [UUID: ComposerDraft] = [:] { didSet { scheduleSave() } }
    @Published var chatContextID = UUID()
    @Published var conversations: [Conversation] = [] { didSet { scheduleSave() } }
    @Published private(set) var selectedConversationID = UUID() { didSet { scheduleSave() } }
    @Published var approvals: [ApprovalItem] = [] { didSet { scheduleSave() } }
    @Published private(set) var respondingConversationIDs: Set<UUID> = [] { didSet { scheduleSave() } }
    @Published var toast: String? = nil
    private var replyTasks: [UUID: Task<Void, Never>] = [:]
    private var responseTokens: [UUID: UUID] = [:]
    private var toastTask: Task<Void, Never>?
    private var sessionID = UUID()
    private let defaults: UserDefaults
    private let persistence: DemoPersistence?
    @Published private(set) var persistenceState: LocalSaveState = .memoryOnly
    @Published private(set) var recoveryNote: String?
    private var saveTask: Task<Void, Never>?
    private var isPersistenceReady = false
    private var isRestoring = false
    private var restoreBlocked = false
    private var hasUnsavedChanges = false
    private var migrationNeedsArchive = false

    init(defaults: UserDefaults = .standard, persistence: DemoPersistence? = nil) {
        self.defaults = defaults
        self.persistence = persistence
        seedDemo()
        if let persistence { applyLoad(persistence.load()) }
        isPersistenceReady = true
    }

    var currentConversation: Conversation? {
        conversations.first { $0.id == selectedConversationID }
    }
    var isResponding: Bool { respondingConversationIDs.contains(selectedConversationID) }
    var messages: [ChatMessage] { currentConversation?.messages ?? [] }
    var pendingApprovalCount: Int { approvals.filter { $0.status == .pending }.count }

    var chatDraft: String {
        get { draft(for: selectedConversationID).text }
        set {
            var value = draft(for: selectedConversationID)
            value.text = newValue
            drafts[selectedConversationID] = value
        }
    }

    var replyQuote: String? {
        get { draft(for: selectedConversationID).replyTo }
        set {
            var value = draft(for: selectedConversationID)
            value.replyTo = newValue
            drafts[selectedConversationID] = value
        }
    }

    func draft(for conversationID: UUID) -> ComposerDraft {
        drafts[conversationID] ?? ComposerDraft()
    }

    @discardableResult
    func selectConversation(id: UUID) -> Bool {
        guard conversations.contains(where: { $0.id == id }) else { return false }
        selectedConversationID = id
        return true
    }

    func searchMessages(matching query: String) -> [MessageSearchResult] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { return [] }
        return conversations.flatMap { conversation in
            conversation.messages.filter { $0.text.localizedCaseInsensitiveContains(term) }.map {
                MessageSearchResult(conversationID: conversation.id, conversationTitle: conversation.title, message: $0)
            }
        }
    }

    @discardableResult
    func sendDraft() -> Bool {
        let value = draft(for: selectedConversationID)
        guard send(value.text, replyTo: value.replyTo) else { return false }
        drafts[selectedConversationID] = nil
        return true
    }

    func finishSplash() {
        guard stage == .splash else { return }
        stage = defaults.bool(forKey: "aria.onboarding.complete") ? .login : .onboarding
    }

    func finishOnboarding() {
        defaults.set(true, forKey: "aria.onboarding.complete")
        stage = .login
    }

    func login(email: String) {
        profileEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        selectedTab = .chat
        stage = .main
    }

    func logout() {
        replyTasks.values.forEach { $0.cancel() }
        replyTasks.removeAll()
        responseTokens.removeAll()
        drafts.removeAll()
        toastTask?.cancel()
        sessionID = UUID()
        respondingConversationIDs.removeAll()
        profileEmail = ""
        toast = nil
        selectedTab = .chat
        flushPersistence()
        stage = .login
    }

    func replayOnboarding() {
        logout()
        defaults.set(false, forKey: "aria.onboarding.complete")
        stage = .onboarding
    }

    func newConversation() {
        guard conversations.count < 200 else {
            showToast("本地演示最多保留 200 个对话。已有内容未改变，可在数据控制中归档并重置。")
            return
        }
        let conversation = Conversation(id: UUID(), title: "新的对话", subtitle: "从一个想法开始", messages: [
            ChatMessage(role: .assistant, text: "今天有什么想一起推进的？\n可以是一个项目、一份待办，或者还没理清的想法。")
        ])
        var proposed = makeSnapshot()
        proposed.conversations.insert(conversation, at: 0)
        proposed.selectedConversationID = conversation.id
        guard canAcceptHistory(proposed, reservingReplies: respondingConversationIDs.count) else { return }
        conversations.insert(conversation, at: 0)
        selectConversation(id: conversation.id)
        selectedTab = .chat
    }

    @discardableResult
    func send(_ text: String, replyTo: String? = nil) -> Bool {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !isResponding, currentConversation != nil else { return false }
        guard clean.utf8.count <= 100_000, (replyTo?.utf8.count ?? 0) <= 100_000 else {
            showToast("这条内容太长，请缩短后发送。草稿已保留。")
            return false
        }
        // Leave space for all in-flight deterministic replies before appending permanent history.
        var proposed = makeSnapshot()
        if let index = proposed.conversations.firstIndex(where: { $0.id == selectedConversationID }) {
            proposed.conversations[index].messages.append(ChatMessage(role: .user, text: clean, replyTo: replyTo))
        }
        guard canAcceptHistory(proposed, reservingReplies: respondingConversationIDs.count + 1) else { return false }
        let conversationID = selectedConversationID
        let currentSession = sessionID
        let responseToken = UUID()
        responseTokens[conversationID] = responseToken
        append(ChatMessage(role: .user, text: clean, replyTo: replyTo), to: conversationID)
        if let index = conversations.firstIndex(where: { $0.id == conversationID }), conversations[index].title == "新的对话" {
            conversations[index].title = String(clean.prefix(16))
        }
        respondingConversationIDs.insert(conversationID)
        replyTasks[conversationID]?.cancel()
        replyTasks[conversationID] = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 850_000_000) } catch { return }
            guard let self, !Task.isCancelled, self.sessionID == currentSession,
                  self.responseTokens[conversationID] == responseToken else { return }
            let result = MockReplies.reply(to: clean)
            self.append(ChatMessage(role: .assistant, text: result), to: conversationID)
            if clean.contains("发送") || clean.contains("审批") {
                let approval = ApprovalItem(id: UUID(), title: "发送项目进度摘要", detail: "收件人：设计项目组（示例）\n内容：本周已完成的工作、当前风险与下周计划。\n这是本地审批演示，不会发送任何消息。")
                self.approvals.insert(approval, at: 0)
                self.append(ChatMessage(role: .assistant, text: "这一步需要你确认。你可以先查看内容，再决定是否继续。", approvalID: approval.id), to: conversationID)
            }
            self.respondingConversationIDs.remove(conversationID)
            self.replyTasks[conversationID] = nil
            self.responseTokens[conversationID] = nil
        }
        return true
    }

    func stopResponse() {
        let conversationID = selectedConversationID
        guard respondingConversationIDs.contains(conversationID) else { return }
        responseTokens[conversationID] = nil
        replyTasks.removeValue(forKey: conversationID)?.cancel()
        respondingConversationIDs.remove(conversationID)
        showToast("已停止整理，草稿仍为你保留")
    }

    func openChat(context: String) {
        let context = context.trimmingCharacters(in: .whitespacesAndNewlines)
        if !context.isEmpty {
            let existing = chatDraft.trimmingCharacters(in: .whitespacesAndNewlines)
            if existing.isEmpty {
                chatDraft = context
            } else if !existing.contains(context) {
                chatDraft += "\n\n" + context
            }
            replyQuote = nil
        }
        chatContextID = UUID()
        selectedTab = .chat
    }

    func addCallSummary(_ summary: String) {
        let message = ChatMessage(role: .assistant, text: summary)
        var proposed = makeSnapshot()
        guard let index = proposed.conversations.firstIndex(where: { $0.id == selectedConversationID }) else { return }
        proposed.conversations[index].messages.append(message)
        proposed.conversations[index].subtitle = String(summary.prefix(38))
        guard canAcceptHistory(proposed, reservingReplies: respondingConversationIDs.count) else {
            showToast("本地演示容量不足，通话已结束，但摘要未加入历史。已有内容没有改变。")
            selectedTab = .chat
            return
        }
        append(message, to: selectedConversationID)
        // Phone background finalization may run after the app-level scene flush.
        flushPersistence()
        selectedTab = .chat
    }

    func decideApproval(id: UUID, approved: Bool) {
        guard let index = approvals.firstIndex(where: { $0.id == id }), approvals[index].status == .pending else { return }
        approvals[index].status = approved ? .approved : .rejected
        showToast(approved ? "已同意 · 仅更新本地模拟状态" : "已拒绝 · 不会执行这一步")
    }

    /// Flushes the current document on scene changes and explicit retry. No credentials are encoded.
    func flushPersistence() {
        saveTask?.cancel()
        saveTask = nil
        guard let persistence, !restoreBlocked, hasUnsavedChanges else { return }
        do {
            if migrationNeedsArchive {
                if let archive = try persistence.archiveCurrent() {
                    recoveryNote = "旧版记录已归档：\(archive)"
                }
                migrationNeedsArchive = false
            }
            let snapshot = makeSnapshot()
            try persistence.save(snapshot)
            hasUnsavedChanges = false
            persistenceState = .saved(snapshot.savedAt)
        } catch {
            persistenceState = .failed(storageExplanation(error))
        }
    }

    func retryPersistence() {
        guard let persistence else { return }
        if restoreBlocked {
            guard !hasUnsavedChanges else {
                showToast("当前还有临时改动。为避免丢失，不会重新载入；可在数据控制中确认归档并重置。")
                return
            }
            applyLoad(persistence.load())
        } else {
            flushPersistence()
        }
    }

    /// Must only be called after the UI's explicit confirmation.
    @discardableResult
    func resetLocalDemo() -> Bool {
        saveTask?.cancel()
        saveTask = nil
        let fresh = Self.demoSnapshot()
        do {
            var archive: String?
            if let persistence {
                archive = try persistence.archiveCurrent()
                try persistence.save(fresh)
            }
            replyTasks.values.forEach { $0.cancel() }
            replyTasks.removeAll()
            responseTokens.removeAll()
            sessionID = UUID()
            isRestoring = true
            respondingConversationIDs.removeAll()
            applySnapshot(fresh)
            isRestoring = false
            restoreBlocked = false
            migrationNeedsArchive = false
            hasUnsavedChanges = false
            recoveryNote = archive.map { "重置前记录已归档在本机：\($0)" }
            persistenceState = persistence == nil ? .memoryOnly : .saved(fresh.savedAt)
            chatContextID = UUID()
            showToast("已恢复示例数据")
            return true
        } catch {
            if !restoreBlocked { hasUnsavedChanges = true }
            let explanation = "重置未完成，当前会话没有改变。" + storageExplanation(error)
                + "重试只会保存当前内容；如需重置，请再次确认。"
            persistenceState = restoreBlocked ? .blocked(explanation) : .failed(explanation)
            return false
        }
    }

    private func canAcceptHistory(_ snapshot: DemoSnapshot, reservingReplies: Int) -> Bool {
        do {
            try snapshot.validate()
            let messageCount = snapshot.conversations.reduce(0) { $0 + $1.messages.count }
            let bytes = try JSONEncoder().encode(snapshot).count
            guard messageCount + reservingReplies * 3 <= 20_000,
                  snapshot.approvals.count + reservingReplies <= 5_000,
                  bytes + 1_024 + reservingReplies * 16_384 <= FileDemoPersistence.maximumBytes else {
                throw DemoStorageError.capacityExceeded
            }
            return true
        } catch {
            showToast("内容超过本地演示容量，请缩短未发送草稿或在数据控制中归档重置。已有消息没有改变。")
            return false
        }
    }

    private func makeSnapshot() -> DemoSnapshot {
        DemoSnapshot(conversations: conversations, approvals: approvals,
                     drafts: drafts.map { DemoSnapshot.DraftRecord(conversationID: $0.key, value: $0.value) },
                     selectedConversationID: selectedConversationID,
                     pendingReplyConversationIDs: Array(respondingConversationIDs))
    }

    private func applySnapshot(_ snapshot: DemoSnapshot) {
        conversations = snapshot.conversations
        approvals = snapshot.approvals
        drafts = Dictionary(uniqueKeysWithValues: snapshot.drafts.map { ($0.conversationID, $0.value) })
        selectedConversationID = snapshot.selectedConversationID
    }

    private func applyLoad(_ result: DemoLoadResult) {
        isRestoring = true
        defer { isRestoring = false }
        switch result {
        case .empty:
            restoreBlocked = false
            persistenceState = .ready
        case .loaded(let snapshot, let migrated):
            // Validate again at the boundary, including injected stores used by tests.
            do { try snapshot.validate() } catch {
                restoreBlocked = true
                persistenceState = .blocked(DemoStorageError.invalidDocument.explanation)
                return
            }
            applySnapshot(snapshot)
            restoreBlocked = false
            hasUnsavedChanges = false
            migrationNeedsArchive = migrated
            persistenceState = .saved(snapshot.savedAt)
            if !snapshot.pendingReplyConversationIDs.isEmpty {
                recoveryNote = "上次关闭前有未完成的模拟回复。已保留发送内容，不会自动继续；可在原会话重新发送。"
            } else if migrated {
                recoveryNote = "已读取兼容的旧版记录；下次保存前会先归档旧文件。"
            }
        case .blocked(let error):
            restoreBlocked = true
            persistenceState = .blocked(error.explanation)
        }
    }

    private func scheduleSave() {
        guard isPersistenceReady, !isRestoring, persistence != nil else { return }
        hasUnsavedChanges = true
        guard !restoreBlocked else { return }
        persistenceState = .pending
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 300_000_000) } catch { return }
            guard !Task.isCancelled else { return }
            self?.flushPersistence()
        }
    }

    private func storageExplanation(_ error: Error) -> String {
        (error as? DemoStorageError)?.explanation ?? DemoStorageError.writeFailed.explanation
    }

    func showToast(_ text: String) {
        toastTask?.cancel()
        toast = text
        toastTask = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 2_600_000_000) } catch { return }
            self?.toast = nil
        }
    }

    private func append(_ message: ChatMessage, to conversationID: UUID) {
        guard let index = conversations.firstIndex(where: { $0.id == conversationID }) else { return }
        conversations[index].messages.append(message)
        conversations[index].subtitle = String(message.text.prefix(38))
    }

    private func seedDemo() { applySnapshot(Self.demoSnapshot()) }

    private static func demoSnapshot() -> DemoSnapshot {
        let approval = ApprovalItem(id: UUID(), title: "创建晨间日程简报", detail: "操作：生成晨间日程简报\n访问范围：日历、邮件邀请\n运行时间：每天 07:30\n对外发送：无\n这是本地模拟审批，不会读取信息或创建真实任务。")
        let main = Conversation(id: UUID(), title: "明天的安排", subtitle: "先帮我看看明天的安排。", messages: [
            ChatMessage(role: .assistant, text: "晚上好。Aria 的移动端前端方案已经整理好了。你可以先看移动端导航，也可以直接点麦克风体验语音通话。"),
            ChatMessage(role: .user, text: "先帮我看看明天的安排。"),
            ChatMessage(role: .assistant, text: "可以。我会先整理示例日历和邮件邀请，再生成一份晨间简报。这类持续访问在真实产品中需要你确认；下面只演示审批流程。", approvalID: approval.id)
        ])
        let conversations = [main,
            Conversation(id: UUID(), title: "Aria 移动端设计", subtitle: "语音通话页采用白色沉浸式界面", messages: [ChatMessage(role: .assistant, text: "语音通话页采用白色沉浸式界面，并保留听、想、说三种状态。\n底部五个入口：聊天、动态、灵感、目标和资料库。")]),
            Conversation(id: UUID(), title: "个人助手总体方案", subtitle: "移动端、生活连接器与语音模式", messages: [ChatMessage(role: .assistant, text: "围绕移动端、生活连接器与语音模式，逐步形成完整的个人助手体验。\n先规划 Gmail、日历与天气，并按操作风险分级授权。当前演示不连接任何真实服务。")]),
            Conversation(id: UUID(), title: "英语面试练习", subtitle: "Why do you want this job?", messages: [ChatMessage(role: .assistant, text: "Let's practice one question: Why do you want this job?\n先用一句话说清楚你的动机，再补充一个具体经历。")]),
            Conversation(id: UUID(), title: "项目文档整理", subtitle: "把技术设计合并到总体方案", messages: [ChatMessage(role: .assistant, text: "可以把文档整理成四部分：目标与范围、核心体验、系统设计、阶段计划。我们先把重复的信息合并，再明确待确认的问题。")])
        ]
        return DemoSnapshot(conversations: conversations, approvals: [approval], drafts: [], selectedConversationID: main.id)
    }

}

enum MockReplies {
    static func reply(to input: String) -> String {
        if input.contains("周报") || input.contains("总结") {
            return "可以，先给你一份简洁的结构：\n\n已完成：访谈整理、关键问题归纳\n进行中：两版视觉方向与评审材料\n下一步：确认核心关键词，再安排评审\n\n这是演示数据。你可以继续补充内容，我会在当前对话中一起梳理。"
        }
        if input.contains("发送") || input.contains("审批") {
            return "我已准备好一份示例摘要。涉及对外发送的步骤，会先交给你审批。"
        }
        if input.contains("灵感") {
            return "试试从三个角度发散：\n\n感受：希望别人先记住什么？\n场景：它会出现在哪里？\n反差：有什么常规做法值得打破？\n\n先挑一个最有感觉的方向，我们再往下展开。"
        }
        return "收到，我们把这件事拆成一个容易开始的下一步。\n\n先明确你想得到的结果，再列出最关键的一个限制。今天只推进最小但有价值的一步。\n\n你想先从目标、时间安排，还是具体内容开始？\n\n（当前为本地模拟回复）"
    }
}
