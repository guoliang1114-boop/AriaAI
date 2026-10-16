import Foundation
import XCTest
@testable import Aria

@MainActor
final class AriaTests: XCTestCase {
    private func makeStore() -> AppStore {
        AppStore(defaults: makeDefaults())
    }

    private func makeDefaults() -> UserDefaults {
        let suite = "AriaTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        return defaults
    }

    private func makePersistence() throws -> FileDemoPersistence {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("AriaPersistenceTests.\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return FileDemoPersistence(directory: directory)
    }

    private func makeSnapshot() -> DemoSnapshot {
        let firstID = UUID()
        let secondID = UUID()
        let approvalID = UUID()
        let date = Date(timeIntervalSinceReferenceDate: 123_456.25)
        return DemoSnapshot(savedAt: date, conversations: [
            Conversation(id: firstID, title: "已有会话", subtitle: "保留消息关联", messages: [
                ChatMessage(id: UUID(), role: .user, text: "引用后的消息", date: date,
                            replyTo: "原来的内容"),
                ChatMessage(id: UUID(), role: .assistant, text: "请查看审批", date: date.addingTimeInterval(60),
                            approvalID: approvalID)
            ]),
            Conversation(id: secondID, title: "第二个会话", subtitle: "继续处理", messages: [
                ChatMessage(id: UUID(), role: .assistant, text: "欢迎回来", date: date.addingTimeInterval(120))
            ])
        ], approvals: [
            ApprovalItem(id: approvalID, title: "本地审批", detail: "只更新示例状态", status: .approved)
        ], drafts: [
            DemoSnapshot.DraftRecord(conversationID: firstID,
                                     value: ComposerDraft(text: "第一个草稿", replyTo: "保留引用")),
            DemoSnapshot.DraftRecord(conversationID: secondID,
                                     value: ComposerDraft(text: "第二个草稿"))
        ], selectedConversationID: secondID)
    }

    private func loadedSnapshot(_ persistence: DemoPersistence,
                                file: StaticString = #filePath, line: UInt = #line) throws -> DemoSnapshot {
        guard case .loaded(let snapshot, _) = persistence.load() else {
            XCTFail("Expected a readable local document", file: file, line: line)
            throw DemoStorageError.invalidDocument
        }
        return snapshot
    }

    private func assertBlocked(_ result: DemoLoadResult, expected: DemoStorageError,
                               file: StaticString = #filePath, line: UInt = #line) {
        guard case .blocked(let actual) = result else {
            XCTFail("Expected the document to be protected", file: file, line: line)
            return
        }
        switch (actual, expected) {
        case (.unsupportedVersion(let actualVersion), .unsupportedVersion(let expectedVersion)):
            XCTAssertEqual(actualVersion, expectedVersion, file: file, line: line)
        case (.invalidDocument, .invalidDocument), (.fileTooLarge, .fileTooLarge),
             (.capacityExceeded, .capacityExceeded),
             (.readFailed, .readFailed), (.writeFailed, .writeFailed):
            break
        default:
            XCTFail("Unexpected storage error: \(actual)", file: file, line: line)
        }
    }

    private func assertBlockedFileIsPreserved(_ original: Data, expected: DemoStorageError,
                                            file: StaticString = #filePath, line: UInt = #line) throws {
        let persistence = try makePersistence()
        try original.write(to: persistence.fileURL)
        assertBlocked(persistence.load(), expected: expected, file: file, line: line)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        guard case .blocked = store.persistenceState else {
            XCTFail("Blocked loads must pause saving", file: file, line: line)
            return
        }
        store.chatDraft = "仍在本次运行中编辑"
        store.newConversation()
        store.flushPersistence()
        XCTAssertEqual(try Data(contentsOf: persistence.fileURL), original, file: file, line: line)
        store.retryPersistence()
        XCTAssertEqual(try Data(contentsOf: persistence.fileURL), original, file: file, line: line)
        store.logout()
        XCTAssertEqual(try Data(contentsOf: persistence.fileURL), original, file: file, line: line)
        guard case .blocked = store.persistenceState else {
            XCTFail("Logout must not unlock a protected document", file: file, line: line)
            return
        }
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

    func testLoginAndLogoutClearEphemeralStateButRetainHistory() {
        let store = makeStore()
        store.login(email: " demo@example.com ")
        XCTAssertEqual(store.stage, .main)
        XCTAssertEqual(store.profileEmail, "demo@example.com")
        store.newConversation()
        let conversationIDs = store.conversations.map(\.id)
        let selectedID = store.selectedConversationID
        store.logout()
        XCTAssertEqual(store.stage, .login)
        XCTAssertEqual(store.profileEmail, "")
        XCTAssertEqual(store.selectedTab, .chat)
        XCTAssertEqual(store.conversations.count, 6)
        XCTAssertEqual(store.conversations.map(\.id), conversationIDs)
        XCTAssertEqual(store.selectedConversationID, selectedID)
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

    func testUnconfiguredPersistenceRemainsMemoryOnly() {
        let store = makeStore()
        store.chatDraft = "仅内存草稿"
        store.flushPersistence()
        store.retryPersistence()
        XCTAssertEqual(store.persistenceState, .memoryOnly)
        XCTAssertEqual(store.chatDraft, "仅内存草稿")
    }

    func testSnapshotRoundTripPreservesStableIDsDatesAndReferences() throws {
        let persistence = try makePersistence()
        var expected = makeSnapshot()
        expected.pendingReplyConversationIDs = [expected.selectedConversationID]
        try persistence.save(expected)
        guard case .loaded(let actual, let migrated) = persistence.load() else {
            return XCTFail("Expected the saved snapshot to load")
        }
        XCTAssertFalse(migrated)
        XCTAssertEqual(actual.schemaVersion, DemoSnapshot.currentVersion)
        XCTAssertEqual(actual.savedAt, expected.savedAt)
        XCTAssertEqual(actual.selectedConversationID, expected.selectedConversationID)
        XCTAssertEqual(actual.pendingReplyConversationIDs, expected.pendingReplyConversationIDs)
        XCTAssertEqual(actual.conversations.map(\.id), expected.conversations.map(\.id))
        XCTAssertEqual(actual.conversations.map(\.title), expected.conversations.map(\.title))
        XCTAssertEqual(actual.conversations.map(\.subtitle), expected.conversations.map(\.subtitle))
        let actualMessages = actual.conversations.flatMap(\.messages)
        let expectedMessages = expected.conversations.flatMap(\.messages)
        XCTAssertEqual(actualMessages.map(\.id), expectedMessages.map(\.id))
        XCTAssertEqual(actualMessages.map(\.date), expectedMessages.map(\.date))
        XCTAssertEqual(actualMessages.map(\.role), expectedMessages.map(\.role))
        XCTAssertEqual(actualMessages.map(\.text), expectedMessages.map(\.text))
        XCTAssertEqual(actualMessages.map(\.replyTo), expectedMessages.map(\.replyTo))
        XCTAssertEqual(actualMessages.map(\.approvalID), expectedMessages.map(\.approvalID))
        XCTAssertEqual(actual.approvals.map(\.id), expected.approvals.map(\.id))
        XCTAssertEqual(actual.approvals.map(\.status), expected.approvals.map(\.status))
        XCTAssertEqual(actual.approvals.map(\.title), expected.approvals.map(\.title))
        XCTAssertEqual(actual.approvals.map(\.detail), expected.approvals.map(\.detail))
        XCTAssertEqual(actual.drafts.map(\.conversationID), expected.drafts.map(\.conversationID))
        XCTAssertEqual(actual.drafts.map(\.value), expected.drafts.map(\.value))
    }

    func testRestartRestoresDraftsSelectionAndApprovalWithoutAuthentication() throws {
        let persistence = try makePersistence()
        let defaults = makeDefaults()
        let first = AppStore(defaults: defaults, persistence: persistence)
        first.finishOnboarding()
        first.login(email: "private-session@example.com")
        let firstID = first.selectedConversationID
        first.chatDraft = "第一份未发送草稿"
        first.replyQuote = "重启后保留引用"
        let approvalID = try XCTUnwrap(first.approvals.first).id
        first.decideApproval(id: approvalID, approved: false)
        first.newConversation()
        let secondID = first.selectedConversationID
        first.chatDraft = "第二份未发送草稿"
        first.flushPersistence()

        let next = AppStore(defaults: defaults, persistence: persistence)
        XCTAssertEqual(next.stage, .splash)
        next.finishSplash()
        XCTAssertEqual(next.stage, .login)
        XCTAssertEqual(next.profileEmail, "")
        XCTAssertEqual(next.conversations.map(\.id), first.conversations.map(\.id))
        XCTAssertEqual(next.selectedConversationID, secondID)
        XCTAssertEqual(next.chatDraft, "第二份未发送草稿")
        XCTAssertEqual(next.draft(for: firstID),
                       ComposerDraft(text: "第一份未发送草稿", replyTo: "重启后保留引用"))
        XCTAssertEqual(next.approvals.first(where: { $0.id == approvalID })?.status, .rejected)
        XCTAssertTrue(next.respondingConversationIDs.isEmpty)
        let data = try Data(contentsOf: persistence.fileURL)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(object.keys), Set(["schemaVersion", "savedAt", "conversations", "approvals",
                                              "drafts", "selectedConversationID", "pendingReplyConversationIDs"]))
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("private-session@example.com"))
    }

    func testLegacyDraftlessSnapshotMigratesAndArchivesBeforeNextSave() throws {
        let persistence = try makePersistence()
        let fixture = makeSnapshot()
        let legacy = LegacyDemoSnapshotV1(savedAt: fixture.savedAt,
                                           conversations: fixture.conversations,
                                           approvals: fixture.approvals,
                                           selectedConversationID: fixture.selectedConversationID)
        let original = try JSONEncoder().encode(legacy)
        try original.write(to: persistence.fileURL)
        guard case .loaded(let migrated, let didMigrate) = persistence.load() else {
            return XCTFail("Expected the documented version 1 fixture to migrate")
        }
        XCTAssertTrue(didMigrate)
        XCTAssertEqual(migrated.schemaVersion, 2)
        XCTAssertTrue(migrated.drafts.isEmpty)
        XCTAssertTrue(migrated.pendingReplyConversationIDs.isEmpty)
        XCTAssertEqual(migrated.conversations.map(\.id), fixture.conversations.map(\.id))
        XCTAssertEqual(migrated.savedAt, fixture.savedAt)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        XCTAssertEqual(store.chatDraft, "")
        XCTAssertNotNil(store.recoveryNote)
        XCTAssertEqual(try Data(contentsOf: persistence.fileURL), original)
        store.chatDraft = "迁移后的草稿"
        store.flushPersistence()
        guard case .loaded(let current, let migratedAgain) = persistence.load() else {
            return XCTFail("Expected migration to save a version 2 document")
        }
        XCTAssertFalse(migratedAgain)
        XCTAssertEqual(current.schemaVersion, DemoSnapshot.currentVersion)
        XCTAssertEqual(current.drafts.first?.value.text, "迁移后的草稿")
        let archives = try recoveryArchives(in: persistence)
        XCTAssertEqual(archives.count, 1)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(archives.first)), original)
    }

    func testMalformedFileSurvivesMutationsRetryAndLogout() throws {
        try assertBlockedFileIsPreserved(Data("{ incomplete JSON".utf8), expected: .invalidDocument)
    }

    func testUnsupportedVersionSurvivesMutationsRetryAndLogout() throws {
        try assertBlockedFileIsPreserved(Data("{\"schemaVersion\":999}".utf8),
                                        expected: .unsupportedVersion(999))
    }

    func testOversizedFileSurvivesMutationsRetryAndLogout() throws {
        let oversized = Data(repeating: 0x20, count: FileDemoPersistence.maximumBytes + 1)
        try assertBlockedFileIsPreserved(oversized, expected: .fileTooLarge)
    }

    func testInvalidRelationshipsAreRejectedWithoutOverwritingOriginal() throws {
        var invalidSelection = makeSnapshot()
        invalidSelection.selectedConversationID = UUID()
        var invalidApproval = makeSnapshot()
        invalidApproval.conversations[0].messages[0].approvalID = UUID()
        var invalidDraft = makeSnapshot()
        invalidDraft.drafts[0].conversationID = UUID()
        var invalidPendingReply = makeSnapshot()
        invalidPendingReply.pendingReplyConversationIDs = [UUID()]
        var duplicateMessage = makeSnapshot()
        duplicateMessage.conversations[1].messages.append(duplicateMessage.conversations[0].messages[0])
        var duplicateDraft = makeSnapshot()
        duplicateDraft.drafts.append(duplicateDraft.drafts[0])
        for invalid in [invalidSelection, invalidApproval, invalidDraft, invalidPendingReply,
                        duplicateMessage, duplicateDraft] {
            try assertBlockedFileIsPreserved(JSONEncoder().encode(invalid), expected: .invalidDocument)
        }
    }

    func testInvalidSnapshotCannotReplacePreviouslyValidFile() throws {
        let persistence = try makePersistence()
        try persistence.save(makeSnapshot())
        let original = try Data(contentsOf: persistence.fileURL)
        var invalid = makeSnapshot()
        invalid.conversations.removeAll()
        XCTAssertThrowsError(try persistence.save(invalid))
        XCTAssertEqual(try Data(contentsOf: persistence.fileURL), original)
    }

    func testUnreadableAttributesAreBlockedRatherThanTreatedAsMissing() throws {
        let readable = try makePersistence()
        try readable.save(makeSnapshot())
        let original = try Data(contentsOf: readable.fileURL)
        let inaccessible = FileDemoPersistence(directory: readable.directory,
                                                fileManager: PermissionDeniedFileManager())
        assertBlocked(inaccessible.load(), expected: .readFailed)
        XCTAssertThrowsError(try inaccessible.archiveCurrent())
        let store = AppStore(defaults: makeDefaults(), persistence: inaccessible)
        let conversationIDs = store.conversations.map(\.id)
        store.chatDraft = "权限恢复前不能覆盖"
        store.flushPersistence()
        XCTAssertFalse(store.resetLocalDemo())
        XCTAssertEqual(store.conversations.map(\.id), conversationIDs)
        XCTAssertEqual(store.chatDraft, "权限恢复前不能覆盖")
        XCTAssertEqual(try Data(contentsOf: readable.fileURL), original)
        XCTAssertTrue(try recoveryArchives(in: readable).isEmpty)
        guard case .blocked = store.persistenceState else {
            return XCTFail("An unreadable document must remain protected")
        }
    }

    func testOversizedDraftAndQuoteRejectSendWithoutDiscardingComposer() {
        let store = makeStore()
        let originalMessageIDs = store.messages.map(\.id)
        let oversized = String(repeating: "界", count: 33_334)
        store.chatDraft = oversized
        store.replyQuote = "保留引用"
        XCTAssertFalse(store.sendDraft())
        XCTAssertEqual(store.chatDraft, oversized)
        XCTAssertEqual(store.replyQuote, "保留引用")
        XCTAssertEqual(store.messages.map(\.id), originalMessageIDs)
        XCTAssertTrue(store.respondingConversationIDs.isEmpty)
        store.chatDraft = "正常长度的草稿"
        store.replyQuote = oversized
        XCTAssertFalse(store.sendDraft())
        XCTAssertEqual(store.chatDraft, "正常长度的草稿")
        XCTAssertEqual(store.replyQuote, oversized)
        XCTAssertEqual(store.messages.map(\.id), originalMessageIDs)
        XCTAssertTrue(store.respondingConversationIDs.isEmpty)
    }

    func testConversationLimitPreservesSelectionAndDraft() throws {
        let persistence = try makePersistence()
        var fixture = makeSnapshot()
        for index in 0..<198 {
            fixture.conversations.append(Conversation(id: UUID(), title: "会话 \(index)",
                                                      subtitle: "容量测试", messages: []))
        }
        try persistence.save(fixture)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        store.chatDraft = "不能因为达到上限而丢失"
        let originalIDs = store.conversations.map(\.id)
        let selectedID = store.selectedConversationID
        store.newConversation()
        XCTAssertEqual(store.conversations.count, 200)
        XCTAssertEqual(store.conversations.map(\.id), originalIDs)
        XCTAssertEqual(store.selectedConversationID, selectedID)
        XCTAssertEqual(store.chatDraft, "不能因为达到上限而丢失")
        XCTAssertNotNil(store.toast)
        store.flushPersistence()
        XCTAssertEqual(try loadedSnapshot(persistence).conversations.count, 200)
    }

    func testOversizedDraftPreservesLastGoodFileAndSavesAfterShortening() throws {
        let persistence = try makePersistence()
        try persistence.save(makeSnapshot())
        let original = try Data(contentsOf: persistence.fileURL)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        let oversized = String(repeating: "x", count: 100_001)
        store.chatDraft = oversized
        store.flushPersistence()
        guard case .failed = store.persistenceState else { return XCTFail("Expected a capacity failure") }
        XCTAssertEqual(store.chatDraft, oversized)
        XCTAssertEqual(try Data(contentsOf: persistence.fileURL), original)
        store.chatDraft = "缩短后的草稿"
        store.retryPersistence()
        guard case .saved = store.persistenceState else { return XCTFail("Shortening should allow a retry") }
        let saved = try loadedSnapshot(persistence)
        XCTAssertEqual(saved.drafts.first(where: { $0.conversationID == store.selectedConversationID })?.value.text,
                       "缩短后的草稿")
    }

    func testFullMessageHistoryRejectsSendNewConversationAndCallSummarySafely() throws {
        let persistence = try makePersistence()
        var fixture = makeSnapshot()
        let currentCount = fixture.conversations.reduce(0) { $0 + $1.messages.count }
        let fillerMessages = (currentCount..<20_000).map { index in
            ChatMessage(role: .assistant, text: "历史 \(index)", date: fixture.savedAt)
        }
        fixture.conversations[0].messages.append(contentsOf: fillerMessages)
        try persistence.save(fixture)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        let selectedID = store.selectedConversationID
        let conversationIDs = store.conversations.map(\.id)
        let messageIDs = store.conversations.flatMap(\.messages).map(\.id)
        store.chatDraft = "达到上限时保留的草稿"
        store.replyQuote = "保留引用"
        XCTAssertFalse(store.sendDraft())
        store.newConversation()
        store.addCallSummary("不能挤掉已有历史的通话摘要")
        XCTAssertEqual(store.selectedConversationID, selectedID)
        XCTAssertEqual(store.conversations.map(\.id), conversationIDs)
        XCTAssertEqual(store.conversations.flatMap(\.messages).map(\.id), messageIDs)
        XCTAssertEqual(store.chatDraft, "达到上限时保留的草稿")
        XCTAssertEqual(store.replyQuote, "保留引用")
        XCTAssertTrue(store.respondingConversationIDs.isEmpty)
        store.flushPersistence()
        XCTAssertEqual(try loadedSnapshot(persistence).conversations.flatMap(\.messages).count, 20_000)
    }

    func testCallSummaryImmediatelyPersistsBeforeReturning() throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        let selectedID = store.selectedConversationID
        store.selectedTab = .library
        store.addCallSummary("离开应用时结束的本地通话摘要")
        XCTAssertEqual(store.selectedTab, .chat)
        XCTAssertEqual(persistence.saveAttempts, 1)
        guard case .saved = store.persistenceState else {
            return XCTFail("A lifecycle call summary must flush before returning")
        }
        let saved = try loadedSnapshot(persistence.base)
        let conversation = try XCTUnwrap(saved.conversations.first { $0.id == selectedID })
        XCTAssertEqual(conversation.messages.last?.text, "离开应用时结束的本地通话摘要")
        XCTAssertEqual(conversation.messages.last?.id, store.messages.last?.id)
        XCTAssertEqual(conversation.messages.last?.date, store.messages.last?.date)
        XCTAssertEqual(conversation.subtitle, "离开应用时结束的本地通话摘要")
    }

    func testOverCapacityDocumentIsBlockedWithoutOverwritingOriginal() throws {
        var invalid = makeSnapshot()
        invalid.drafts[0].value.text = String(repeating: "x", count: 100_001)
        try assertBlockedFileIsPreserved(JSONEncoder().encode(invalid), expected: .capacityExceeded)
    }

    func testInjectedInvalidLoadedSnapshotIsAlsoBlocked() throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        var invalid = makeSnapshot()
        invalid.selectedConversationID = UUID()
        persistence.loadOverride = .loaded(invalid, migrated: false)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        guard case .blocked = store.persistenceState else {
            return XCTFail("AppStore must validate injected snapshots before applying them")
        }
        XCTAssertNotEqual(store.selectedConversationID, invalid.selectedConversationID)
        store.chatDraft = "不能覆盖原记录"
        store.flushPersistence()
        XCTAssertEqual(persistence.saveAttempts, 0)
    }

    func testBlockedLoadDoesNotAutosaveAfterDebounce() async throws {
        let persistence = try makePersistence()
        let original = Data("{ broken".utf8)
        try original.write(to: persistence.fileURL)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        store.chatDraft = "临时草稿"
        store.newConversation()
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertEqual(try Data(contentsOf: persistence.fileURL), original)
        guard case .blocked = store.persistenceState else {
            return XCTFail("A blocked document must remain protected after the debounce interval")
        }
    }

    func testCleanBlockedRetryCanReloadRecoveredFile() throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        let fixture = makeSnapshot()
        try persistence.base.save(fixture)
        persistence.loadOverride = .blocked(.readFailed)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        guard case .blocked = store.persistenceState else { return XCTFail("Expected a read failure") }
        persistence.loadOverride = nil
        store.retryPersistence()
        XCTAssertEqual(persistence.loadAttempts, 2)
        XCTAssertEqual(persistence.saveAttempts, 0)
        XCTAssertEqual(store.selectedConversationID, fixture.selectedConversationID)
        XCTAssertEqual(store.chatDraft, "第二个草稿")
        guard case .saved = store.persistenceState else { return XCTFail("Expected successful recovery") }
    }

    func testDirtyBlockedRetryRefusesToDiscardNewSessionChanges() throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        let fixture = makeSnapshot()
        try persistence.base.save(fixture)
        let original = try Data(contentsOf: persistence.base.fileURL)
        persistence.loadOverride = .blocked(.readFailed)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        let temporaryID = store.selectedConversationID
        store.chatDraft = "这次运行中新写的内容"
        persistence.loadOverride = nil
        store.retryPersistence()
        XCTAssertEqual(persistence.loadAttempts, 1)
        XCTAssertEqual(persistence.saveAttempts, 0)
        XCTAssertEqual(store.selectedConversationID, temporaryID)
        XCTAssertEqual(store.chatDraft, "这次运行中新写的内容")
        XCTAssertNotNil(store.toast)
        XCTAssertEqual(try Data(contentsOf: persistence.base.fileURL), original)
        guard case .blocked = store.persistenceState else { return XCTFail("Protection must remain active") }
    }

    func testWriteFailurePreservesDiskAndMemoryAndRetrySavesLatestDraft() throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        try persistence.base.save(makeSnapshot())
        let original = try Data(contentsOf: persistence.base.fileURL)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        let selectedID = store.selectedConversationID
        store.chatDraft = "未能写入的新草稿"
        store.replyQuote = "关联的引用"
        persistence.failSaves = true
        store.flushPersistence()
        guard case .failed = store.persistenceState else { return XCTFail("Expected a visible save failure") }
        XCTAssertEqual(persistence.saveAttempts, 1)
        XCTAssertEqual(store.chatDraft, "未能写入的新草稿")
        XCTAssertEqual(try Data(contentsOf: persistence.base.fileURL), original)
        persistence.failSaves = false
        store.retryPersistence()
        XCTAssertEqual(persistence.saveAttempts, 2)
        guard case .saved = store.persistenceState else { return XCTFail("Expected retry to save successfully") }
        let next = AppStore(defaults: makeDefaults(), persistence: persistence.base)
        XCTAssertEqual(next.selectedConversationID, selectedID)
        XCTAssertEqual(next.chatDraft, "未能写入的新草稿")
        XCTAssertEqual(next.replyQuote, "关联的引用")
    }

    func testDebouncedMutationsCoalesceAndLifecycleFlushCancelsPendingSave() async throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        store.chatDraft = "一"
        store.chatDraft = "一二"
        store.chatDraft = "一二三"
        store.replyQuote = "引用"
        XCTAssertEqual(persistence.saveAttempts, 0)
        XCTAssertEqual(store.persistenceState, .pending)
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertEqual(persistence.saveAttempts, 1)
        XCTAssertEqual(try loadedSnapshot(persistence).drafts.first?.value.text, "一二三")
        store.chatDraft = "离开前的最后改动"
        store.flushPersistence()
        XCTAssertEqual(persistence.saveAttempts, 2)
        XCTAssertEqual(try loadedSnapshot(persistence).drafts.first?.value.text, "离开前的最后改动")
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertEqual(persistence.saveAttempts, 2)
    }

    func testLogoutFlushesClearedDraftsButRetainsConversationAndApprovalHistory() throws {
        let persistence = try makePersistence()
        let defaults = makeDefaults()
        let store = AppStore(defaults: defaults, persistence: persistence)
        store.finishOnboarding()
        store.login(email: "ephemeral@example.com")
        let firstID = store.selectedConversationID
        let approvalID = try XCTUnwrap(store.approvals.first).id
        store.decideApproval(id: approvalID, approved: true)
        store.chatDraft = "退出前的第一个草稿"
        store.replyQuote = "第一个引用"
        store.newConversation()
        let secondID = store.selectedConversationID
        XCTAssertTrue(store.send("保留这条已发送的消息"))
        let sentMessageID = try XCTUnwrap(store.messages.last).id
        store.chatDraft = "退出前的第二个草稿"
        store.flushPersistence()
        XCTAssertFalse(try loadedSnapshot(persistence).drafts.isEmpty)
        let conversationIDs = store.conversations.map(\.id)
        store.logout()
        let next = AppStore(defaults: defaults, persistence: persistence)
        next.finishSplash()
        XCTAssertEqual(next.stage, .login)
        XCTAssertEqual(next.profileEmail, "")
        XCTAssertEqual(next.conversations.map(\.id), conversationIDs)
        XCTAssertEqual(next.selectedConversationID, secondID)
        XCTAssertEqual(next.messages.last?.id, sentMessageID)
        XCTAssertEqual(next.messages.last?.role, .user)
        XCTAssertEqual(next.draft(for: firstID), ComposerDraft())
        XCTAssertEqual(next.draft(for: secondID), ComposerDraft())
        XCTAssertEqual(next.approvals.first(where: { $0.id == approvalID })?.status, .approved)
        let saved = try loadedSnapshot(persistence)
        XCTAssertTrue(saved.drafts.isEmpty)
        XCTAssertTrue(saved.pendingReplyConversationIDs.isEmpty)
    }

    func testResetArchivesExistingFileBeforeReplacingData() throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        let fixture = makeSnapshot()
        try persistence.base.save(fixture)
        let original = try Data(contentsOf: persistence.base.fileURL)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        store.login(email: "session@example.com")
        XCTAssertTrue(store.resetLocalDemo())
        XCTAssertEqual(persistence.operations, ["load", "archive", "save"])
        XCTAssertEqual(store.stage, .main)
        XCTAssertEqual(store.profileEmail, "session@example.com")
        XCTAssertEqual(store.conversations.count, 5)
        XCTAssertEqual(store.approvals.count, 1)
        XCTAssertEqual(store.chatDraft, "")
        XCTAssertNil(store.replyQuote)
        XCTAssertFalse(store.conversations.contains { $0.id == fixture.selectedConversationID })
        let archives = try recoveryArchives(in: persistence.base)
        XCTAssertEqual(archives.count, 1)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(archives.first)), original)
        XCTAssertNotNil(store.recoveryNote)
        let replacement = try loadedSnapshot(persistence.base)
        XCTAssertEqual(replacement.conversations.map(\.id), store.conversations.map(\.id))
        XCTAssertTrue(replacement.drafts.isEmpty)
    }

    func testResetCanRecoverBlockedFileOnlyAfterArchivingItsOriginalBytes() throws {
        let persistence = try makePersistence()
        let original = Data("{\"schemaVersion\":999,\"futureData\":\"preserve me\"}".utf8)
        try original.write(to: persistence.fileURL)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        store.chatDraft = "临时改动"
        XCTAssertTrue(store.resetLocalDemo())
        let archives = try recoveryArchives(in: persistence)
        XCTAssertEqual(archives.count, 1)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(archives.first)), original)
        XCTAssertEqual(try loadedSnapshot(persistence).schemaVersion, DemoSnapshot.currentVersion)
        guard case .saved = store.persistenceState else { return XCTFail("Reset should release protection") }
        store.chatDraft = "重置后可以保存"
        store.flushPersistence()
        XCTAssertEqual(try loadedSnapshot(persistence).drafts.first?.value.text, "重置后可以保存")
    }

    func testArchiveFailureAbortsResetWithoutChangingSessionOrFile() throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        try persistence.base.save(makeSnapshot())
        let original = try Data(contentsOf: persistence.base.fileURL)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        store.login(email: "keep-session@example.com")
        store.chatDraft = "不能丢失的当前草稿"
        store.replyQuote = "不能丢失的引用"
        let conversationIDs = store.conversations.map(\.id)
        let messageIDs = store.conversations.flatMap(\.messages).map(\.id)
        let selectedID = store.selectedConversationID
        persistence.failArchives = true
        XCTAssertFalse(store.resetLocalDemo())
        XCTAssertEqual(persistence.operations, ["load", "archive"])
        XCTAssertEqual(store.stage, .main)
        XCTAssertEqual(store.profileEmail, "keep-session@example.com")
        XCTAssertEqual(store.conversations.map(\.id), conversationIDs)
        XCTAssertEqual(store.conversations.flatMap(\.messages).map(\.id), messageIDs)
        XCTAssertEqual(store.selectedConversationID, selectedID)
        XCTAssertEqual(store.chatDraft, "不能丢失的当前草稿")
        XCTAssertEqual(store.replyQuote, "不能丢失的引用")
        XCTAssertEqual(try Data(contentsOf: persistence.base.fileURL), original)
        XCTAssertTrue(try recoveryArchives(in: persistence.base).isEmpty)
        guard case .failed = store.persistenceState else { return XCTFail("Reset failure should be visible") }
    }

    func testReplacementWriteFailureKeepsSessionAndRecoveryArchive() throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        try persistence.base.save(makeSnapshot())
        let original = try Data(contentsOf: persistence.base.fileURL)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        store.login(email: "keep-session@example.com")
        store.chatDraft = "重置失败后仍保留"
        let selectedID = store.selectedConversationID
        let conversationIDs = store.conversations.map(\.id)
        persistence.failSaves = true
        XCTAssertFalse(store.resetLocalDemo())
        XCTAssertEqual(persistence.operations, ["load", "archive", "save"])
        XCTAssertEqual(store.stage, .main)
        XCTAssertEqual(store.profileEmail, "keep-session@example.com")
        XCTAssertEqual(store.selectedConversationID, selectedID)
        XCTAssertEqual(store.conversations.map(\.id), conversationIDs)
        XCTAssertEqual(store.chatDraft, "重置失败后仍保留")
        XCTAssertEqual(try Data(contentsOf: persistence.base.fileURL), original)
        let archives = try recoveryArchives(in: persistence.base)
        XCTAssertEqual(archives.count, 1)
        XCTAssertEqual(try Data(contentsOf: XCTUnwrap(archives.first)), original)
        persistence.failSaves = false
        store.retryPersistence()
        let recovered = try loadedSnapshot(persistence.base)
        XCTAssertEqual(recovered.selectedConversationID, selectedID)
        XCTAssertEqual(recovered.drafts.first(where: { $0.conversationID == selectedID })?.value.text,
                       "重置失败后仍保留")
    }

    func testResetFailureFromCleanStateRetriesSavingExistingSessionWithoutResetting() throws {
        let persistence = FaultInjectingPersistence(base: try makePersistence())
        let fixture = makeSnapshot()
        try persistence.base.save(fixture)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        guard case .saved = store.persistenceState else { return XCTFail("Expected a clean restored session") }
        persistence.failArchives = true
        XCTAssertFalse(store.resetLocalDemo())
        XCTAssertEqual(persistence.saveAttempts, 0)
        persistence.failArchives = false
        store.retryPersistence()
        XCTAssertEqual(persistence.operations, ["load", "archive", "save"])
        XCTAssertEqual(persistence.saveAttempts, 1)
        XCTAssertEqual(store.conversations.map(\.id), fixture.conversations.map(\.id))
        XCTAssertEqual(store.selectedConversationID, fixture.selectedConversationID)
        XCTAssertEqual(store.chatDraft, "第二个草稿")
        XCTAssertTrue(try recoveryArchives(in: persistence.base).isEmpty)
        guard case .saved = store.persistenceState else { return XCTFail("Retry should save the existing session") }
        XCTAssertEqual(try loadedSnapshot(persistence.base).conversations.map(\.id), fixture.conversations.map(\.id))
    }

    func testPendingReplyRestartPreservesSentMessageWithoutAutoReply() async throws {
        let persistence = try makePersistence()
        var fixture = makeSnapshot()
        let userMessage = ChatMessage(id: UUID(), role: .user, text: "发送这份摘要", date: fixture.savedAt)
        fixture.conversations[1].messages.append(userMessage)
        fixture.pendingReplyConversationIDs = [fixture.selectedConversationID]
        try persistence.save(fixture)
        let store = AppStore(defaults: makeDefaults(), persistence: persistence)
        XCTAssertEqual(store.stage, .splash)
        XCTAssertEqual(store.profileEmail, "")
        XCTAssertTrue(store.respondingConversationIDs.isEmpty)
        XCTAssertFalse(store.isResponding)
        XCTAssertNotNil(store.recoveryNote)
        XCTAssertEqual(store.messages.last?.id, userMessage.id)
        XCTAssertEqual(store.messages.last?.date, userMessage.date)
        let messageIDs = store.messages.map(\.id)
        let approvalIDs = store.approvals.map(\.id)
        try await Task.sleep(nanoseconds: 1_100_000_000)
        XCTAssertEqual(store.messages.map(\.id), messageIDs)
        XCTAssertEqual(store.approvals.map(\.id), approvalIDs)
        XCTAssertTrue(store.respondingConversationIDs.isEmpty)
        store.chatDraft = "接着编辑，但不自动发送"
        store.flushPersistence()
        let saved = try loadedSnapshot(persistence)
        XCTAssertTrue(saved.pendingReplyConversationIDs.isEmpty)
        XCTAssertEqual(saved.conversations[1].messages.last?.id, userMessage.id)
    }

    private func recoveryArchives(in persistence: FileDemoPersistence) throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: persistence.directory,
                                                    includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("recovery-") }
    }

    func testEmailValidation() {
        XCTAssertTrue(LoginValidation.isValidEmail("demo@example.com"))
        XCTAssertTrue(LoginValidation.isValidEmail("hello+test@aria.example"))
        XCTAssertFalse(LoginValidation.isValidEmail(""))
        XCTAssertFalse(LoginValidation.isValidEmail("not-an-email"))
        XCTAssertFalse(LoginValidation.isValidEmail("a@b"))
        XCTAssertFalse(LoginValidation.isValidEmail("a b@example.com"))
    }

    func testCloudEndpointUsesOnlyOwnSecureOrigin() throws {
        let endpoint = try CloudVoiceEndpoint(" https://aria.example/api/ ")
        XCTAssertEqual(endpoint.baseURL.absoluteString, "https://aria.example/api")
        XCTAssertEqual(endpoint.socketURL.absoluteString, "wss://aria.example/api/voice/session")
        XCTAssertEqual(endpoint.url("auth/login").absoluteString, "https://aria.example/api/auth/login")
    }

    func testCloudEndpointRejectsUnsafeOrCredentialURLs() {
        for value in ["http://aria.example", "wss://aria.example", "https://user:pass@aria.example",
                      "https://aria.example/api?token=secret", "https://aria.example/#token",
                      "https://aria.example/a/../b", "https://aria.example/%2e%2e",
                      "https://aria.example/api%2fother", "https://aria.example:0"] {
            XCTAssertThrowsError(try CloudVoiceEndpoint(value), value)
        }
    }

    func testCloudApprovalURLNeverIncludesCredentials() throws {
        let endpoint = try CloudVoiceEndpoint("https://aria.example/api")
        XCTAssertEqual(endpoint.approvalURL(conversationID: 42).absoluteString,
                       "https://aria.example/chat?conversation=42")
    }

    func testVoicePCMEnvelopeRoundTrip() throws {
        let id = UUID(uuidString: "00112233-4455-6677-8899-aabbccddeeff")!
        let frame = VoicePCMEnvelope(kind: 1, streamID: id, sequence: 0x01020304,
                                     pcm: Data(repeating: 0, count: 640))
        let encoded = try frame.encoded()
        XCTAssertEqual(encoded.count, 668)
        XCTAssertEqual(Array(encoded.prefix(8)), [65, 82, 86, 49, 1, 0, 0, 0])
        XCTAssertEqual(Array(encoded[8..<24]), [0,17,34,51,68,85,102,119,136,153,170,187,204,221,238,255])
        XCTAssertEqual(Array(encoded[24..<28]), [1,2,3,4])
        XCTAssertEqual(try VoicePCMEnvelope.decode(encoded), frame)
    }

    func testVoicePCMEnvelopeRejectsMalformedHeaders() throws {
        let valid = try VoicePCMEnvelope(kind: 2, streamID: UUID(), sequence: 0,
                                          pcm: Data([0,0])).encoded()
        for index in [0, 4, 5, 6, 7] {
            var data = valid
            data[index] = 255
            XCTAssertThrowsError(try VoicePCMEnvelope.decode(data))
        }
        XCTAssertThrowsError(try VoicePCMEnvelope.decode(Data(valid.prefix(28))))
        XCTAssertThrowsError(try VoicePCMEnvelope.decode(Data(valid.dropLast())))
    }

    func testVoicePCMEnvelopeBoundsPCM() {
        for count in [0, 1, 65_538] {
            XCTAssertThrowsError(try VoicePCMEnvelope(kind: 1, streamID: UUID(), sequence: 0,
                                                       pcm: Data(repeating: 0, count: count)).encoded())
        }
        XCTAssertThrowsError(try VoicePCMEnvelope(kind: 3, streamID: UUID(), sequence: 0,
                                                   pcm: Data([0,0])).encoded())
    }

    func testVoicePCMEnvelopeAcceptsMaximumEvenPayload() throws {
        let frame = VoicePCMEnvelope(kind: 2, streamID: UUID(), sequence: UInt32.max,
                                     pcm: Data(repeating: 1, count: 65_536))
        XCTAssertEqual(try VoicePCMEnvelope.decode(frame.encoded()), frame)
    }

    func testMockRepliesAreDeterministic() {
        XCTAssertEqual(MockReplies.reply(to: "总结周报"), MockReplies.reply(to: "总结周报"))
        XCTAssertTrue(MockReplies.reply(to: "发送摘要").contains("审批"))
    }
}

