import Foundation

/// A local demo document, never an account/session or a credential store.
struct DemoSnapshot: Codable {
    static let currentVersion = 2
    var schemaVersion = currentVersion
    var savedAt = Date()
    var conversations: [Conversation]
    var approvals: [ApprovalItem]
    var drafts: [DraftRecord]
    var selectedConversationID: UUID
    var pendingReplyConversationIDs: [UUID] = []

    struct DraftRecord: Codable {
        var conversationID: UUID
        var value: ComposerDraft
    }

    func validate() throws {
        let conversationIDs = Set(conversations.map(\.id))
        let approvalIDs = Set(approvals.map(\.id))
        let messages = conversations.flatMap(\.messages)
        guard schemaVersion == Self.currentVersion,
              !conversations.isEmpty,
              conversationIDs.count == conversations.count,
              conversationIDs.contains(selectedConversationID),
              approvalIDs.count == approvals.count,
              Set(messages.map(\.id)).count == messages.count,
              drafts.count <= conversations.count,
              Set(drafts.map(\.conversationID)).count == drafts.count,
              drafts.allSatisfy({ conversationIDs.contains($0.conversationID) }),
              pendingReplyConversationIDs.count <= conversations.count,
              Set(pendingReplyConversationIDs).count == pendingReplyConversationIDs.count,
              pendingReplyConversationIDs.allSatisfy({ conversationIDs.contains($0) }),
              messages.allSatisfy({ $0.approvalID == nil || approvalIDs.contains($0.approvalID!) }) else {
            throw DemoStorageError.invalidDocument
        }
        let texts = conversations.flatMap { [$0.title, $0.subtitle] }
            + messages.flatMap { [$0.text, $0.replyTo ?? ""] }
            + approvals.flatMap { [$0.title, $0.detail] }
            + drafts.flatMap { [$0.value.text, $0.value.replyTo ?? ""] }
        guard conversations.count <= 200, approvals.count <= 5_000, messages.count <= 20_000,
              texts.allSatisfy({ $0.utf8.count <= 100_000 }) else {
            throw DemoStorageError.capacityExceeded
        }
        guard savedAt.timeIntervalSinceReferenceDate.isFinite,
              messages.allSatisfy({ $0.date.timeIntervalSinceReferenceDate.isFinite }) else {
            throw DemoStorageError.invalidDocument
        }
    }
}

/// Version 1 is the documented draft-less compatibility fixture; no released build wrote it.
struct LegacyDemoSnapshotV1: Codable {
    var schemaVersion = 1
    var savedAt = Date()
    var conversations: [Conversation]
    var approvals: [ApprovalItem]
    var selectedConversationID: UUID

    var migrated: DemoSnapshot {
        DemoSnapshot(savedAt: savedAt, conversations: conversations, approvals: approvals,
                     drafts: [], selectedConversationID: selectedConversationID)
    }
}

enum DemoStorageError: Error {
    case unsupportedVersion(Int), invalidDocument, fileTooLarge, capacityExceeded, readFailed, writeFailed

    var explanation: String {
        switch self {
        case .unsupportedVersion(let version): return "本地记录来自不支持的版本（\(version)），原文件已保留。"
        case .invalidDocument: return "本地记录格式或关联不完整，原文件已保留。"
        case .fileTooLarge: return "本地记录超过演示容量限制，原文件已保留。"
        case .capacityExceeded: return "内容超过本地演示容量。请缩短未发送草稿后重试；不会自动删减已有内容。"
        case .readFailed: return "暂时无法读取本地记录，原文件没有改动。"
        case .writeFailed: return "未能保存最新改动，请重试；当前内容仍在本次运行中。"
        }
    }
}

enum DemoLoadResult {
    case empty
    case loaded(DemoSnapshot, migrated: Bool)
    case blocked(DemoStorageError)
}

protocol DemoPersistence {
    func load() -> DemoLoadResult
    func save(_ snapshot: DemoSnapshot) throws
    /// Copies the existing file before replacement. Never deletes a recovery copy.
    func archiveCurrent() throws -> String?
}

