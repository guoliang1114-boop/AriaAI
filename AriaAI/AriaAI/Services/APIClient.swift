import Foundation

// MARK: - Base

enum APIError: LocalizedError {
    case badStatus(Int)
    case decodingError(Error)
    case networkError(Error)
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .badStatus(let code): return "Server error \(code)"
        case .decodingError(let e): return "Decode failed: \(e)"
        case .networkError(let e): return "Network error: \(e)"
        case .notConfigured: return "API key not configured"
        }
    }
}

actor APIClient {
    static let shared = APIClient()
    private var base: URL {
        let fallback = "https://aria.d2cgo.co"
        let saved = UserDefaults.standard.string(forKey: "apiBaseURL") ?? fallback
        guard let url = URL(string: saved), url.host != nil else {
            UserDefaults.standard.set(fallback, forKey: "apiBaseURL")
            return URL(string: fallback)!
        }
        return url
    }

    private var authToken: String? {
        UserDefaults.standard.string(forKey: "authToken")
    }

    private func addAuthHeader(_ req: inout URLRequest) {
        if let token = authToken {
            req.setValue(token, forHTTPHeaderField: "X-Auth-Token")
        }
    }
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let str = try container.decode(String.self)
            // Try fractional seconds (Python datetime.utcnow() includes microseconds)
            let fmts = [
                "yyyy-MM-dd'T'HH:mm:ss.SSSSSS",
                "yyyy-MM-dd'T'HH:mm:ss.SSS",
                "yyyy-MM-dd'T'HH:mm:ss",
            ]
            for fmt in fmts {
                let f = DateFormatter()
                f.locale = Locale(identifier: "en_US_POSIX")
                f.dateFormat = fmt
                if let date = f.date(from: str) { return date }
            }
            // Fallback: ISO8601 with timezone
            if let date = ISO8601DateFormatter().date(from: str) { return date }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date string: \(str)"
            )
        }
        return d
    }()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    private func url(_ path: String) -> URL { base.appendingPathComponent(path) }

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var components = URLComponents(url: url(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var req = URLRequest(url: components.url!)
        addAuthHeader(&req)
        return try await perform(req)
    }

    func post<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        var req = URLRequest(url: url(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        addAuthHeader(&req)
        return try await perform(req)
    }

    /// POST with JSON body, response body ignored — success = 2xx status code
    func post<B: Encodable>(_ path: String, body: B) async throws {
        var req = URLRequest(url: url(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        addAuthHeader(&req)
        let (_, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.badStatus(http.statusCode)
        }
    }

    /// POST with query params but no JSON body (e.g. /chat/conversations?project_id=1)
    func post<T: Decodable>(_ path: String, query: [String: String]) async throws -> T {
        var components = URLComponents(url: url(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var req = URLRequest(url: components.url!)
        req.httpMethod = "POST"
        addAuthHeader(&req)
        return try await perform(req)
    }

    func patch<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        var req = URLRequest(url: url(path))
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        addAuthHeader(&req)
        return try await perform(req)
    }

    func put<B: Encodable, T: Decodable>(_ path: String, body: B) async throws -> T {
        var req = URLRequest(url: url(path))
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        addAuthHeader(&req)
        return try await perform(req)
    }

    func put<B: Encodable>(_ path: String, body: B) async throws {
        var req = URLRequest(url: url(path))
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(body)
        addAuthHeader(&req)
        let (_, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.badStatus(http.statusCode)
        }
    }

    func delete(_ path: String) async throws {
        var req = URLRequest(url: url(path))
        req.httpMethod = "DELETE"
        addAuthHeader(&req)
        let (_, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.badStatus(http.statusCode)
        }
    }

    private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw APIError.badStatus(http.statusCode)
            }
            return try decoder.decode(T.self, from: data)
        } catch let e as APIError {
            throw e
        } catch let e as DecodingError {
            throw APIError.decodingError(e)
        } catch {
            throw APIError.networkError(error)
        }
    }

    // MARK: - SSE streaming

    /// Streams Server-Sent Events from /chat/send, yielding text chunks.
    func streamChat(
        conversationId: Int?,
        content: String,
        projectId: Int? = nil,
        skillId: Int? = nil,
        ragDocIds: [Int] = [],
        fileIds: [Int] = []
    ) -> AsyncThrowingStream<ChatChunk, Error> {
        AsyncThrowingStream { continuation in
            Task {
                var req = URLRequest(url: url("/chat/send"), timeoutInterval: 600)
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                self.addAuthHeader(&req)

                var body: [String: Any] = [
                    "content": content,
                    "rag_doc_ids": ragDocIds,
                    "file_ids": fileIds
                ]
                if let cid = conversationId { body["conversation_id"] = cid }
                if let pid = projectId { body["project_id"] = pid }
                if let sid = skillId { body["skill_id"] = sid }
                req.httpBody = try? JSONSerialization.data(withJSONObject: body)

                do {
                    let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                    if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        var body = ""
                        for try await line in bytes.lines { body += line }
                        let msg = body.isEmpty ? "HTTP \(http.statusCode)" : body
                        continuation.finish(throwing: APIError.networkError(
                            NSError(domain: "HTTP", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: msg])
                        ))
                        return
                    }
                    for try await line in bytes.lines {
                        if line.hasPrefix("data: ") {
                            let payload = String(line.dropFirst(6))
                            if let data = payload.data(using: .utf8),
                               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                                let type_ = json["type"] as? String ?? ""
                                switch type_ {
                                case "conversation_id":
                                    if let id = json["id"] as? Int {
                                        continuation.yield(.conversationId(id))
                                    }
                                case "text":
                                    if let chunk = json["content"] as? String {
                                        continuation.yield(.text(chunk))
                                    }
                                case "error":
                                    let msg = json["message"] as? String ?? "Unknown error"
                                    continuation.finish(throwing: APIError.networkError(
                                        NSError(domain: "Claude", code: 0, userInfo: [NSLocalizedDescriptionKey: msg])
                                    ))
                                    return
                                case "tool_executing":
                                    if let toolName = json["tool_name"] as? String {
                                        let message = json["message"] as? String
                                        let total = json["total"] as? Int
                                        let current = json["current"] as? Int
                                        continuation.yield(.toolExecuting(toolName, message: message, total: total, current: current))
                                    }
                                case "tool_result":
                                    if let resultData = try? JSONSerialization.data(withJSONObject: json["result"] ?? [:]),
                                       let result = try? JSONDecoder().decode(ToolResult.self, from: resultData) {
                                        continuation.yield(.toolResult(result))
                                    }
                                case "done":
                                    if let t = json["title"] as? String {
                                        continuation.yield(.title(t))
                                    }
                                    continuation.finish()
                                    return
                                default:
                                    break
                                }
                            }
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    /// Streams project context generation as SSE, yielding text chunks.
    /// The stream finishes when the server sends `{"type":"done"}`.
    func streamContextGenerate(projectId: Int) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task {
                var req = URLRequest(url: url("/projects/\(projectId)/generate-context"), timeoutInterval: 600)
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                req.httpBody = "{}".data(using: .utf8)
                self.addAuthHeader(&req)

                do {
                    let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                    if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        var body = ""
                        for try await line in bytes.lines { body += line }
                        continuation.finish(throwing: APIError.networkError(
                            NSError(domain: "HTTP", code: http.statusCode,
                                    userInfo: [NSLocalizedDescriptionKey: body.isEmpty ? "HTTP \(http.statusCode)" : body])
                        ))
                        return
                    }
                    for try await line in bytes.lines {
                        if line.hasPrefix("data: ") {
                            let payload = String(line.dropFirst(6))
                            if let data = payload.data(using: .utf8),
                               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                                let type_ = json["type"] as? String ?? ""
                                switch type_ {
                                case "text":
                                    if let chunk = json["content"] as? String {
                                        continuation.yield(chunk)
                                    }
                                case "error":
                                    let msg = json["message"] as? String ?? "Unknown error"
                                    continuation.finish(throwing: APIError.networkError(
                                        NSError(domain: "ContextGen", code: 0,
                                                userInfo: [NSLocalizedDescriptionKey: msg])
                                    ))
                                    return
                                case "done":
                                    continuation.finish()
                                    return
                                default:
                                    break
                                }
                            }
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    /// Download a generated file from the server and save it to a temp location.
    func downloadGeneratedFile(filePath: String) async throws -> URL {
        var components = URLComponents(url: url("/artifacts/download-by-path"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "path", value: filePath)]
        var req = URLRequest(url: components.url!)
        req.httpMethod = "GET"
        addAuthHeader(&req)
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.badStatus(http.statusCode)
        }
        let fileName = URL(fileURLWithPath: filePath).lastPathComponent
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        try data.write(to: tempURL)
        return tempURL
    }
}

enum ChatChunk {
    case conversationId(Int)
    case text(String)
    case title(String)
    case toolExecuting(String, message: String?, total: Int?, current: Int?)  // tool_name with progress info
    case toolResult(ToolResult)
}

struct ToolResult: Codable {
    let type: String
    let toolName: String
    let status: String
    let output: ToolOutput?
    let error: String?
    
    enum CodingKeys: String, CodingKey {
        case type
        case toolName = "tool_name"
        case status
        case output
        case error
    }
}

struct ToolOutput: Codable {
    let success: Bool
    let fileType: String?
    let fileName: String?
    let filePath: String?
    let fullPath: String?
    let slideCount: Int?
    
    enum CodingKeys: String, CodingKey {
        case success
        case fileType = "file_type"
        case fileName = "file_name"
        case filePath = "file_path"
        case fullPath = "full_path"
        case slideCount = "slide_count"
    }
}

// MARK: - Upload helpers

extension APIClient {
    func uploadFile(path: String, fileURL: URL, fieldName: String = "file", extraFields: [String: String] = [:]) async throws -> Data {
        let boundary = UUID().uuidString
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        addAuthHeader(&req)

        var body = Data()
        let filename = fileURL.lastPathComponent
        let mimeType = mimeType(for: fileURL)

        for (key, value) in extraFields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }

        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(try Data(contentsOf: fileURL))
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        req.httpBody = body
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.badStatus(http.statusCode)
        }
        return data
    }

    private func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "pdf": return "application/pdf"
        case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        default: return "application/octet-stream"
        }
    }
}
