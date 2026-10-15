import XCTest
@testable import Aria

@MainActor
final class AriaTests: XCTestCase {
    private func makeStore() -> AppStore {
        let defaults = UserDefaults(suiteName: "AriaTests.\(UUID().uuidString)")!
        return AppStore(defaults: defaults)
    }

    func testFirstLaunchShowsOnboarding() {
        let store = makeStore()
        store.finishSplash()
        XCTAssertEqual(store.stage, .onboarding)
        store.finishOnboarding()
        XCTAssertEqual(store.stage, .login)
    }

    func testOnboardingFlagCanBeReusedWithoutPersistingLogin() {
        let suite = "AriaTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = AppStore(defaults: defaults)
        first.finishOnboarding()
        first.login(email: "demo@example.com")
        let next = AppStore(defaults: defaults)
        next.finishSplash()
        XCTAssertEqual(next.stage, .login)
        XCTAssertEqual(next.profileEmail, "")
    }

    func testLoginAndLogoutClearEphemeralState() {
        let store = makeStore()
        store.login(email: " demo@example.com ")
        XCTAssertEqual(store.stage, .main)
        XCTAssertEqual(store.profileEmail, "demo@example.com")
        store.newConversation()
        store.logout()
        XCTAssertEqual(store.stage, .login)
        XCTAssertEqual(store.profileEmail, "")
        XCTAssertEqual(store.selectedTab, .chat)
        XCTAssertEqual(store.conversations.count, 5)
        XCTAssertEqual(store.pendingApprovalCount, 1)
    }

    func testApprovalDecisionIsIdempotent() throws {
        let store = makeStore()
        let approval = try XCTUnwrap(store.approvals.first)
        store.decideApproval(id: approval.id, approved: true)
        XCTAssertEqual(store.approvals.first?.status, .approved)
        XCTAssertEqual(store.pendingApprovalCount, 0)
        store.decideApproval(id: approval.id, approved: false)
        XCTAssertEqual(store.approvals.first?.status, .approved)
    }

    func testRejectApproval() throws {
        let store = makeStore()
        store.decideApproval(id: try XCTUnwrap(store.approvals.first).id, approved: false)
        XCTAssertEqual(store.approvals.first?.status, .rejected)
    }

    func testNewChatAndContextRouting() {
        let store = makeStore()
        let previousID = store.selectedConversationID
        store.newConversation()
        XCTAssertNotEqual(store.selectedConversationID, previousID)
        XCTAssertEqual(store.currentConversation?.title, "新的对话")
        store.selectedTab = .library
        store.openChat(context: "Aria 总体方案")
        XCTAssertEqual(store.selectedTab, .chat)
        XCTAssertEqual(store.chatDraft, "Aria 总体方案")
        XCTAssertEqual(store.messages.count, 1)
    }

    func testSendAndReplyCompleteInOriginalConversation() async throws {
        let store = makeStore()
        store.newConversation()
        let originalID = store.selectedConversationID
        store.send("帮我总结", replyTo: "原消息")
        XCTAssertTrue(store.isResponding)
        XCTAssertEqual(store.messages.last?.replyTo, "原消息")
        store.newConversation()
        try await Task.sleep(nanoseconds: 1_100_000_000)
        XCTAssertFalse(store.isResponding)
        let original = try XCTUnwrap(store.conversations.first { $0.id == originalID })
        XCTAssertEqual(original.messages.count, 3)
        XCTAssertEqual(original.messages.last?.role, .assistant)
        XCTAssertEqual(store.messages.count, 1)
    }

    func testRepliesRemainIsolatedAcrossConcurrentChats() async throws {
        let store = makeStore()
        let firstID = store.selectedConversationID
        store.send("第一个会话")
        store.newConversation()
        let secondID = store.selectedConversationID
        XCTAssertFalse(store.isResponding)
        store.send("第二个会话")
        XCTAssertEqual(store.respondingConversationIDs, Set([firstID, secondID]))
        try await Task.sleep(nanoseconds: 1_100_000_000)
        XCTAssertTrue(store.respondingConversationIDs.isEmpty)
        XCTAssertEqual(store.messages.count, 3)
    }

