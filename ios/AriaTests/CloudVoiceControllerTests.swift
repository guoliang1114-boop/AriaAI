import Foundation
import XCTest
@testable import Aria

/// These tests never request system permission, open a real socket, or start AVAudioEngine.
/// All async gates are explicitly released; polling is bounded and uses no wall-clock sleeps.
@MainActor
final class CloudVoiceControllerTests: XCTestCase {
    private enum TestFailure: Error { case conditionNotReached, audioStart }

    @MainActor
    private struct Fixture {
        let api: CloudVoiceAPI
        let controller: VoiceSessionController
        let audio: ControllerAudioFake
        let socket: ControllerSocketFake

        func close() {
            controller.end()
            audio.startGate?.resolve(false)
            socket.releasePendingReceive()
            api.clearCredentials()
        }
    }

    private func fixture(conversationID: Int = 42,
                         permission: @escaping () async -> Bool = { true },
                         audio: ControllerAudioFake = ControllerAudioFake(),
                         socket: ControllerSocketFake = ControllerSocketFake(),
                         socketFactory: (@MainActor () throws -> any CloudVoiceSocket)? = nil) throws -> Fixture {
        // Construction alone makes no request; socketFactory always replaces the API transport.
        let api = CloudVoiceAPI(endpoint: try CloudVoiceEndpoint("https://example.invalid/api"))
        let controller = VoiceSessionController(api: api, conversationID: conversationID,
                                                audio: audio, permissionRequest: permission,
                                                socketFactory: socketFactory ?? { socket })
        return Fixture(api: api, controller: controller, audio: audio, socket: socket)
    }

    private func eventually(_ description: String, file: StaticString = #filePath, line: UInt = #line,
                            _ predicate: () -> Bool) async throws {
        for _ in 0..<2_000 {
            if predicate() { return }
            await Task.yield()
        }
        XCTFail("Did not reach: \(description)", file: file, line: line)
        throw TestFailure.conditionNotReached
    }

    private func drainScheduledCallbacks() async {
        for _ in 0..<40 { await Task.yield() }
    }

    private func readyEvent() -> [String: Any] {
        ["type": "session.ready", "version": 1, "session_id": UUID().uuidString,
         "input_audio": ["encoding": "pcm_s16le", "sample_rate": 16_000, "channels": 1, "frame_ms": 20],
         "output_audio": ["encoding": "pcm_s16le", "sample_rate": 24_000, "channels": 1],
         "limits": ["max_session_seconds": 300, "max_idle_seconds": 30, "max_response_seconds": 90,
                    "max_utterance_seconds": 20, "max_audio_bytes": 640_000, "max_text_characters": 16_000]]
    }