final class FileDemoPersistence: DemoPersistence {
    static let maximumBytes = 5 * 1_024 * 1_024
    let directory: URL
    var fileURL: URL { directory.appendingPathComponent("demo-state.json") }
    private let fileManager: FileManager

    init(directory: URL = URL.applicationSupportDirectory.appendingPathComponent("AriaDemo", isDirectory: true),
         fileManager: FileManager = .default) {
        self.directory = directory
        self.fileManager = fileManager
    }

    func load() -> DemoLoadResult {
        do {
            guard let attributes = try existingAttributes() else { return .empty }
            guard let size = attributes[.size] as? NSNumber,
                  size.intValue <= Self.maximumBytes else { throw DemoStorageError.fileTooLarge }
            let data = try Data(contentsOf: fileURL)
            guard data.count <= Self.maximumBytes else { throw DemoStorageError.fileTooLarge }
            struct Header: Decodable { let schemaVersion: Int }
            let decoder = JSONDecoder()
            let header = try decoder.decode(Header.self, from: data)
            let snapshot: DemoSnapshot
            let migrated: Bool
            switch header.schemaVersion {
            case DemoSnapshot.currentVersion:
                snapshot = try decoder.decode(DemoSnapshot.self, from: data)
                migrated = false
            case 1:
                snapshot = try decoder.decode(LegacyDemoSnapshotV1.self, from: data).migrated
                migrated = true
            default:
                throw DemoStorageError.unsupportedVersion(header.schemaVersion)
            }
            try snapshot.validate()
            return .loaded(snapshot, migrated: migrated)
        } catch let error as DemoStorageError {
            return .blocked(error)
        } catch is DecodingError {
            return .blocked(.invalidDocument)
        } catch {
            return .blocked(.readFailed)
        }
    }

    func save(_ snapshot: DemoSnapshot) throws {
        try snapshot.validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(snapshot)
        guard data.count <= Self.maximumBytes else { throw DemoStorageError.fileTooLarge }
        try prepareDirectory()
        // An interrupted replacement must leave the previously valid document intact.
        try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
    }

    func archiveCurrent() throws -> String? {
        guard try existingAttributes() != nil else { return nil }
        try prepareDirectory()
        let name = "recovery-\(UUID().uuidString).json"
        let destination = directory.appendingPathComponent(name)
        try fileManager.copyItem(at: fileURL, to: destination)
        try fileManager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: destination.path)
        return name
    }

    private func existingAttributes() throws -> [FileAttributeKey: Any]? {
        do {
            return try fileManager.attributesOfItem(atPath: fileURL.path)
        } catch {
            let error = error as NSError
            // Inaccessibility is not absence. Only a definite missing-file error permits creation.
            if error.domain == NSCocoaErrorDomain &&
                (error.code == CocoaError.Code.fileReadNoSuchFile.rawValue ||
                 error.code == CocoaError.Code.fileNoSuchFile.rawValue) { return nil }
            throw error
        }
    }

    private func prepareDirectory() throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        var directory = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
    }
}

enum LocalSaveState: Equatable {
    case memoryOnly, ready, pending, saved(Date), blocked(String), failed(String)

    var title: String {
        switch self {
        case .memoryOnly: return "仅本次运行"
        case .ready: return "本地保存已就绪"
        case .pending: return "等待保存"
        case .saved: return "已保存到本机"
        case .blocked: return "原记录已保护"
        case .failed: return "有未保存的改动"
        }
    }
    var detail: String {
        switch self {
        case .memoryOnly: return "当前未配置本地存储，关闭应用后不会保留演示内容。"
        case .ready: return "修改会保存在本机，重新打开后可继续演示。"
        case .pending: return "正在等待合并短时间内的改动；离开应用时会尝试立即保存。"
        case .saved(let date): return "最近保存：\(date.formatted(date: .abbreviated, time: .shortened))。不包含登录信息。"
        case .blocked(let explanation): return explanation + "为避免覆盖，自动保存已暂停。可重试读取，或先归档原记录再重置。"
        case .failed(let explanation): return explanation
        }
    }
    var needsAttention: Bool {
        switch self { case .blocked, .failed: return true; default: return false }
    }
    var canRetry: Bool { needsAttention }
}