/// Simulates storage failures without altering production storage or requiring special permissions.
private final class FaultInjectingPersistence: DemoPersistence {
    let base: FileDemoPersistence
    var failSaves = false
    var failArchives = false
    var loadOverride: DemoLoadResult?
    private(set) var loadAttempts = 0
    private(set) var saveAttempts = 0
    private(set) var operations: [String] = []

    init(base: FileDemoPersistence) { self.base = base }

    func load() -> DemoLoadResult {
        loadAttempts += 1
        operations.append("load")
        return loadOverride ?? base.load()
    }

    func save(_ snapshot: DemoSnapshot) throws {
        saveAttempts += 1
        operations.append("save")
        if failSaves { throw DemoStorageError.writeFailed }
        try base.save(snapshot)
    }

    func archiveCurrent() throws -> String? {
        operations.append("archive")
        if failArchives { throw DemoStorageError.writeFailed }
        return try base.archiveCurrent()
    }
}

/// Models file protection/permission denial, where existence cannot safely be inferred.
private final class PermissionDeniedFileManager: FileManager, @unchecked Sendable {
    override func attributesOfItem(atPath path: String) throws -> [FileAttributeKey: Any] {
        throw NSError(domain: NSCocoaErrorDomain, code: CocoaError.Code.fileReadNoPermission.rawValue)
    }
}
