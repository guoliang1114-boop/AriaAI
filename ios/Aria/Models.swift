import Foundation
import SwiftUI

enum AppStage: Equatable { case splash, onboarding, login, main }
enum AppTab: Hashable { case chat, activity, inspiration, goals, library }
enum MessageRole: Equatable { case assistant, user }
enum ApprovalStatus: String { case pending = "待审批", approved = "已同意", rejected = "已拒绝" }

struct ApprovalItem: Identifiable {
    let id: UUID
    let title: String
    let detail: String
    var status: ApprovalStatus = .pending
}

struct ChatMessage: Identifiable {
    let id = UUID()
    let role: MessageRole
    let text: String
    let date: Date = Date()
    var replyTo: String? = nil
    var approvalID: UUID? = nil
}

struct Conversation: Identifiable {
    let id: UUID
    var title: String
    var subtitle: String
    var messages: [ChatMessage]
}

/// All data stays in this process. Only the onboarding completion flag uses UserDefaults.
@MainActor
final class AppStore: ObservableObject {
    @Published var stage: AppStage = .splash
    @Published var selectedTab: AppTab = .chat
    @Published var profileEmail = ""
    @Published var chatDraft = ""
    @Published var chatContextID = UUID()
    @Published var conversations: [Conversation] = []
    @Published var selectedConversationID = UUID()
    @Published var approvals: [ApprovalItem] = []
    @Published private(set) var respondingConversationIDs: Set<UUID> = []
    @Published var toast: String? = nil
    private var replyTasks: [UUID: Task<Void, Never>] = [:]
    private var toastTask: Task<Void, Never>?
    private var sessionID = UUID()
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        seedDemo()
    }

    var currentConversation: Conversation? {
        conversations.first { $0.id == selectedConversationID }
    }
    var isResponding: Bool { respondingConversationIDs.contains(selectedConversationID) }
    var messages: [ChatMessage] { currentConversation?.messages ?? [] }
    var pendingApprovalCount: Int { approvals.filter { $0.status == .pending }.count }

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
        toastTask?.cancel()
        sessionID = UUID()
        respondingConversationIDs.removeAll()
        profileEmail = ""
        chatDraft = ""
        toast = nil
        selectedTab = .chat
        seedDemo()
        stage = .login
    }

    func replayOnboarding() {
        logout()
        defaults.set(false, forKey: "aria.onboarding.complete")
        stage = .onboarding
    }

    func newConversation() {
        let conversation = Conversation(id: UUID(), title: "新的对话", subtitle: "从一个想法开始", messages: [
            ChatMessage(role: .assistant, text: "今天有什么想一起推进的？\n可以是一个项目、一份待办，或者还没理清的想法。")
        ])
        conversations.insert(conversation, at: 0)
        selectedConversationID = conversation.id
        chatDraft = ""
        selectedTab = .chat
    }

    func send(_ text: String, replyTo: String? = nil) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, !isResponding else { return }
        let conversationID = selectedConversationID
        let currentSession = sessionID
        append(ChatMessage(role: .user, text: clean, replyTo: replyTo), to: conversationID)
        if let index = conversations.firstIndex(where: { $0.id == conversationID }), conversations[index].title == "新的对话" {
            conversations[index].title = String(clean.prefix(16))
        }
        respondingConversationIDs.insert(conversationID)
        replyTasks[conversationID]?.cancel()
        replyTasks[conversationID] = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 850_000_000) } catch { return }
            guard let self, !Task.isCancelled, self.sessionID == currentSession else { return }
            let result = MockReplies.reply(to: clean)
            self.append(ChatMessage(role: .assistant, text: result), to: conversationID)
            if clean.contains("发送") || clean.contains("审批") {
                let approval = ApprovalItem(id: UUID(), title: "发送项目进度摘要", detail: "收件人：设计项目组（示例）\n内容：本周已完成的工作、当前风险与下周计划。\n这是本地审批演示，不会发送任何消息。")
                self.approvals.insert(approval, at: 0)
                self.append(ChatMessage(role: .assistant, text: "这一步需要你确认。你可以先查看内容，再决定是否继续。", approvalID: approval.id), to: conversationID)
            }
            self.respondingConversationIDs.remove(conversationID)
            self.replyTasks[conversationID] = nil
        }
    }

    func openChat(context: String) {
        chatDraft = context
        chatContextID = UUID()
        selectedTab = .chat
    }

    func addCallSummary(_ summary: String) {
        append(ChatMessage(role: .assistant, text: summary), to: selectedConversationID)
        selectedTab = .chat
    }

    func decideApproval(id: UUID, approved: Bool) {
        guard let index = approvals.firstIndex(where: { $0.id == id }), approvals[index].status == .pending else { return }
        approvals[index].status = approved ? .approved : .rejected
        showToast(approved ? "已同意 · 仅更新本地模拟状态" : "已拒绝 · 不会执行这一步")
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

    private func seedDemo() {
        let approval = ApprovalItem(id: UUID(), title: "创建晨间日程简报", detail: "操作：生成晨间日程简报\n访问范围：日历、邮件邀请\n运行时间：每天 07:30\n对外发送：无\n这是本地模拟审批，不会读取信息或创建真实任务。")
        approvals = [approval]
        let main = Conversation(id: UUID(), title: "明天的安排", subtitle: "先帮我看看明天的安排。", messages: [
            ChatMessage(role: .assistant, text: "晚上好。Aria 的移动端前端方案已经整理好了。你可以先看移动端导航，也可以直接点麦克风体验语音通话。"),
            ChatMessage(role: .user, text: "先帮我看看明天的安排。"),
            ChatMessage(role: .assistant, text: "可以。我会先整理示例日历和邮件邀请，再生成一份晨间简报。这类持续访问在真实产品中需要你确认；下面只演示审批流程。", approvalID: approval.id)
        ])
        conversations = [main,
            Conversation(id: UUID(), title: "Aria 移动端设计", subtitle: "语音通话页采用白色沉浸式界面", messages: [ChatMessage(role: .assistant, text: "语音通话页采用白色沉浸式界面，并保留听、想、说三种状态。\n底部五个入口：聊天、动态、灵感、目标和资料库。")]),
            Conversation(id: UUID(), title: "个人助手总体方案", subtitle: "移动端、生活连接器与语音模式", messages: [ChatMessage(role: .assistant, text: "围绕移动端、生活连接器与语音模式，逐步形成完整的个人助手体验。\n先规划 Gmail、日历与天气，并按操作风险分级授权。当前演示不连接任何真实服务。")]),
            Conversation(id: UUID(), title: "英语面试练习", subtitle: "Why do you want this job?", messages: [ChatMessage(role: .assistant, text: "Let's practice one question: Why do you want this job?\n先用一句话说清楚你的动机，再补充一个具体经历。")]),
            Conversation(id: UUID(), title: "项目文档整理", subtitle: "把技术设计合并到总体方案", messages: [ChatMessage(role: .assistant, text: "可以把文档整理成四部分：目标与范围、核心体验、系统设计、阶段计划。我们先把重复的信息合并，再明确待确认的问题。")])
        ]
        selectedConversationID = main.id
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
