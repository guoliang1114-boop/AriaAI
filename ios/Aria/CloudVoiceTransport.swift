import Foundation

/// This value never reads demo settings, credentials, or conversation UUIDs.
struct CloudVoiceEndpoint: Equatable {
    let baseURL: URL

    init(_ value: String) throws {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: clean), parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              !parts.path.split(separator: "/").contains(".."),
              !parts.percentEncodedPath.lowercased().contains("%2f"),
              !parts.percentEncodedPath.lowercased().contains("%2e"),
              parts.port == nil || (1...65535).contains(parts.port!) else {
            throw CloudVoiceFailure.invalidEndpoint
        }
        parts.scheme = "https"
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        guard let url = parts.url else { throw CloudVoiceFailure.invalidEndpoint }
        baseURL = url
    }

    func url(_ path: String) -> URL {
        path.split(separator: "/").reduce(baseURL) { $0.appendingPathComponent(String($1)) }
    }

    var socketURL: URL {
        var parts = URLComponents(url: url("voice/session"), resolvingAgainstBaseURL: false)!
        parts.scheme = "wss"
        return parts.url!
    }

    /// Native Aria web chat owns approval review. Tokens are never put in URLs.
    func approvalURL(conversationID: Int) -> URL {
        var parts = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        // The deployed reverse proxy serves /api and the web app at the same origin.
        parts.path = "/chat"
        parts.queryItems = [URLQueryItem(name: "conversation", value: String(conversationID))]
        return parts.url!
    }
}

enum CloudVoiceFailure: Error, Equatable {
    case invalidEndpoint, invalidResponse, signedOut, forbidden, rateLimited, unavailable

    var explanation: String {
        switch self {
        case .invalidEndpoint: return "请输入自己的 Aria HTTPS API 地址，不要包含账号、查询参数或片段。"
        case .invalidResponse: return "服务器返回了无法识别的数据。请确认 API 地址和服务版本。"
        case .signedOut: return "登录信息无效或已过期，请重新登录。"
        case .forbidden: return "此账号没有访问这个会话的权限。"
        case .rateLimited: return "请求过于频繁，请稍后重试。"
        case .unavailable: return "无法连接自己的 Aria 服务器，请检查网络、HTTPS 地址和服务状态。"
        }
    }
}

struct CloudVoiceUser: Decodable {
    let id: Int
    let email: String
    let display_name: String
}

struct CloudConversation: Decodable, Identifiable, Equatable {
    let id: Int
    let title: String
    let project_id: Int?
}

struct CloudTranscriptMessage: Decodable, Identifiable, Equatable {
    let id: Int
    let conversation_id: Int
    let role: String
    let content: String
}

private struct CloudLoginResponse: Decodable {
    let token: String
    let user: CloudVoiceUser
}

/// Reject every redirect, including same-host redirects. In particular, neither a
/// login body nor X-Auth-Token may follow a redirect to another origin or scheme.
private final class CloudNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor
final class CloudVoiceAPI {
    let endpoint: CloudVoiceEndpoint
    private let delegate: CloudNoRedirectDelegate
    private let session: URLSession
    private var token: String?
    private var closed = false

    init(endpoint: CloudVoiceEndpoint) {
        self.endpoint = endpoint
        let delegate = CloudNoRedirectDelegate()
        self.delegate = delegate
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }

    func login(email: String, password: String) async throws -> CloudVoiceUser {
        let body = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        let result: CloudLoginResponse = try await request("auth/login", method: "POST", body: body, authenticated: false)
        try Task.checkCancellation()
        guard !closed else { throw CloudVoiceFailure.signedOut }
        guard !result.token.isEmpty, result.token.utf8.count <= 8192, result.user.id > 0 else {
            throw CloudVoiceFailure.invalidResponse
        }
        token = result.token // Only this ephemeral API instance owns the credential.
        return result.user
    }

    func conversations() async throws -> [CloudConversation] {
        let items: [CloudConversation] = try await request("chat/conversations")
        guard items.allSatisfy({ $0.id > 0 }) else { throw CloudVoiceFailure.invalidResponse }
        return items
    }

    func createConversation() async throws -> CloudConversation {
        let body = try JSONSerialization.data(withJSONObject: ["title": "语音对话"])
        let item: CloudConversation = try await request("chat/conversations", method: "POST", body: body)
        guard item.id > 0 else { throw CloudVoiceFailure.invalidResponse }
        return item
    }

    func messages(conversationID: Int, beforeID: Int? = nil) async throws -> [CloudTranscriptMessage] {
        guard conversationID > 0 else { throw CloudVoiceFailure.invalidResponse }
        var query = [URLQueryItem(name: "limit", value: "50")]
        if let beforeID { query.append(URLQueryItem(name: "before_id", value: String(beforeID))) }
        let items: [CloudTranscriptMessage] = try await request("chat/conversations/\(conversationID)/messages", query: query)
        guard items.allSatisfy({ $0.id > 0 && $0.conversation_id == conversationID }) else {
            throw CloudVoiceFailure.invalidResponse
        }
        return items.sorted { $0.id < $1.id }
    }