    private func message(_ event: [String: Any]) throws -> URLSessionWebSocketTask.Message {
        let data = try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys])
        return .string(try XCTUnwrap(String(data: data, encoding: .utf8)))
    }

    private func send(_ event: [String: Any], to fixture: Fixture) async throws {
        try await deliver(message(event), to: fixture)
    }

    private func deliver(_ message: URLSessionWebSocketTask.Message, to fixture: Fixture) async throws {
        let previous = fixture.socket.receiveCalls
        fixture.socket.push(message)
        // A new receive is the barrier proving the previous event handler returned.
        try await eventually("event processed or connection closed") {
            fixture.socket.receiveCalls > previous || !fixture.socket.closeCodes.isEmpty
        }
    }

    private func connect(_ fixture: Fixture, ready: Bool = true) async throws {
        fixture.controller.start()
        try await eventually("session.start sent and receiver installed") {
            fixture.socket.receiveCalls == 1 && fixture.socket.events(ofType: "session.start").count == 1
        }
        if ready {
            try await send(readyEvent(), to: fixture)
            XCTAssertEqual(fixture.controller.phase, .listening(partial: ""))
        }
    }

    private func beginResponse(_ fixture: Fixture, responseID: UUID = UUID()) async throws -> UUID {
        fixture.controller.setMuted(false)
        for _ in 0..<3 { fixture.audio.onCapturedFrame?(Data(repeating: 1, count: 640), 0.1) }
        try await eventually("three ordered input frames") { fixture.socket.pcmFrames.count == 3 }
        fixture.controller.setMuted(true)
        try await eventually("audio.commit after PCM") { fixture.socket.events(ofType: "audio.commit").count == 1 }
        let commit = try XCTUnwrap(fixture.socket.events(ofType: "audio.commit").first)
        let utterance = try XCTUnwrap(commit["utterance_id"] as? String)
        try await send(["type": "asr.final", "utterance_id": utterance,
                        "response_id": responseID.uuidString, "text": "我的问题"], to: fixture)
        XCTAssertEqual(fixture.controller.phase, .thinking(final: "我的问题"))
        return responseID
    }

    private func output(_ responseID: UUID, sequence: UInt32) throws -> URLSessionWebSocketTask.Message {
        .data(try VoicePCMEnvelope(kind: 2, streamID: responseID, sequence: sequence,
                                   pcm: Data(repeating: 0, count: 960)).encoded())
    }

    private func done(_ responseID: UUID, status: String = "completed") -> [String: Any] {
        ["type": "response.done", "response_id": responseID.uuidString, "run_id": "fake-run", "status": status]
    }

    func testValidHandshakeStartsAudioOnlyAfterReadyAndUsesNegotiatedFormats() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f, ready: false)
        XCTAssertEqual(f.controller.phase, .connecting)
        XCTAssertEqual(f.audio.startCalls, 0)
        XCTAssertEqual(f.socket.resumeCalls, 1)
        let start = try XCTUnwrap(f.socket.events(ofType: "session.start").first)
        XCTAssertEqual(start["conversation_id"] as? Int, 42)
        XCTAssertEqual(start["version"] as? Int, 1)
        XCTAssertEqual(start["locale"] as? String, "zh-CN")
        XCTAssertEqual((start["input_audio"] as? [String: Any])?["sample_rate"] as? Int, 16_000)
        XCTAssertEqual((start["output_audio"] as? [String: Any])?["sample_rate"] as? Int, 24_000)
        try await send(readyEvent(), to: f)
        XCTAssertEqual(f.audio.startCalls, 1)
        XCTAssertEqual(f.audio.inputRate, 16_000)
        XCTAssertEqual(f.audio.outputRate, 24_000)
        XCTAssertEqual(f.controller.phase, .listening(partial: ""))
    }

    func testPermissionDenialNeverCreatesSocketOrStartsAudio() async throws {
        var factoryCalls = 0
        let f = try fixture(permission: { false }, socketFactory: {
            factoryCalls += 1
            return ControllerSocketFake()
        })
        defer { f.close() }
        f.controller.start()
        try await eventually("permission failure") { f.controller.phase == .failed(code: "permission_denied", retryable: true) }
        XCTAssertEqual(factoryCalls, 0)
        XCTAssertEqual(f.audio.startCalls, 0)
        XCTAssertNil(f.audio.onCapturedFrame)
    }

    func testInvalidConversationNeverRequestsPermission() async throws {
        for id in [0, -1] {
            var permissionCalls = 0
            let f = try fixture(conversationID: id, permission: { permissionCalls += 1; return true })
            defer { f.close() }
            f.controller.start()
            XCTAssertEqual(f.controller.phase, .failed(code: "protocol_error", retryable: false))
            await drainScheduledCallbacks()
            XCTAssertEqual(permissionCalls, 0)
            XCTAssertEqual(f.socket.resumeCalls, 0)
        }
    }

    func testMalformedReadyFailsBeforeAudioAndCannotRetry() async throws {
        let mutations: [(inout [String: Any]) -> Void] = [
            { $0["version"] = true },
            { $0["version"] = 2 },
            { $0["session_id"] = "not-a-uuid" },
            { $0["input_audio"] = ["encoding": "pcm_s16le", "sample_rate": 48_000, "channels": 1, "frame_ms": 20] },
            { $0["output_audio"] = ["encoding": "pcm_s16le", "sample_rate": 24_000, "channels": 2] },
            { $0["limits"] = nil },
            { event in
                var limits = event["limits"] as! [String: Any]
                limits["max_audio_bytes"] = 640
                event["limits"] = limits
            },
            { event in
                var limits = event["limits"] as! [String: Any]
                limits["max_idle_seconds"] = true
                event["limits"] = limits
            }
        ]
        for mutate in mutations {
            let f = try fixture()
            defer { f.close() }
            try await connect(f, ready: false)
            var event = readyEvent()
            mutate(&event)
            try await send(event, to: f)
            XCTAssertEqual(f.controller.phase, .failed(code: "protocol_error", retryable: false))
            XCTAssertEqual(f.audio.startCalls, 0)
            f.controller.retry()
            await drainScheduledCallbacks()
            XCTAssertEqual(f.socket.resumeCalls, 1)
            XCTAssertEqual(f.controller.phase, .failed(code: "protocol_error", retryable: false))
        }
    }

    func testDuplicateReadyIsFatalWithoutRestartingAudio() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        try await send(readyEvent(), to: f)
        XCTAssertEqual(f.controller.phase, .failed(code: "protocol_error", retryable: false))
        XCTAssertEqual(f.audio.startCalls, 1)
    }

    func testControlEventBeforeReadyIsRejected() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f, ready: false)
        try await send(["type": "text.delta", "response_id": UUID().uuidString, "text": "too early"], to: f)
        XCTAssertEqual(f.controller.phase, .failed(code: "protocol_error", retryable: false))
        XCTAssertEqual(f.controller.assistantCaption, "")
        XCTAssertEqual(f.audio.startCalls, 0)
    }

    func testEndWhilePermissionPendingIgnoresLateGrant() async throws {
        let gate = ControllerAsyncGate<Bool>()
        var factoryCalls = 0
        let f = try fixture(permission: { await gate.wait() }, socketFactory: {
            factoryCalls += 1
            return ControllerSocketFake()
        })
        defer { gate.resolve(false); f.close() }
        f.controller.start()
        try await eventually("permission request waiting") { gate.isWaiting }
        f.controller.end()
        gate.resolve(true)
        try await eventually("permission continuation returned") { gate.didReturn }
        await drainScheduledCallbacks()
        XCTAssertEqual(f.controller.phase, .idle)
        XCTAssertEqual(factoryCalls, 0)
        XCTAssertEqual(f.audio.startCalls, 0)
    }

    func testEndWhileAudioStartPendingCannotRestoreListening() async throws {
        let audio = ControllerAudioFake()
        let gate = ControllerAsyncGate<Bool>()
        audio.startGate = gate
        let f = try fixture(audio: audio)
        defer { f.close() }
        try await connect(f, ready: false)
        f.socket.push(try message(readyEvent()))
        try await eventually("audio startup waiting") { gate.isWaiting }
        let previousStops = audio.stopCalls
        f.controller.end()
        gate.resolve(true)
        try await eventually("audio start continuation returned") { gate.didReturn }
        await drainScheduledCallbacks()
        XCTAssertEqual(f.controller.phase, .idle)
        XCTAssertEqual(audio.stopCalls, previousStops + 1)
        XCTAssertNil(audio.onCapturedFrame)
        XCTAssertEqual(audio.startCalls, 1)
    }

    func testAudioStartFailureClosesSocketAndClearsCallbacks() async throws {
        let audio = ControllerAudioFake()
        audio.startError = TestFailure.audioStart
        let f = try fixture(audio: audio)
        defer { f.close() }
        try await connect(f, ready: false)
        try await send(readyEvent(), to: f)
        XCTAssertEqual(f.controller.phase, .failed(code: "audio_unavailable", retryable: true))
        XCTAssertNil(audio.onCapturedFrame)
        XCTAssertNil(audio.onFailure)
        XCTAssertFalse(f.socket.closeCodes.isEmpty)
    }

    func testNonfatalTTSFailurePreservesAndCompletesNativeText() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        let id = try await beginResponse(f)
        try await send(["type": "text.delta", "response_id": id.uuidString, "text": "保留"], to: f)
        try await deliver(output(id, sequence: 0), to: f)
        try await send(["type": "error", "response_id": id.uuidString, "code": "tts_unavailable",
                        "fatal": false, "retryable": true, "message": "PRIVATE_PROVIDER_DEBUG"], to: f)
        XCTAssertEqual(f.controller.assistantCaption, "保留")
        XCTAssertNotNil(f.controller.serviceNotice)
        XCTAssertFalse(f.controller.serviceNotice?.contains("PRIVATE_PROVIDER_DEBUG") ?? true)
        XCTAssertEqual(f.controller.phase, .thinking(final: "我的问题"))
        XCTAssertEqual(f.audio.stopPlaybackCalls, 1)
        let chunks = f.audio.playback.count
        try await deliver(output(id, sequence: 1), to: f)
        XCTAssertEqual(f.audio.playback.count, chunks)
        try await send(["type": "text.delta", "response_id": id.uuidString, "text": "完整文字"], to: f)
        try await send(done(id), to: f)
        XCTAssertEqual(f.controller.assistantCaption, "保留完整文字")
        XCTAssertEqual(f.controller.completedTurns, 1)
        XCTAssertEqual(f.controller.phase, .listening(partial: ""))
        XCTAssertTrue(f.socket.closeCodes.isEmpty)
    }

    func testForeignResponseEventsCannotChangeCurrentResponse() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        _ = try await beginResponse(f)
        let foreign = UUID()
        try await send(["type": "text.delta", "response_id": foreign.uuidString, "text": "stale"], to: f)
        try await deliver(output(foreign, sequence: 0), to: f)
        try await send(done(foreign, status: "waiting_confirmation"), to: f)
        try await send(["type": "error", "response_id": foreign.uuidString, "code": "agent_unavailable", "fatal": true], to: f)
        XCTAssertEqual(f.controller.phase, .thinking(final: "我的问题"))
        XCTAssertEqual(f.controller.assistantCaption, "")
        XCTAssertFalse(f.controller.approvalRequired)
        XCTAssertEqual(f.controller.completedTurns, 0)
        XCTAssertTrue(f.audio.playback.isEmpty)
    }

    func testInterruptRetiresResponseAndIgnoresLateTextAudioAndErrors() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        let id = try await beginResponse(f)
        try await send(["type": "text.delta", "response_id": id.uuidString, "text": "已显示"], to: f)
        f.controller.interrupt()
        try await eventually("response.interrupt sent") { f.socket.events(ofType: "response.interrupt").count == 1 }
        XCTAssertEqual(f.socket.events(ofType: "response.interrupt").first?["response_id"] as? String, id.uuidString.lowercased())
        try await send(["type": "text.delta", "response_id": id.uuidString, "text": "过期"], to: f)
        try await deliver(output(id, sequence: 0), to: f)
        try await send(done(id), to: f)
        try await send(["type": "error", "response_id": id.uuidString, "code": "agent_unavailable", "fatal": true], to: f)
        XCTAssertEqual(f.controller.phase, .listening(partial: ""))
        XCTAssertEqual(f.controller.assistantCaption, "已显示")
        XCTAssertEqual(f.controller.completedTurns, 0)
        XCTAssertTrue(f.audio.playback.isEmpty)
        XCTAssertEqual(f.audio.stopPlaybackCalls, 1)
    }

    func testOutOfOrderAndDuplicateOutputPCMFailClosed() async throws {
        let sequenceCases: [[UInt32]] = [[1], [0, 0]]
        for sequences in sequenceCases {
            let f = try fixture()
            defer { f.close() }
            try await connect(f)
            let id = try await beginResponse(f)
            for sequence in sequences { try await deliver(output(id, sequence: sequence), to: f) }
            XCTAssertEqual(f.controller.phase, .failed(code: "protocol_error", retryable: false))
            XCTAssertEqual(f.audio.playback.count, sequences.count - 1)
            XCTAssertNil(f.audio.onCapturedFrame)
        }
    }

    func testTTSDoneMustMatchLastReceivedSequence() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        let id = try await beginResponse(f)
        try await deliver(output(id, sequence: 0), to: f)
        try await send(["type": "tts.done", "response_id": id.uuidString, "last_sequence": 1], to: f)
        XCTAssertEqual(f.controller.phase, .failed(code: "protocol_error", retryable: false))
        XCTAssertTrue(f.audio.finishedResponses.isEmpty)
    }

    func testResponseCompletesOnlyAfterBothTerminalEventsAndPlaybackDrain() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        let id = try await beginResponse(f)
        try await deliver(output(id, sequence: 0), to: f)
        f.audio.onPlaybackStarted?(id)
        try await eventually("playback started") { f.controller.phase == .speaking(subtitle: "") }
        try await send(done(id, status: "waiting_confirmation"), to: f)
        XCTAssertTrue(f.controller.approvalRequired)
        XCTAssertEqual(f.controller.completedTurns, 0)
        try await send(["type": "tts.done", "response_id": id.uuidString, "last_sequence": 0], to: f)
        XCTAssertEqual(f.audio.finishedResponses, [id])
        XCTAssertEqual(f.controller.completedTurns, 0)
        f.audio.onPlaybackDrained?(UUID())
        await drainScheduledCallbacks()
        XCTAssertEqual(f.controller.completedTurns, 0)
        f.audio.onPlaybackDrained?(id)
        try await eventually("matching playback drained") { f.controller.completedTurns == 1 }
        XCTAssertEqual(f.controller.phase, .listening(partial: ""))
        try await send(done(id), to: f)
        XCTAssertEqual(f.controller.completedTurns, 1)
    }

    func testMuteCommitsAfterAudioFIFOAndDiscardsQueuedCapture() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        for _ in 0..<3 { f.audio.onCapturedFrame?(Data(repeating: 1, count: 640), 0.1) }
        try await eventually("input frames sent") { f.socket.pcmFrames.count == 3 }
        // This queued callback must not be uploaded after the immediate mute.
        f.audio.onCapturedFrame?(Data(repeating: 2, count: 640), 0.1)
        f.controller.setMuted(true)
        try await eventually("commit delivered") { f.socket.events(ofType: "audio.commit").count == 1 }
        await drainScheduledCallbacks()
        XCTAssertTrue(f.controller.isMuted)
        XCTAssertEqual(f.audio.mutedValues.last, true)
        let frames = f.socket.pcmFrames
        XCTAssertEqual(frames.map(\.sequence), [0, 1, 2])
        XCTAssertEqual(Set(frames.map(\.streamID)).count, 1)
        let commit = try XCTUnwrap(f.socket.events(ofType: "audio.commit").first)
        XCTAssertEqual(commit["last_sequence"] as? Int, 2)
        XCTAssertEqual(commit["utterance_id"] as? String, frames[0].streamID.uuidString.lowercased())
        let kinds = f.socket.sentMessages.map { message -> String in
            if case .data = message { return "pcm" }
            return ControllerSocketFake.event(message)?["type"] as? String ?? "unknown"
        }
        XCTAssertEqual(kinds, ["session.start", "pcm", "pcm", "pcm", "audio.commit"])
    }

    func testEndClearsCallbacksAndIgnoresPreviouslyCapturedClosures() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        let capture = try XCTUnwrap(f.audio.onCapturedFrame)
        let failure = try XCTUnwrap(f.audio.onFailure)
        let interruption = try XCTUnwrap(f.audio.onInterruption)
        let previousStops = f.audio.stopCalls
        f.controller.end()
        capture(Data(repeating: 1, count: 640), 0.1)
        failure("private error")
        interruption()
        try await eventually("socket closed after session.end") { !f.socket.closeCodes.isEmpty }
        await drainScheduledCallbacks()
        XCTAssertEqual(f.controller.phase, .idle)
        XCTAssertEqual(f.audio.stopCalls, previousStops + 1)
        XCTAssertNil(f.audio.onCapturedFrame)
        XCTAssertNil(f.audio.onPlaybackStarted)
        XCTAssertNil(f.audio.onPlaybackDrained)
        XCTAssertNil(f.audio.onFailure)
        XCTAssertNil(f.audio.onInterruption)
        XCTAssertEqual(f.socket.events(ofType: "session.end").count, 1)
        XCTAssertTrue(f.socket.pcmFrames.isEmpty)
    }

    func testRestartIgnoresOldGenerationCallbacksAndPreservesAudioPreferences() async throws {
        let first = ControllerSocketFake()
        let second = ControllerSocketFake()
        var factoryCalls = 0
        let f = try fixture(socket: first, socketFactory: {
            factoryCalls += 1
            return factoryCalls == 1 ? first : second
        })
        defer { f.close(); second.releasePendingReceive() }
        try await connect(f)
        let oldFailure = try XCTUnwrap(f.audio.onFailure)
        let oldInterruption = try XCTUnwrap(f.audio.onInterruption)
        let oldCapture = try XCTUnwrap(f.audio.onCapturedFrame)
        f.controller.setMuted(true)
        f.controller.setSpeaker(false)
        f.controller.start()
        try await eventually("replacement socket waiting") { second.receiveCalls == 1 }
        oldFailure("stale failure")
        oldInterruption()
        oldCapture(Data(repeating: 1, count: 640), 0.1)
        second.push(try message(readyEvent()))
        try await eventually("new generation ready") { f.controller.phase == .listening(partial: "") }
        await drainScheduledCallbacks()
        XCTAssertEqual(factoryCalls, 2)
        XCTAssertTrue(f.controller.isMuted)
        XCTAssertFalse(f.controller.speakerEnabled)
        XCTAssertEqual(f.audio.preferencesAtStart.last?.muted, true)
        XCTAssertEqual(f.audio.preferencesAtStart.last?.speaker, false)
        XCTAssertEqual(f.audio.startCalls, 2)
        XCTAssertTrue(second.pcmFrames.isEmpty)
    }

    func testBackgroundSuspensionStopsAudioAndDoesNotReconnectAutomatically() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        let stops = f.audio.stopCalls
        f.controller.suspend()
        try await eventually("suspended connection closed") { !f.socket.closeCodes.isEmpty }
        await drainScheduledCallbacks()
        XCTAssertEqual(f.controller.phase, .interrupted)
        XCTAssertEqual(f.audio.stopCalls, stops + 1)
        XCTAssertNil(f.audio.onCapturedFrame)
        XCTAssertEqual(f.socket.events(ofType: "session.end").count, 1)
        XCTAssertEqual(f.socket.resumeCalls, 1)
        XCTAssertEqual(f.audio.startCalls, 1)
        f.controller.end()
        let idleStops = f.audio.stopCalls
        f.controller.suspend()
        XCTAssertEqual(f.controller.phase, .idle)
        XCTAssertEqual(f.audio.stopCalls, idleStops)
    }

    func testAudioInterruptionUsesSameSuspensionPath() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        f.audio.onInterruption?()
        try await eventually("audio interruption suspended") { f.controller.phase == .interrupted }
        XCTAssertNil(f.audio.onCapturedFrame)
        XCTAssertEqual(f.audio.startCalls, 1)
    }

    func testLatencyMergesFiniteNumbersAndRejectsBooleanOrNegativeValues() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        let id = try await beginResponse(f)
        try await send(["type": "latency", "response_id": id.uuidString, "asr_first_ms": 10.8,
                        "asr_final_ms": 20, "agent_first_ms": true, "tts_first_ms": -1], to: f)
        XCTAssertEqual(f.controller.latency.asrFirstMS, 10)
        XCTAssertEqual(f.controller.latency.asrFinalMS, 20)
        XCTAssertNil(f.controller.latency.agentFirstMS)
        XCTAssertNil(f.controller.latency.ttsFirstMS)
        try await send(["type": "latency", "response_id": id.uuidString, "agent_first_ms": 30.5], to: f)
        XCTAssertEqual(f.controller.latency.asrFirstMS, 10)
        XCTAssertEqual(f.controller.latency.asrFinalMS, 20)
        XCTAssertEqual(f.controller.latency.agentFirstMS, 30)
    }

    func testCaptureMailboxOverflowFailsClosedWithoutSendingPartialUtterance() async throws {
        let f = try fixture()
        defer { f.close() }
        try await connect(f)
        // No suspension in this loop: the MainActor cannot drain the capture mailbox yet.
        for _ in 0..<26 { f.audio.onCapturedFrame?(Data(repeating: 1, count: 640), 0.1) }
        try await eventually("bounded capture mailbox failure") { f.controller.phase == .failed(code: "audio_unavailable", retryable: true) }
        XCTAssertTrue(f.socket.pcmFrames.isEmpty)
        XCTAssertNil(f.audio.onCapturedFrame)
    }
}