    func testDuplicateTapAndWhitespaceAreIgnored() {
        let store = makeStore()
        let count = store.messages.count
        store.send("   \n")
        XCTAssertEqual(store.messages.count, count)
        store.send("第一条")
        store.send("第二条")
        XCTAssertEqual(store.messages.count, count + 1)
        store.logout()
    }

    func testLogoutCancelsDelayedReply() async throws {
        let store = makeStore()
        store.login(email: "demo@example.com")
        store.send("发送摘要")
        store.logout()
        let count = store.messages.count
        try await Task.sleep(nanoseconds: 1_100_000_000)
        XCTAssertFalse(store.isResponding)
        XCTAssertEqual(store.messages.count, count)
        XCTAssertEqual(store.approvals.count, 1)
        XCTAssertEqual(store.stage, .login)
    }

    func testConversationSwitchRestoresTextAndReply() throws {
        let store = makeStore()
        let firstID = store.selectedConversationID
        let secondID = try XCTUnwrap(store.conversations.dropFirst().first).id
        store.chatDraft = "尚未完成的想法"
        store.replyQuote = "第一条原消息"
        XCTAssertTrue(store.selectConversation(id: secondID))
        XCTAssertEqual(store.chatDraft, "")
        XCTAssertNil(store.replyQuote)
        store.chatDraft = "第二个会话的草稿"
        store.selectConversation(id: firstID)
        XCTAssertEqual(store.chatDraft, "尚未完成的想法")
        XCTAssertEqual(store.replyQuote, "第一条原消息")
        store.selectConversation(id: secondID)
        XCTAssertEqual(store.chatDraft, "第二个会话的草稿")
    }

    func testNewConversationDoesNotDestroyPriorDraft() {
        let store = makeStore()
        let originalID = store.selectedConversationID
        store.chatDraft = "保留这个草稿"
        store.replyQuote = "保留这条引用"
        store.newConversation()
        XCTAssertEqual(store.chatDraft, "")
        XCTAssertNil(store.replyQuote)
        store.selectConversation(id: originalID)
        XCTAssertEqual(store.chatDraft, "保留这个草稿")
        XCTAssertEqual(store.replyQuote, "保留这条引用")
    }

    func testUnknownConversationSelectionIsIgnored() {
        let store = makeStore()
        let currentID = store.selectedConversationID
        store.chatDraft = "不能丢失"
        XCTAssertFalse(store.selectConversation(id: UUID()))
        XCTAssertEqual(store.selectedConversationID, currentID)
        XCTAssertEqual(store.chatDraft, "不能丢失")
    }

    func testContextRoutingMergesWithoutSendingOrDuplicating() {
        let store = makeStore()
        let count = store.messages.count
        store.chatDraft = "我还想补充一点"
        store.replyQuote = "此前引用"
        store.openChat(context: "  继续完善项目方案  ")
        XCTAssertEqual(store.chatDraft, "我还想补充一点\n\n继续完善项目方案")
        XCTAssertNil(store.replyQuote)
        store.openChat(context: "继续完善项目方案")
        XCTAssertEqual(store.chatDraft, "我还想补充一点\n\n继续完善项目方案")
        XCTAssertEqual(store.messages.count, count)
    }

    func testSendDraftClearsOnlyActiveComposer() {
        let store = makeStore()
        let firstID = store.selectedConversationID
        store.chatDraft = "其他会话草稿"
        store.newConversation()
        store.chatDraft = "发送当前草稿"
        store.replyQuote = "当前引用"
        XCTAssertTrue(store.sendDraft())
        XCTAssertEqual(store.messages.last?.text, "发送当前草稿")
        XCTAssertEqual(store.messages.last?.replyTo, "当前引用")
        XCTAssertEqual(store.chatDraft, "")
        XCTAssertNil(store.replyQuote)
        XCTAssertEqual(store.draft(for: firstID).text, "其他会话草稿")
        store.logout()
    }

