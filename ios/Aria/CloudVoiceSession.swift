import Foundation
import Combine
import CoreFoundation

/// Test seams keep lifecycle/protocol tests independent of sockets and microphones.
/// Production uses the native engine and URLSession implementations below.
protocol CloudVoiceSocket: AnyObject {
    var response: URLResponse? { get }
    func resume()
    func receive() async throws -> URLSessionWebSocketTask.Message
    func send(_ message: URLSessionWebSocketTask.Message) async throws
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?)
}

extension URLSessionWebSocketTask: CloudVoiceSocket { }

protocol CloudVoiceAudio: AnyObject {
    var onCapturedFrame: ((Data, Float) -> Void)? { get set }
    var onPlaybackStarted: ((UUID) -> Void)? { get set }
    var onPlaybackDrained: ((UUID) -> Void)? { get set }
    var onFailure: ((String) -> Void)? { get set }
    var onInterruption: (() -> Void)? { get set }
    func start(inputRate: Int, outputRate: Int) async throws
    func setMuted(_ value: Bool)
    func setSpeaker(_ value: Bool)
    func enqueuePlayback(_ pcm: Data, responseID: UUID, sequence: Int)
    func finishPlayback(responseID: UUID)
    func stopPlayback()
    func stop()
}

extension NativeVoiceAudioEngine: CloudVoiceAudio { }

enum CloudVoicePhase: Equatable {
    case idle
    case connecting
    case listening(partial: String)
    case thinking(final: String)
    case speaking(subtitle: String)
    case interrupted
    case failed(code: String, retryable: Bool)

    var title: String {
        switch self {
        case .idle: return "准备开始"
        case .connecting: return "正在连接"
        case .listening: return "正在听"
        case .thinking: return "正在想"
        case .speaking: return "正在说"
        case .interrupted: return "已暂停"
        case .failed: return "连接已停止"
        }
    }
}

struct CloudVoiceLatency: Equatable {
    var asrFirstMS: Int?
    var asrFinalMS: Int?
    var agentFirstMS: Int?
    var ttsFirstMS: Int?
    /// Monotonic commit-to-player-scheduling estimate; not acoustic/render latency.
    var firstPlaybackMS: Int?
}

/// Main-actor owner of protocol, UI, lifecycle, turn identity, and bounded queues.
/// Audio buffers exist only in memory and are never written to disk or logged.
@MainActor
final class VoiceSessionController: ObservableObject {
    @Published private(set) var phase: CloudVoicePhase = .idle
    @Published private(set) var isMuted = false
    @Published private(set) var speakerEnabled = true
    @Published private(set) var userCaption = ""
    @Published private(set) var assistantCaption = ""
    @Published private(set) var approvalRequired = false
    @Published private(set) var latency = CloudVoiceLatency()
    @Published private(set) var completedTurns = 0
    @Published private(set) var serviceNotice: String?

    let conversationID: Int
    private let audio: any CloudVoiceAudio
    private let makeSocket: @MainActor () throws -> any CloudVoiceSocket
    private let permissionRequest: () async -> Bool
    private var socket: (any CloudVoiceSocket)?
    private var generation = UUID()
    private var receiveTask: Task<Void, Never>?
    private var sendTask: Task<Void, Never>?
    private var connectTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var watchdogTask: Task<Void, Never>?
    private var outgoing: [URLSessionWebSocketTask.Message] = []
    private var ready = false
    private var maxUtteranceFrames = 1_000
    private var maxTextCharacters = 16_000
    private var maxSessionSeconds: TimeInterval = 900
    private var maxIdleSeconds: TimeInterval = 60
    private var maxResponseSeconds: TimeInterval = 120
    private var sessionReadyTime: TimeInterval = 0
    private var lastActivityTime: TimeInterval = 0
    private var turnDeadline: TimeInterval?
    private var utteranceStartTime: TimeInterval?
    private var utteranceID: UUID?
    private var pendingUtteranceID: UUID?
    private var nextInputSequence = 0
    private var speechFrames = 0
    private var silentFrames = 0
    private var consecutiveSpeechFrames = 0
    private var preRoll: [Data] = []
    private var noiseFloor: Float = 0.002
    private var captureMailbox: CloudCaptureMailbox?
    private var activeResponseID: UUID?
    private var retiredResponseIDs: [UUID] = []
    private var nextOutputSequence: UInt32 = 0
    private var responseDone = false
    private var ttsDone = false
    private var playbackDrained = false
    private var playbackStartedAt: TimeInterval?
    private var playbackWasStarted = false
    private var ttsUnavailable = false
    private var commitTime: TimeInterval?