/// Manual continuations model an OS permission or audio-start completion that arrives
/// after cancellation. No timer or real OS resource is involved.
private final class ControllerAsyncGate<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Never>?
    private var returned = false
    private var resolution: Value?

    var isWaiting: Bool { locked { continuation != nil } }
    var didReturn: Bool { locked { returned } }

    func wait() async -> Value {
        let value: Value = await withCheckedContinuation { pending in
            let resolved = locked { () -> Value? in
                if let resolution { return resolution }
                precondition(continuation == nil)
                continuation = pending
                return nil
            }
            if let resolved { pending.resume(returning: resolved) }
        }
        locked { returned = true }
        return value
    }

    func resolve(_ value: Value) {
        let pending = locked { () -> CheckedContinuation<Value, Never>? in
            guard resolution == nil else { return nil }
            resolution = value
            let pending = continuation
            continuation = nil
            return pending
        }
        pending?.resume(returning: value)
    }

    private func locked<T>(_ action: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return action()
    }
}

private final class ControllerSocketFake: CloudVoiceSocket, @unchecked Sendable {
    private let lock = NSLock()
    private var receiver: CheckedContinuation<URLSessionWebSocketTask.Message, Error>?
    private var incoming: [URLSessionWebSocketTask.Message] = []
    private var sent: [URLSessionWebSocketTask.Message] = []
    private var receives = 0
    private var resumes = 0
    private var closes: [URLSessionWebSocketTask.CloseCode] = []