    func testBusyOrEmptySendDoesNotDiscardComposer() {
        let store = makeStore()
        store.chatDraft = "  "
        store.replyQuote = "保留引用"
        XCTAssertFalse(store.sendDraft())
        XCTAssertEqual(store.chatDraft, "  ")
        XCTAssertEqual(store.replyQuote, "保留引用")
        store.send("先处理这一条")
        store.chatDraft = "下一条还在写"
        XCTAssertFalse(store.sendDraft())
        XCTAssertEqual(store.chatDraft, "下一条还在写")
        XCTAssertEqual(store.replyQuote, "保留引用")
        store.logout()
    }

    func testLogoutClearsEveryConversationDraft() {
        let store = makeStore()
        let firstID = store.selectedConversationID
        store.chatDraft = "第一个私有草稿"
        store.replyQuote = "第一个引用"
        store.newConversation()
        let secondID = store.selectedConversationID
        store.chatDraft = "第二个私有草稿"
        store.logout()
        XCTAssertEqual(store.draft(for: firstID), ComposerDraft())
        XCTAssertEqual(store.draft(for: secondID), ComposerDraft())
        XCTAssertEqual(store.chatDraft, "")
        XCTAssertNil(store.replyQuote)
    }

    func testSearchTrimsWhitespaceAndIncludesNewMessages() {
        let store = makeStore()
        XCTAssertEqual(store.searchMessages(matching: " \n ").count, 0)
        let expected = store.searchMessages(matching: "Aria").map(\.id)
        XCTAssertFalse(expected.isEmpty)
        XCTAssertEqual(store.searchMessages(matching: "  aria\n").map(\.id), expected)
        store.send("新消息专用搜索词")
        let results = store.searchMessages(matching: "  新消息专用搜索词 ")
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?.conversationID, store.selectedConversationID)
        store.logout()
    }

    func testStoppedReplyCannotCreateApprovalOrOverwriteRestart() async throws {
        let store = makeStore()
        let initialApprovals = store.approvals.count
        store.send("发送这份模拟摘要")
        store.chatDraft = "仍在编辑的草稿"
        store.stopResponse()
        XCTAssertFalse(store.isResponding)
        XCTAssertEqual(store.chatDraft, "仍在编辑的草稿")
        store.send("重新整理思路")
        try await Task.sleep(nanoseconds: 1_100_000_000)
        XCTAssertFalse(store.isResponding)
        XCTAssertEqual(store.approvals.count, initialApprovals)
        XCTAssertEqual(store.messages.count, 6)
        XCTAssertEqual(store.messages.last?.role, .assistant)
        XCTAssertEqual(store.chatDraft, "仍在编辑的草稿")
    }

    func testStopAffectsOnlySelectedConversation() async throws {
        let store = makeStore()
        let firstID = store.selectedConversationID
        store.send("第一个会话继续处理")
        store.newConversation()
        let secondID = store.selectedConversationID
        store.send("第二个会话停止处理")
        store.stopResponse()
        XCTAssertTrue(store.respondingConversationIDs.contains(firstID))
        XCTAssertFalse(store.respondingConversationIDs.contains(secondID))
        try await Task.sleep(nanoseconds: 1_100_000_000)
        XCTAssertTrue(store.respondingConversationIDs.isEmpty)
        XCTAssertEqual(store.messages.count, 2)
        XCTAssertEqual(store.conversations.first(where: { $0.id == firstID })?.messages.count, 5)
    }

    func testEmailValidation() {
        XCTAssertTrue(LoginValidation.isValidEmail("demo@example.com"))
        XCTAssertTrue(LoginValidation.isValidEmail("hello+test@aria.example"))
        XCTAssertFalse(LoginValidation.isValidEmail(""))
        XCTAssertFalse(LoginValidation.isValidEmail("not-an-email"))
        XCTAssertFalse(LoginValidation.isValidEmail("a@b"))
        XCTAssertFalse(LoginValidation.isValidEmail("a b@example.com"))
    }

    func testMockRepliesAreDeterministic() {
        XCTAssertEqual(MockReplies.reply(to: "总结周报"), MockReplies.reply(to: "总结周报"))
        XCTAssertTrue(MockReplies.reply(to: "发送摘要").contains("审批"))
    }
}
