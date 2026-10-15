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