    let response: URLResponse? = nil
    var receiveCalls: Int { locked { receives } }
    var resumeCalls: Int { locked { resumes } }
    var closeCodes: [URLSessionWebSocketTask.CloseCode] { locked { closes } }
    var sentMessages: [URLSessionWebSocketTask.Message] { locked { sent } }
    var pcmFrames: [VoicePCMEnvelope] {
        sentMessages.compactMap {
            guard case .data(let data) = $0 else { return nil }
            return try? VoicePCMEnvelope.decode(data)
        }
    }

    func resume() { locked { resumes += 1 } }

    func receive() async throws -> URLSessionWebSocketTask.Message {
        try await withCheckedThrowingContinuation { pending in
            let immediate: Result<URLSessionWebSocketTask.Message, Error>? = locked {
                receives += 1
                if !closes.isEmpty { return .failure(CancellationError()) }
                if !incoming.isEmpty { return .success(incoming.removeFirst()) }
                precondition(receiver == nil, "The controller must have only one receive loop")
                receiver = pending
                return nil
            }
            if let immediate { pending.resume(with: immediate) }
        }
    }

    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        let closed = locked { () -> Bool in
            guard closes.isEmpty else { return true }
            sent.append(message)
            return false
        }
        if closed { throw CancellationError() }
    }

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let pending = locked { () -> CheckedContinuation<URLSessionWebSocketTask.Message, Error>? in
            closes.append(closeCode)
            incoming.removeAll()
            let pending = receiver
            receiver = nil
            return pending
        }
        pending?.resume(throwing: CancellationError())
    }

    func push(_ message: URLSessionWebSocketTask.Message) {
        let pending = locked { () -> CheckedContinuation<URLSessionWebSocketTask.Message, Error>? in
            guard closes.isEmpty else { return nil }
            if let pending = receiver { receiver = nil; return pending }
            incoming.append(message)
            return nil
        }
        pending?.resume(returning: message)
    }

    func releasePendingReceive() {
        let pending = locked { () -> CheckedContinuation<URLSessionWebSocketTask.Message, Error>? in
            let pending = receiver
            receiver = nil
            return pending
        }
        pending?.resume(throwing: CancellationError())
    }

    func events(ofType type: String) -> [[String: Any]] {
        sentMessages.compactMap(Self.event).filter { $0["type"] as? String == type }
    }

    static func event(_ message: URLSessionWebSocketTask.Message) -> [String: Any]? {
        guard case .string(let text) = message, let data = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func locked<T>(_ action: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return action()
    }
}