    init(api: CloudVoiceAPI, conversationID: Int,
         audio: any CloudVoiceAudio = NativeVoiceAudioEngine(),
         permissionRequest: @escaping () async -> Bool = { await NativeVoiceAudioEngine.requestPermission() },
         socketFactory: (@MainActor () throws -> any CloudVoiceSocket)? = nil) {
        self.audio = audio
        self.permissionRequest = permissionRequest
        self.makeSocket = socketFactory ?? { try api.makeVoiceSocket() }
        self.conversationID = conversationID
    }

    var errorExplanation: String? {
        guard case .failed(let code, _) = phase else { return nil }
        switch code {
        case "permission_denied": return "未能建立语音连接。请检查麦克风权限、真实账号登录，以及服务器是否已启用并配置语音服务。"
        case "session_expired": return "语音会话已过期。请返回真实会话重新开始；如仍失败，请重新登录。"
        case "asr_unavailable": return "语音识别暂不可用，请稍后重试。"
        case "agent_unavailable": return "Aria 暂时无法生成回复，请检查服务器配置后重试。"
        case "tts_unavailable": return "语音合成暂不可用。已生成的文字可返回真实会话查看。"
        case "rate_limited": return "服务繁忙或使用额度受限，请稍后重试。"
        case "protocol_error": return "语音服务协议或音频格式不匹配。请检查服务版本后重试。"
        case "audio_unavailable": return "音频设备暂不可用，请检查麦克风和输出设备后重试。"
        default: return "网络连接已中断。请检查自己的 Aria 服务器后重试。"
        }
    }