    func makeVoiceSocket() throws -> URLSessionWebSocketTask {
        guard let token, !token.isEmpty else { throw CloudVoiceFailure.signedOut }
        var request = URLRequest(url: endpoint.socketURL)
        request.timeoutInterval = 20
        request.setValue(token, forHTTPHeaderField: "X-Auth-Token")
        let socket = session.webSocketTask(with: request)
        socket.maximumMessageSize = 128 * 1024
        return socket
    }

    func clearCredentials() {
        closed = true
        token = nil
        session.invalidateAndCancel()
    }

    /// Explicit logout/Close revokes this server token only. The temporary request
    /// is bounded to three seconds and local credentials are cleared in all cases.
    func revokeSession() async -> Bool {
        guard let token else { clearCredentials(); return true }
        var request = URLRequest(url: endpoint.url("auth/logout"))
        request.httpMethod = "POST"
        request.timeoutInterval = 3
        request.setValue(token, forHTTPHeaderField: "X-Auth-Token")
        clearCredentials()
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil
        config.urlCredentialStorage = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 3
        config.timeoutIntervalForResource = 3
        let revocation = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        defer { revocation.invalidateAndCancel() }
        do {
            let (bytes, response) = try await revocation.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let response = response as? HTTPURLResponse else { return false }
            // 401 also proves that this token is no longer accepted.
            return (200..<300).contains(response.statusCode) || response.statusCode == 401
        } catch { return false }
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil,
                                       authenticated: Bool = true, query: [URLQueryItem] = []) async throws -> T {
        var parts = URLComponents(url: endpoint.url(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { parts.queryItems = query }
        var request = URLRequest(url: parts.url!)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if authenticated {
            guard let token, !token.isEmpty else { throw CloudVoiceFailure.signedOut }
            request.setValue(token, forHTTPHeaderField: "X-Auth-Token")
        }
        do {
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let response = response as? HTTPURLResponse else { throw CloudVoiceFailure.invalidResponse }
            switch response.statusCode {
            case 200..<300: break
            case 401: token = nil; throw CloudVoiceFailure.signedOut
            case 403: throw CloudVoiceFailure.forbidden
            case 429: throw CloudVoiceFailure.rateLimited
            default: throw CloudVoiceFailure.unavailable
            }
            var data = Data()
            for try await byte in bytes {
                guard data.count < 8 * 1024 * 1024 else { throw CloudVoiceFailure.invalidResponse }
                data.append(byte)
            }
            do { return try JSONDecoder().decode(T.self, from: data) }
            catch { throw CloudVoiceFailure.invalidResponse }
        } catch is CancellationError { throw CancellationError() }
        catch let error as CloudVoiceFailure { throw error }
        catch { throw CloudVoiceFailure.unavailable }
    }
}

/// ARV1 wire bytes: magic(4), kind(1), flags(1), reserved-BE(2), UUID(16), sequence-BE(4).
struct VoicePCMEnvelope: Equatable {
    static let headerBytes = 28
    let kind: UInt8
    let streamID: UUID
    let sequence: UInt32
    let pcm: Data

    func encoded() throws -> Data {
        guard (kind == 1 || kind == 2), !pcm.isEmpty, pcm.count % 2 == 0,
              pcm.count <= 65_536 else { throw CloudVoiceFailure.invalidResponse }
        var data = Data([0x41, 0x52, 0x56, 0x31, kind, 0, 0, 0])
        var uuid = streamID.uuid
        withUnsafeBytes(of: &uuid) { data.append(contentsOf: $0) }
        data.append(contentsOf: [UInt8((sequence >> 24) & 255), UInt8((sequence >> 16) & 255),
                                UInt8((sequence >> 8) & 255), UInt8(sequence & 255)])
        data.append(pcm)
        return data
    }

    static func decode(_ data: Data) throws -> VoicePCMEnvelope {
        guard data.count > headerBytes, data.count <= headerBytes + 65_536 else {
            throw CloudVoiceFailure.invalidResponse
        }
        let bytes = [UInt8](data)
        guard Array(bytes[0..<4]) == [0x41, 0x52, 0x56, 0x31], (bytes[4] == 1 || bytes[4] == 2),
              bytes[5] == 0, bytes[6] == 0, bytes[7] == 0, (bytes.count - headerBytes) % 2 == 0 else {
            throw CloudVoiceFailure.invalidResponse
        }
        let id = UUID(uuid: (bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
                             bytes[16], bytes[17], bytes[18], bytes[19], bytes[20], bytes[21], bytes[22], bytes[23]))
        let sequence = UInt32(bytes[24]) << 24 | UInt32(bytes[25]) << 16 | UInt32(bytes[26]) << 8 | UInt32(bytes[27])
        return VoicePCMEnvelope(kind: bytes[4], streamID: id, sequence: sequence, pcm: Data(bytes[headerBytes...]))
    }
}