/// Callback setters and synchronous controls are driven only by the test MainActor.
/// Async startup records use a lock because nonisolated async methods may hop executors.
private final class ControllerAudioFake: CloudVoiceAudio {
    struct Playback {
        let responseID: UUID
        let sequence: Int
        let pcm: Data
    }
    struct Preferences { let muted: Bool; let speaker: Bool }

    var onCapturedFrame: ((Data, Float) -> Void)?
    var onPlaybackStarted: ((UUID) -> Void)?
    var onPlaybackDrained: ((UUID) -> Void)?
    var onFailure: ((String) -> Void)?
    var onInterruption: (() -> Void)?
    var startGate: ControllerAsyncGate<Bool>?
    var startError: Error?
    private let lock = NSLock()
    private var starts = 0
    private var rates = (input: 0, output: 0)
    private var startupPreferences: [Preferences] = []
    private var muted = false
    private var speaker = true
    private(set) var mutedValues: [Bool] = []
    private(set) var speakerValues: [Bool] = []
    private(set) var playback: [Playback] = []
    private(set) var finishedResponses: [UUID] = []
    private(set) var stopPlaybackCalls = 0
    private(set) var stopCalls = 0

    var startCalls: Int { locked { starts } }
    var inputRate: Int { locked { rates.input } }
    var outputRate: Int { locked { rates.output } }
    var preferencesAtStart: [Preferences] { locked { startupPreferences } }

    func start(inputRate: Int, outputRate: Int) async throws {
        locked {
            starts += 1
            rates = (inputRate, outputRate)
            startupPreferences.append(Preferences(muted: muted, speaker: speaker))
        }
        if let startError { throw startError }
        if let startGate { _ = await startGate.wait() }
    }

    func setMuted(_ value: Bool) {
        locked { muted = value }
        mutedValues.append(value)
    }
    func setSpeaker(_ value: Bool) {
        locked { speaker = value }
        speakerValues.append(value)
    }
    func enqueuePlayback(_ pcm: Data, responseID: UUID, sequence: Int) {
        playback.append(Playback(responseID: responseID, sequence: sequence, pcm: pcm))
    }
    func finishPlayback(responseID: UUID) { finishedResponses.append(responseID) }
    func stopPlayback() { stopPlaybackCalls += 1 }
    func stop() { stopCalls += 1 }

    private func locked<T>(_ action: () -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return action()
    }
}