    func start() {
        guard conversationID > 0 else { fail("protocol_error", retryable: false); return }
        teardown(sendEnd: false)
        let currentGeneration = generation
        phase = .connecting
        approvalRequired = false
        userCaption = ""
        assistantCaption = ""
        latency = CloudVoiceLatency()
        serviceNotice = nil
        connectTask = Task { [weak self] in
            guard let permissionRequest = self?.permissionRequest else { return }
            let permitted = await permissionRequest()
            guard let self, self.generation == currentGeneration, !Task.isCancelled else { return }
            guard permitted else { self.fail("permission_denied", retryable: true); return }
            do {
                let socket = try self.makeSocket()
                self.socket = socket
                self.installAudioCallbacks(generation: currentGeneration)
                socket.resume()
                self.receiveTask = Task { [weak self, weak socket] in
                    guard let socket else { return }
                    do {
                        while !Task.isCancelled {
                            let message = try await socket.receive()
                            guard let self, self.generation == currentGeneration else { return }
                            await self.handle(message, generation: currentGeneration)
                        }
                    } catch {
                        guard let self, self.generation == currentGeneration, !Task.isCancelled else { return }
                        let status = (socket.response as? HTTPURLResponse)?.statusCode
                        self.fail(status == 401 ? "session_expired" : (status == 403 ? "permission_denied" : "network_unavailable"),
                                  retryable: status != 401 && status != 403)
                    }
                }
                self.enqueueJSON([
                    "type": "session.start", "version": 1, "conversation_id": self.conversationID, "locale": "zh-CN",
                    "input_audio": ["encoding": "pcm_s16le", "sample_rate": 16000, "channels": 1, "frame_ms": 20],
                    "output_audio": ["encoding": "pcm_s16le", "sample_rate": 24000, "channels": 1]
                ])
                self.timeoutTask = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(15))
                    guard !Task.isCancelled, let self, self.generation == currentGeneration, !self.ready else { return }
                    self.fail("network_unavailable", retryable: true)
                }
            } catch {
                self.fail(error as? CloudVoiceFailure == .signedOut ? "session_expired" : "network_unavailable", retryable: false)
            }
        }
    }

    func retry() {
        if case .failed(_, let retryable) = phase, !retryable { return }
        start()
    }

    func end() {
        teardown(sendEnd: true)
        phase = .idle
    }

    /// Foreground return never silently reconnects or resumes microphone capture.
    func suspend() {
        guard phase != .idle else { return }
        teardown(sendEnd: true)
        phase = .interrupted
    }

    func setMuted(_ muted: Bool) {
        if muted { commitUtterance() }
        isMuted = muted
        audio.setMuted(muted)
        captureMailbox?.clear()
        preRoll.removeAll(keepingCapacity: false)
        consecutiveSpeechFrames = 0
    }

    func setSpeaker(_ enabled: Bool) {
        speakerEnabled = enabled
        audio.setSpeaker(enabled)
    }

    func interrupt() {
        guard ready, let id = activeResponseID else { return }
        // Drop local output immediately; queued/late server chunks are retired by ID.
        audio.stopPlayback()
        retire(id)
        activeResponseID = nil
        enqueueJSON(["type": "response.interrupt", "response_id": id.uuidString.lowercased()])
        guard ready else { return }
        resetOutput()
        lastActivityTime = ProcessInfo.processInfo.systemUptime
        turnDeadline = nil
        phase = .listening(partial: "")
        preRoll.removeAll(keepingCapacity: false)
        consecutiveSpeechFrames = 0
    }

    private func installAudioCallbacks(generation: UUID) {
        let mailbox = CloudCaptureMailbox()
        captureMailbox = mailbox
        audio.onCapturedFrame = { [weak self] data, rms in
            guard mailbox.offer(data, rms: rms) else { return }
            Task { @MainActor [weak self] in
                let batch = mailbox.take()
                guard let self, self.generation == generation else { return }
                guard !batch.overflow else { self.fail("audio_unavailable", retryable: true); return }
                for frame in batch.frames {
                    guard self.generation == generation else { return }
                    self.capture(frame.0, rms: frame.1)
                }
            }
        }
        audio.onPlaybackStarted = { [weak self] responseID in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, self.activeResponseID == responseID else { return }
                if !self.playbackWasStarted {
                    self.playbackWasStarted = true
                    self.playbackStartedAt = ProcessInfo.processInfo.systemUptime
                    if let commit = self.commitTime {
                        self.latency.firstPlaybackMS = max(0, Int((ProcessInfo.processInfo.systemUptime - commit) * 1000))
                    }
                }
                self.phase = .speaking(subtitle: self.assistantCaption)
            }
        }
        audio.onPlaybackDrained = { [weak self] responseID in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation, self.activeResponseID == responseID else { return }
                self.playbackDrained = true
                self.finishResponseIfReady()
            }
        }
        audio.onFailure = { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation else { return }
                self.fail("audio_unavailable", retryable: true)
            }
        }
        audio.onInterruption = { [weak self] in
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation else { return }
                self.suspend()
            }
        }
    }

    private func capture(_ data: Data, rms: Float) {
        guard ready, !isMuted, pendingUtteranceID == nil, data.count == 640, rms.isFinite else { return }
        let isPlaying: Bool
        if case .speaking = phase { isPlaying = true } else { isPlaying = false }
        if activeResponseID != nil && !isPlaying { return }

        // AVAudioEngine voice processing supplies echo-reduced RMS. Hold off at
        // speaker start and require six consecutive near-end frames, not one spike.
        if isPlaying {
            guard let started = playbackStartedAt, ProcessInfo.processInfo.systemUptime - started >= 0.35 else { return }
            let threshold = max(0.025, noiseFloor * 4)
            preRoll.append(data)
            if preRoll.count > 10 { preRoll.removeFirst() }
            consecutiveSpeechFrames = rms > threshold ? consecutiveSpeechFrames + 1 : 0
            guard consecutiveSpeechFrames >= 6 else { return }
            let onset = preRoll
            interrupt()
            preRoll = onset
            beginUtterance()
            return
        }

        if utteranceID == nil {
            guard case .listening = phase else { return }
            let threshold = max(0.010, noiseFloor * 3)
            if rms < threshold { noiseFloor = min(0.015, noiseFloor * 0.98 + max(0, rms) * 0.02) }
            preRoll.append(data)
            if preRoll.count > 10 { preRoll.removeFirst() }
            consecutiveSpeechFrames = rms > threshold ? consecutiveSpeechFrames + 1 : 0
            if consecutiveSpeechFrames >= 3 { beginUtterance() }
            return
        }

        sendInput(data)
        speechFrames += 1
        silentFrames = rms < max(0.007, noiseFloor * 2) ? silentFrames + 1 : 0
        if (silentFrames >= 33 && speechFrames >= 12) || nextInputSequence >= maxUtteranceFrames {
            commitUtterance()
        }
    }

    private func beginUtterance() {
        guard ready, activeResponseID == nil, pendingUtteranceID == nil else { return }
        utteranceID = UUID()
        utteranceStartTime = ProcessInfo.processInfo.systemUptime
        nextInputSequence = 0
        speechFrames = 0
        silentFrames = 0
        consecutiveSpeechFrames = 0
        userCaption = ""
        assistantCaption = ""
        serviceNotice = nil
        let frames = preRoll
        preRoll.removeAll(keepingCapacity: false)
        for frame in frames { sendInput(frame) }
    }

    private func sendInput(_ data: Data) {
        guard let id = utteranceID, nextInputSequence < maxUtteranceFrames else { return }
        do {
            let frame = VoicePCMEnvelope(kind: 1, streamID: id, sequence: UInt32(nextInputSequence), pcm: data)
            enqueue(.data(try frame.encoded()))
            nextInputSequence += 1
            lastActivityTime = ProcessInfo.processInfo.systemUptime
        } catch { fail("protocol_error", retryable: false) }
    }

    private func commitUtterance() {
        guard let id = utteranceID, nextInputSequence > 0 else { return }
        pendingUtteranceID = id
        utteranceID = nil
        utteranceStartTime = nil
        commitTime = ProcessInfo.processInfo.systemUptime
        turnDeadline = ProcessInfo.processInfo.systemUptime + min(30, maxResponseSeconds)
        // Same FIFO as audio; commit cannot overtake the final PCM frame.
        enqueueJSON(["type": "audio.commit", "utterance_id": id.uuidString.lowercased(), "last_sequence": nextInputSequence - 1])
        guard ready else { return }
        phase = .thinking(final: userCaption)
        preRoll.removeAll(keepingCapacity: false)
        consecutiveSpeechFrames = 0
    }

    private func handle(_ message: URLSessionWebSocketTask.Message, generation: UUID) async {
        guard self.generation == generation else { return }
        do {
            switch message {
            case .data(let data):
                guard ready else { throw CloudVoiceFailure.invalidResponse }
                let packet = try VoicePCMEnvelope.decode(data)
                guard packet.kind == 2 else { throw CloudVoiceFailure.invalidResponse }
                guard packet.streamID == activeResponseID, !retiredResponseIDs.contains(packet.streamID) else { return }
                if ttsUnavailable { return }
                guard !ttsDone, packet.sequence == nextOutputSequence else { throw CloudVoiceFailure.invalidResponse }
                nextOutputSequence += 1
                playbackDrained = false
                audio.enqueuePlayback(packet.pcm, responseID: packet.streamID, sequence: Int(packet.sequence))
            case .string(let text):
                guard text.utf8.count <= 128 * 1024, let data = text.data(using: .utf8),
                      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let type = object["type"] as? String else { throw CloudVoiceFailure.invalidResponse }
                if type == "session.ready" {
                    guard !ready else { throw CloudVoiceFailure.invalidResponse }
                    try validateReady(object)
                    timeoutTask?.cancel()
                    audio.setSpeaker(speakerEnabled)
                    audio.setMuted(isMuted)
                    do { try await audio.start(inputRate: 16000, outputRate: 24000) }
                    catch {
                        if self.generation == generation { fail("audio_unavailable", retryable: true) }
                        return
                    }
                    guard self.generation == generation else { return }
                    ready = true
                    phase = .listening(partial: "")
                    startWatchdog(generation: generation)
                    return
                }
                if type == "error" { handleError(object); return }
                guard ready else { throw CloudVoiceFailure.invalidResponse }
                try handleEvent(type, object: object)
            @unknown default: throw CloudVoiceFailure.invalidResponse
            }
        } catch {
            guard self.generation == generation else { return }
            fail("protocol_error", retryable: false)
        }
    }

    private func validateReady(_ object: [String: Any]) throws {
        guard integer(object["version"]) == 1,
              let sessionID = object["session_id"] as? String, UUID(uuidString: sessionID) != nil,
              let input = object["input_audio"] as? [String: Any], let output = object["output_audio"] as? [String: Any],
              input["encoding"] as? String == "pcm_s16le", integer(input["sample_rate"]) == 16000,
              integer(input["channels"]) == 1, integer(input["frame_ms"]) == 20,
              output["encoding"] as? String == "pcm_s16le", integer(output["sample_rate"]) == 24000,
              integer(output["channels"]) == 1,
              let limits = object["limits"] as? [String: Any] else { throw CloudVoiceFailure.invalidResponse }
        for key in ["max_session_seconds", "max_idle_seconds", "max_response_seconds", "max_utterance_seconds", "max_audio_bytes", "max_text_characters"] {
            guard let value = limits[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
                  value.doubleValue.isFinite, value.doubleValue > 0 else { throw CloudVoiceFailure.invalidResponse }
        }
        let seconds = (limits["max_utterance_seconds"] as! NSNumber).doubleValue
        let bytes = (limits["max_audio_bytes"] as! NSNumber).doubleValue
        maxUtteranceFrames = Int(min(1_000, min(floor(seconds * 50), floor(bytes / 640))))
        maxTextCharacters = Int(min(16_000, (limits["max_text_characters"] as! NSNumber).doubleValue))
        maxSessionSeconds = min(3_600, (limits["max_session_seconds"] as! NSNumber).doubleValue)
        maxIdleSeconds = min(600, (limits["max_idle_seconds"] as! NSNumber).doubleValue)
        maxResponseSeconds = min(300, (limits["max_response_seconds"] as! NSNumber).doubleValue)
        guard maxUtteranceFrames >= 12, maxTextCharacters >= 1 else { throw CloudVoiceFailure.invalidResponse }
    }

    private func handleEvent(_ type: String, object: [String: Any]) throws {
        switch type {
        case "asr.partial", "asr.final":
            guard let raw = object["utterance_id"] as? String, let id = UUID(uuidString: raw),
                  let text = object["text"] as? String, text.count <= maxTextCharacters else { throw CloudVoiceFailure.invalidResponse }
            guard id == utteranceID || id == pendingUtteranceID else { return }
            userCaption = text
            if type == "asr.partial" {
                if pendingUtteranceID == nil { phase = .listening(partial: text) }
                return
            }
            guard id == pendingUtteranceID, let rawResponse = object["response_id"] as? String,
                  let responseID = UUID(uuidString: rawResponse), !retiredResponseIDs.contains(responseID) else {
                throw CloudVoiceFailure.invalidResponse
            }
            pendingUtteranceID = nil
            activeResponseID = responseID
            turnDeadline = ProcessInfo.processInfo.systemUptime + maxResponseSeconds + 3
            resetOutput()
            latency = CloudVoiceLatency()
            phase = .thinking(final: text)
        case "text.delta", "tts.done", "response.done", "response.interrupted", "agent.event", "latency":
            guard let raw = object["response_id"] as? String, let id = UUID(uuidString: raw) else {
                throw CloudVoiceFailure.invalidResponse
            }
            guard id == activeResponseID, !retiredResponseIDs.contains(id) else { return }
            switch type {
            case "text.delta":
                guard let text = object["text"] as? String, assistantCaption.count + text.count <= maxTextCharacters else {
                    throw CloudVoiceFailure.invalidResponse
                }
                assistantCaption += text
                if case .speaking = phase { phase = .speaking(subtitle: assistantCaption) }
            case "tts.done":
                if ttsUnavailable { return }
                guard !ttsDone, let last = integer(object["last_sequence"]), last == Int(nextOutputSequence) - 1 else {
                    throw CloudVoiceFailure.invalidResponse
                }
                ttsDone = true
                if nextOutputSequence == 0 { playbackDrained = true }
                audio.finishPlayback(responseID: id)
                finishResponseIfReady()
            case "response.done":
                guard let status = object["status"] as? String,
                      ["completed", "waiting_confirmation", "failed", "cancelled"].contains(status), object["run_id"] is String else {
                    throw CloudVoiceFailure.invalidResponse
                }
                approvalRequired = approvalRequired || status == "waiting_confirmation"
                responseDone = true
                if status == "failed" { fail("agent_unavailable", retryable: true); return }
                if nextOutputSequence == 0 { ttsDone = true; playbackDrained = true }
                finishResponseIfReady()
            case "response.interrupted":
                audio.stopPlayback()
                retire(id)
                activeResponseID = nil
                turnDeadline = nil
                lastActivityTime = ProcessInfo.processInfo.systemUptime
                resetOutput()
                phase = .listening(partial: "")
            case "agent.event":
                guard let event = object["event"] as? [String: Any] else { throw CloudVoiceFailure.invalidResponse }
                if event["type"] as? String == "confirmation_required" || event["final_status"] as? String == "waiting_confirmation" {
                    approvalRequired = true
                }
            case "latency":
                if let value = milliseconds(object["asr_first_ms"]) { latency.asrFirstMS = value }
                if let value = milliseconds(object["asr_final_ms"]) { latency.asrFinalMS = value }
                if let value = milliseconds(object["agent_first_ms"]) { latency.agentFirstMS = value }
                if let value = milliseconds(object["tts_first_ms"]) { latency.ttsFirstMS = value }
            default: break
            }
        default: break // Versioned future informational events have no control authority.
        }
    }

    private func handleError(_ object: [String: Any]) {
        if let raw = object["response_id"] as? String {
            guard let id = UUID(uuidString: raw), id == activeResponseID, !retiredResponseIDs.contains(id) else { return }
        }
        let known = ["permission_denied", "network_unavailable", "asr_unavailable", "agent_unavailable", "tts_unavailable", "rate_limited", "session_expired"]
        let rawCode = object["code"] as? String ?? "protocol_error"
        let code = known.contains(rawCode) ? rawCode : "protocol_error"
        if code == "tts_unavailable", object["fatal"] as? Bool == false, activeResponseID != nil {
            audio.stopPlayback()
            ttsUnavailable = true
            ttsDone = true
            playbackDrained = true
            serviceNotice = "语音合成暂不可用，文字回复会继续显示。"
            phase = .thinking(final: userCaption)
            finishResponseIfReady()
            return
        }
        // Never show provider/debug error.message (it can contain private content).
        fail(code, retryable: object["retryable"] as? Bool ?? false)
    }

    private func finishResponseIfReady() {
        guard responseDone, ttsDone, playbackDrained, let id = activeResponseID else { return }
        retire(id)
        activeResponseID = nil
        resetOutput()
        completedTurns += 1
        turnDeadline = nil
        lastActivityTime = ProcessInfo.processInfo.systemUptime
        phase = .listening(partial: "")
    }

    private func startWatchdog(generation: UUID) {
        sessionReadyTime = ProcessInfo.processInfo.systemUptime
        lastActivityTime = sessionReadyTime
        watchdogTask?.cancel()
        watchdogTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                guard let self, self.generation == generation, self.ready else { return }
                let now = ProcessInfo.processInfo.systemUptime
                if now - self.sessionReadyTime >= self.maxSessionSeconds {
                    self.fail("session_expired", retryable: true); return
                }
                if let deadline = self.turnDeadline, now >= deadline {
                    self.fail(self.pendingUtteranceID == nil ? "agent_unavailable" : "asr_unavailable", retryable: true)
                    return
                }
                if let started = self.utteranceStartTime, now - started > Double(self.maxUtteranceFrames) / 50 + 2 {
                    self.fail("audio_unavailable", retryable: true); return
                }
                if self.utteranceID == nil, self.pendingUtteranceID == nil, self.activeResponseID == nil,
                   now - self.lastActivityTime >= self.maxIdleSeconds {
                    self.fail("session_expired", retryable: true); return
                }
            }
        }
    }

    private func resetOutput() {
        nextOutputSequence = 0
        responseDone = false
        ttsDone = false
        playbackDrained = false
        playbackStartedAt = nil
        playbackWasStarted = false
        ttsUnavailable = false
    }

    private func retire(_ id: UUID) {
        retiredResponseIDs.append(id)
        if retiredResponseIDs.count > 64 { retiredResponseIDs.removeFirst() }
    }

    private func enqueueJSON(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object), let string = String(data: data, encoding: .utf8) else {
            fail("protocol_error", retryable: false); return
        }
        enqueue(.string(string))
    }

    private func enqueue(_ message: URLSessionWebSocketTask.Message) {
        guard let socket else { return }
        guard outgoing.count < 150 else { fail("network_unavailable", retryable: true); return }
        outgoing.append(message)
        guard sendTask == nil else { return }
        let currentGeneration = generation
        sendTask = Task { [weak self, weak socket] in
            guard let socket else { return }
            do {
                while let self, self.generation == currentGeneration, !Task.isCancelled, !self.outgoing.isEmpty {
                    let next = self.outgoing.removeFirst()
                    try await socket.send(next)
                }
                guard let self, self.generation == currentGeneration else { return }
                self.sendTask = nil
            } catch {
                guard let self, self.generation == currentGeneration, !Task.isCancelled else { return }
                self.fail("network_unavailable", retryable: true)
            }
        }
    }

    private func fail(_ code: String, retryable: Bool) {
        teardown(sendEnd: true)
        phase = .failed(code: code, retryable: retryable)
    }

    private func teardown(sendEnd: Bool) {
        generation = UUID() // Invalidates every suspended async task and audio callback first.
        ready = false
        connectTask?.cancel(); connectTask = nil
        timeoutTask?.cancel(); timeoutTask = nil
        watchdogTask?.cancel(); watchdogTask = nil
        receiveTask?.cancel(); receiveTask = nil
        sendTask?.cancel(); sendTask = nil
        outgoing.removeAll(keepingCapacity: false)
        audio.onCapturedFrame = nil
        audio.onPlaybackStarted = nil
        audio.onPlaybackDrained = nil
        audio.onFailure = nil
        audio.onInterruption = nil
        captureMailbox?.clear()
        captureMailbox = nil
        audio.stop()
        if let socket {
            if sendEnd {
                // A bounded, best-effort control message, never an automatic retry.
                Task {
                    let closeDeadline = Task {
                        try? await Task.sleep(for: .milliseconds(300))
                        if !Task.isCancelled { socket.cancel(with: .goingAway, reason: nil) }
                    }
                    try? await socket.send(.string("{\"type\":\"session.end\"}"))
                    closeDeadline.cancel()
                    socket.cancel(with: .normalClosure, reason: nil)
                }
            } else { socket.cancel(with: .goingAway, reason: nil) }
        }
        socket = nil
        utteranceID = nil
        pendingUtteranceID = nil
        activeResponseID = nil
        preRoll.removeAll(keepingCapacity: false)
        retiredResponseIDs.removeAll(keepingCapacity: false)
        nextInputSequence = 0
        consecutiveSpeechFrames = 0
        silentFrames = 0
        noiseFloor = 0.002
        commitTime = nil
        turnDeadline = nil
        utteranceStartTime = nil
        resetOutput()
    }

    private func integer(_ value: Any?) -> Int? {
        guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
              value.doubleValue.isFinite, value.doubleValue.rounded() == value.doubleValue,
              value.doubleValue >= Double(Int.min), value.doubleValue < Double(Int.max) else { return nil }
        return value.intValue
    }

    private func milliseconds(_ value: Any?) -> Int? {
        guard let value = value as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
              value.doubleValue.isFinite, value.doubleValue >= 0, value.doubleValue < Double(Int.max) else { return nil }
        return Int(value.doubleValue.rounded(.down))
    }
}

/// Bounds raw PCM before crossing to the UI actor, including while that actor is
/// stalled. One drain task at a time; overflow fails closed rather than dropping
/// frames and presenting an incorrect transcript. Maximum retention is 500 ms.
private final class CloudCaptureMailbox: @unchecked Sendable {
    private let lock = NSLock()
    private var frames: [(Data, Float)] = []
    private var scheduled = false
    private var overflow = false

    func offer(_ data: Data, rms: Float) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if frames.count >= 25 || overflow { overflow = true }
        else { frames.append((data, rms)) }
        guard !scheduled else { return false }
        scheduled = true
        return true
    }

    func take() -> (frames: [(Data, Float)], overflow: Bool) {
        lock.lock(); defer { lock.unlock() }
        let result = (frames, overflow)
        frames.removeAll(keepingCapacity: false)
        scheduled = false
        return result
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        frames.removeAll(keepingCapacity: false)
        overflow = false
    }
}
