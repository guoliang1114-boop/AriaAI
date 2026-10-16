import AVFoundation
import Foundation
import UIKit

/// Foreground-only, full-duplex PCM transport. Every AVAudioEngine mutation and
/// conversion runs on `audioQueue`; the render tap only copies into a bounded pool.
/// Callbacks run on that queue. Consumers must hop to their actor and reject stale
/// session callbacks. No audio is persisted, logged, or sent by this type.
/// Apple API references:
/// https://developer.apple.com/documentation/avfaudio/avaudioionode/setvoiceprocessingenabled(_:)
/// https://developer.apple.com/documentation/avfaudio/avaudioconverter
/// https://developer.apple.com/documentation/avfaudio/avaudioplayernode
final class NativeVoiceAudioEngine: @unchecked Sendable {
    enum Failure: String, LocalizedError {
        case unsupportedFormat = "audio_format_unsupported"
        case permissionDenied = "microphone_permission_denied"
        case permissionDescriptionMissing = "microphone_description_missing"
        case sessionFailed = "audio_session_failed"
        case inputUnavailable = "audio_input_unavailable"
        case outputUnavailable = "audio_output_unavailable"
        case voiceProcessingUnavailable = "voice_processing_unavailable"
        case startFailed = "audio_start_failed"
        case captureOverflow = "audio_capture_overflow"
        case conversionFailed = "audio_conversion_failed"
        case playbackFormatInvalid = "audio_playback_format_invalid"
        case playbackOverflow = "audio_playback_overflow"
        case playbackSequenceInvalid = "audio_playback_sequence_invalid"
        case responseLimitExceeded = "audio_response_limit_exceeded"
        case routeFailed = "audio_route_failed"
        case mediaServicesReset = "audio_media_services_reset"
        case cancelled = "audio_start_cancelled"
        var errorDescription: String? { rawValue }
    }

    private struct Callbacks {
        var captured: ((Data, Float) -> Void)?
        var started: ((UUID) -> Void)?
        var drained: ((UUID) -> Void)?
        var failure: ((String) -> Void)?
        var interruption: (() -> Void)?
    }

    // Public callback access is independently locked; callbacks are never invoked
    // while holding this lock, so they may safely call stop()/setMuted().
    private let callbackLock = NSLock()
    private var callbacks = Callbacks()
    var onCapturedFrame: ((Data, Float) -> Void)? {
        get { readCallbacks().captured }
        set { editCallbacks { $0.captured = newValue } }
    }
    var onPlaybackStarted: ((UUID) -> Void)? {
        get { readCallbacks().started }
        set { editCallbacks { $0.started = newValue } }
    }
    var onPlaybackDrained: ((UUID) -> Void)? {
        get { readCallbacks().drained }
        set { editCallbacks { $0.drained = newValue } }
    }
    var onFailure: ((String) -> Void)? {
        get { readCallbacks().failure }
        set { editCallbacks { $0.failure = newValue } }
    }
    var onInterruption: (() -> Void)? {
        get { readCallbacks().interruption }
        set { editCallbacks { $0.interruption = newValue } }
    }

    /// True only after hardware voice processing has successfully started. There
    /// is deliberately no raw-microphone fallback for the controller's barge-in VAD.
    var isVoiceProcessingAvailable: Bool { gate.voiceProcessingAvailable }

    private static let inputSampleRate = 16_000
    private static let outputSampleRate = 24_000
    private static let frameSamples = 320 // 20 ms at 16 kHz, 640 PCM16 LE bytes.
    private static let tapCapacity: AVAudioFrameCount = 8_192
    private static let maximumRetiredResponses = 2_048
    private let audioQueue = DispatchQueue(label: "com.aria.voice.audio", qos: .userInitiated)
    private let queueKey = DispatchSpecificKey<UInt8>()
    private let gate = AdmissionGate()

    // The fields below are confined to audioQueue, including notification cleanup.
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var converter: AVAudioConverter?
    private var conversionInput: AVAudioPCMBuffer?
    private var conversionOutput: AVAudioPCMBuffer?
    private var playbackFormat: AVAudioFormat?
    private var capturePool: CapturePool?
    private var observers: [NSObjectProtocol] = []
    private var installedTap = false
    private var sessionActive = false
    private var engineEpoch: UInt64 = 0
    private var routeSignature = ""
    private var frame = Data()
    private var frameSquareSum: Float = 0
    private var captureFrameTicket: CaptureTicket?
    private var responseID: UUID?
    private var responseTicket: OutputTicket?
    private var nextSequence = 0
    private var scheduledBuffers = 0
    private var finishRequested = false
    private var retiredResponses = Set<UUID>()

    init() {
        audioQueue.setSpecific(key: queueKey, value: 1)
        frame.reserveCapacity(Self.frameSamples * 2)
    }

    deinit {
        gate.invalidateSession()
        // Weak render/notification handlers do not keep an abandoned session alive.
        if DispatchQueue.getSpecific(key: queueKey) != nil {
            tearDown()
        } else {
            audioQueue.sync { tearDown() }
        }
    }

    static func requestPermission() async -> Bool {
        guard let description = Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") as? String,
              !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }
    }

    /// Only the negotiated wire formats below are implemented. Hardware may run
    /// at another rate; AVAudioConverter resamples processed capture and the main
    /// mixer resamples 24 kHz playback to the hardware output rate.
    func start(inputRate: Int = 16_000, outputRate: Int = 24_000) async throws {
        guard inputRate == Self.inputSampleRate, outputRate == Self.outputSampleRate else {
            throw Failure.unsupportedFormat
        }
        let epoch = gate.currentEpoch
        try await withTaskCancellationHandler {
            guard !Task.isCancelled else { throw Failure.cancelled }
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                audioQueue.async { [weak self] in
                    guard let self else { continuation.resume(throwing: Failure.cancelled); return }
                    guard self.gate.isCurrent(epoch) else {
                        continuation.resume(throwing: Failure.cancelled); return
                    }
                    if self.engine != nil, self.engineEpoch == epoch, self.gate.isActive(epoch) {
                        continuation.resume(returning: ())
                        return
                    }
                    // A stop from another thread may have invalidated the old
                    // engine before its queued cleanup reaches us.
                    if self.engine != nil { self.tearDown() }
                    do {
                        try self.startOnQueue(epoch: epoch)
                        continuation.resume(returning: ())
                    } catch {
                        self.gate.invalidateSession(ifCurrent: epoch)
                        self.tearDown()
                        // Never expose AVFoundation error text or route/device names.
                        continuation.resume(throwing: (error as? Failure) ?? Failure.startFailed)
                    }
                }
            }
        } onCancel: { [weak self] in
            self?.cancelStart(epoch: epoch)
        }
    }

    func setMuted(_ value: Bool) {
        // Invalidate already-copied samples immediately, before the queue hop.
        gate.setMuted(value)
        audioQueue.async { [weak self] in
            guard let self else { return }
            self.clearCapture()
            self.engine?.inputNode.isVoiceProcessingInputMuted = self.gate.isMuted
        }
    }

    func setSpeaker(_ value: Bool) {
        gate.setSpeaker(value)
        audioQueue.async { [weak self] in
            guard let self, self.engine != nil, self.gate.isActive(self.engineEpoch) else { return }
            do {
                // .none restores normal receiver/accessory routing. Do not combine
                // this with .defaultToSpeaker, which would defeat speaker-off.
                try AVAudioSession.sharedInstance().overrideOutputAudioPort(self.gate.speaker ? .speaker : .none)
            } catch { self.fail(.routeFailed) }
        }
    }

    /// Sequence starts at zero per response. The controller owns server response
    /// selection; this layer refuses interleaving, gaps, duplicates and retired IDs.
    /// Ingress is bounded BEFORE dispatch, so a network burst cannot retain an
    /// unbounded number of Data objects waiting for audioQueue.
    func enqueuePlayback(_ pcm: Data, responseID: UUID, sequence: Int) {
        switch gate.admitPlayback(byteCount: pcm.count) {
        case .ignored: return
        case .failed(let failure, let ticket):
            audioQueue.async { [weak self] in
                guard let self, self.gate.accepts(ticket) else { return }
                self.fail(failure)
            }
        case .accepted(let ticket):
            audioQueue.async { [weak self] in
                self?.enqueueOnQueue(pcm, responseID: responseID, sequence: sequence, ticket: ticket)
            }
        }
    }

    func finishPlayback(responseID: UUID) {
        let ticket = gate.outputTicket
        audioQueue.async { [weak self] in
            guard let self, self.gate.accepts(ticket), self.responseTicket == ticket, self.responseID == responseID else { return }
            self.finishRequested = true
            self.finishIfDrained()
        }
    }

    /// Immediately invalidates ingress/completion generations, then flushes the
    /// player on the serial queue. AVAudioPlayerNode.stop() unschedules its buffers;
    /// already-rendered hardware output can still have a route-dependent tail.
    func stopPlayback() {
        let ticket = gate.invalidateOutput()
        audioQueue.async { [weak self] in
            guard let self, self.responseTicket == ticket else { return }
            self.flushPlayback(retire: true)
        }
    }

    func stop() {
        guard let epoch = gate.invalidateSession() else { return }
        audioQueue.async { [weak self] in
            guard let self, self.engineEpoch == epoch else { return }
            self.tearDown()
        }
    }

    private func cancelStart(epoch: UInt64) {
        gate.invalidateSession(ifCurrent: epoch)
        audioQueue.async { [weak self] in
            guard let self, self.engineEpoch == epoch else { return }
            self.tearDown()
        }
    }

    private func startOnQueue(epoch: UInt64) throws {
        guard let description = Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") as? String,
              !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw Failure.permissionDescriptionMissing
        }
        guard AVAudioApplication.shared.recordPermission == .granted else { throw Failure.permissionDenied }
        engineEpoch = epoch
        let session = AVAudioSession.sharedInstance()
        do {
            // No A2DP, mixing, background mode or CallKit session. HFP permits a
            // Bluetooth microphone; actual device rate is inspected after activation.
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
            try session.setPreferredSampleRate(48_000)
            try session.setPreferredIOBufferDuration(0.02)
            try session.setActive(true)
            sessionActive = true
            try session.overrideOutputAudioPort(gate.speaker ? .speaker : .none)
        } catch { throw Failure.sessionFailed }

        let newEngine = AVAudioEngine()
        engine = newEngine
        let input = newEngine.inputNode
        do { try input.setVoiceProcessingEnabled(true) }
        catch { throw Failure.voiceProcessingUnavailable }
        input.isVoiceProcessingBypassed = false
        input.isVoiceProcessingAGCEnabled = true
        input.isVoiceProcessingInputMuted = gate.isMuted
        guard input.isVoiceProcessingEnabled, newEngine.outputNode.isVoiceProcessingEnabled,
              !input.isVoiceProcessingBypassed else { throw Failure.voiceProcessingUnavailable }

        let hardwareOutput = newEngine.outputNode.inputFormat(forBus: 0)
        guard hardwareOutput.sampleRate >= 8_000, hardwareOutput.sampleRate <= 192_000,
              hardwareOutput.channelCount > 0 else { throw Failure.outputUnavailable }
        let sourceFormat = input.outputFormat(forBus: 0)
        guard sourceFormat.sampleRate >= 8_000, sourceFormat.sampleRate <= 192_000,
              sourceFormat.channelCount > 0, sourceFormat.channelCount <= 2,
              sourceFormat.commonFormat == .pcmFormatFloat32,
              let target = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                         sampleRate: Double(Self.inputSampleRate), channels: 1, interleaved: false),
              let output = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                         sampleRate: Double(Self.outputSampleRate), channels: 1, interleaved: false),
              let newConverter = AVAudioConverter(from: sourceFormat, to: target),
              let scratch = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: Self.tapCapacity),
              let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: Self.tapCapacity * 2 + 256),
              let pool = CapturePool(format: sourceFormat, capacity: Self.tapCapacity) else {
            throw Failure.inputUnavailable
        }
        newConverter.downmix = true
        converter = newConverter
        conversionInput = scratch
        conversionOutput = converted
        playbackFormat = output
        capturePool = pool
        let newPlayer = AVAudioPlayerNode()
        player = newPlayer
        newEngine.attach(newPlayer)
        newEngine.connect(newPlayer, to: newEngine.mainMixerNode, format: output)
        let queue = audioQueue
        let admission = gate
        input.installTap(onBus: 0, bufferSize: 1_024, format: sourceFormat) { [weak self, pool, admission] buffer, _ in
            guard let ticket = admission.captureTicket(epoch: epoch) else { return }
            switch pool.copy(buffer) {
            case .buffer(let copied):
                queue.async { [weak self, pool] in
                    defer { pool.release(copied) }
                    guard let self, admission.accepts(ticket) else { return }
                    self.convertCapture(copied, ticket: ticket)
                }
            case .firstOverflow:
                queue.async { [weak self] in
                    guard let self, admission.isActive(epoch) else { return }
                    self.fail(.captureOverflow)
                }
            case .discarded: break
            }
        }
        installedTap = true
        newEngine.prepare()
        do { try newEngine.start() } catch { throw Failure.startFailed }
        guard gate.isCurrent(epoch) else { throw Failure.cancelled }
        guard input.isVoiceProcessingEnabled, !input.isVoiceProcessingBypassed else {
            throw Failure.voiceProcessingUnavailable
        }
        routeSignature = Self.signature(session.currentRoute)
        retiredResponses.removeAll(keepingCapacity: true)
        guard gate.activate(epoch: epoch) else { throw Failure.cancelled }
        installObservers(engine: newEngine, epoch: epoch)
    }

    private func convertCapture(_ source: AVAudioPCMBuffer, ticket: CaptureTicket) {
        guard gate.accepts(ticket), let converter, let scratch = conversionInput,
              let output = conversionOutput else { return }
        if captureFrameTicket != ticket {
            clearCapture()
            captureFrameTicket = ticket
        }
        var offset: AVAudioFrameCount = 0
        // The converter persists across taps. Honour its requested input frame count
        // rather than replaying a tap buffer when the input block is called again.
        for _ in 0..<8 {
            output.frameLength = 0
            var conversionError: NSError?
            var invalidInput = false
            let status = converter.convert(to: output, error: &conversionError) { requested, inputStatus in
                guard offset < source.frameLength else {
                    inputStatus.pointee = .noDataNow
                    return nil
                }
                let count = min(AVAudioFrameCount(requested), source.frameLength - offset)
                guard count > 0, Self.copyFrames(from: source, offset: offset, count: count, to: scratch) else {
                    invalidInput = true
                    inputStatus.pointee = .noDataNow
                    return nil
                }
                offset += count
                inputStatus.pointee = .haveData
                return scratch
            }
            guard !invalidInput, conversionError == nil, status != .error, status != .endOfStream else {
                fail(.conversionFailed); return
            }
            consumeConverted(output, ticket: ticket)
            guard gate.accepts(ticket) else { return }
            if status == .inputRanDry { return }
            if output.frameLength == 0 { fail(.conversionFailed); return }
        }
        fail(.conversionFailed)
    }

    private func consumeConverted(_ buffer: AVAudioPCMBuffer, ticket: CaptureTicket) {
        guard let samples = buffer.floatChannelData?[0] else { fail(.conversionFailed); return }
        for index in 0..<Int(buffer.frameLength) {
            let raw = samples[index]
            let sample = raw.isFinite ? min(1, max(-1, raw)) : 0
            let integer = Int16(max(-32_768, min(32_767, Int((sample * 32_768).rounded()))))
            let bits = UInt16(bitPattern: integer)
            frame.append(UInt8(truncatingIfNeeded: bits))
            frame.append(UInt8(truncatingIfNeeded: bits >> 8))
            frameSquareSum += sample * sample
            if frame.count == Self.frameSamples * 2 {
                guard gate.accepts(ticket) else { clearCapture(); return }
                let rms = sqrt(frameSquareSum / Float(Self.frameSamples))
                let complete = frame
                frame = Data()
                frame.reserveCapacity(Self.frameSamples * 2)
                frameSquareSum = 0
                readCallbacks().captured?(complete, rms)
                // A synchronous callback may mute/stop. Never emit a second frame
                // from that same tap after its generation has been invalidated.
                guard gate.accepts(ticket) else { clearCapture(); return }
            }
        }
    }

    private func enqueueOnQueue(_ pcm: Data, responseID id: UUID, sequence: Int, ticket: OutputTicket) {
        guard gate.accepts(ticket), let player, let format = playbackFormat else {
            gate.releasePlayback(pcm.count, ticket: ticket); return
        }
        if let current = responseTicket, current != ticket {
            // Cancellation can race the enqueue hop on a different caller thread.
            // Retire/flush the old generation before accepting any newer audio.
            flushPlayback(retire: true)
        }
        guard gate.accepts(ticket) else { gate.releasePlayback(pcm.count, ticket: ticket); return }
        guard !retiredResponses.contains(id) else { gate.releasePlayback(pcm.count, ticket: ticket); return }
        if responseID == nil {
            guard sequence == 0 else { gate.releasePlayback(pcm.count, ticket: ticket); fail(.playbackSequenceInvalid); return }
            responseID = id
            responseTicket = ticket
            nextSequence = 0
            finishRequested = false
        }
        guard responseID == id, !finishRequested else { gate.releasePlayback(pcm.count, ticket: ticket); return }
        if sequence < nextSequence { gate.releasePlayback(pcm.count, ticket: ticket); return }
        guard sequence == nextSequence, sequence < Int.max else {
            gate.releasePlayback(pcm.count, ticket: ticket); fail(.playbackSequenceInvalid); return
        }
        let count = pcm.count / 2
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)),
              let samples = buffer.floatChannelData?[0] else {
            gate.releasePlayback(pcm.count, ticket: ticket); fail(.playbackFormatInvalid); return
        }
        buffer.frameLength = AVAudioFrameCount(count)
        pcm.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            for index in 0..<count {
                let bits = UInt16(bytes[index * 2]) | (UInt16(bytes[index * 2 + 1]) << 8)
                samples[index] = Float(Int16(bitPattern: bits)) / 32_768
            }
        }
        guard gate.accepts(ticket) else { gate.releasePlayback(pcm.count, ticket: ticket); return }
        let isFirst = nextSequence == 0
        nextSequence += 1
        scheduledBuffers += 1
        let byteCount = pcm.count
        // .dataConsumed is too early: only .dataPlayedBack may transition the UI
        // back to listening once the server's finish marker has also arrived.
        player.scheduleBuffer(buffer, at: nil, options: [], completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self else { return }
            self.audioQueue.async { [weak self] in
                guard let self, self.gate.accepts(ticket), self.responseID == id else { return }
                self.gate.releasePlayback(byteCount, ticket: ticket)
                self.scheduledBuffers = max(0, self.scheduledBuffers - 1)
                self.finishIfDrained()
            }
        }
        if !player.isPlaying { player.play() }
        // This means playback was submitted to a running device, not an acoustic
        // proof that the first sample has emerged from the speaker.
        if isFirst, gate.accepts(ticket) { readCallbacks().started?(id) }
    }

    private func finishIfDrained() {
        guard finishRequested, scheduledBuffers == 0, let id = responseID else { return }
        guard retire(id) else { return }
        player?.stop()
        responseID = nil
        responseTicket = nil
        nextSequence = 0
        finishRequested = false
        readCallbacks().drained?(id)
    }

    @discardableResult private func retire(_ id: UUID) -> Bool {
        guard retiredResponses.count < Self.maximumRetiredResponses || retiredResponses.contains(id) else {
            fail(.responseLimitExceeded); return false
        }
        // Never evict a tombstone and accidentally let an old response speak again.
        retiredResponses.insert(id)
        return true
    }

    private func flushPlayback(retire shouldRetire: Bool) {
        if shouldRetire, let id = responseID {
            // Failure reporting cannot recurse back into flushPlayback.
            if retiredResponses.count < Self.maximumRetiredResponses { retiredResponses.insert(id) }
            else { fail(.responseLimitExceeded); return }
        }
        player?.stop()
        responseID = nil
        responseTicket = nil
        scheduledBuffers = 0
        nextSequence = 0
        finishRequested = false
    }

    private func clearCapture() {
        converter?.reset()
        captureFrameTicket = nil
        frame.removeAll(keepingCapacity: true)
        frameSquareSum = 0
    }

    private func installObservers(engine: AVAudioEngine, epoch: UInt64) {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
            let value = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            guard value == AVAudioSession.InterruptionType.began.rawValue else { return }
            self?.dispatchInterruption(epoch: epoch)
        })
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.dispatchInterruption(epoch: epoch)
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] note in
            let value = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
            self?.audioQueue.async { [weak self] in self?.handleRouteChange(reason: value, epoch: epoch) }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
            self?.audioQueue.async { [weak self] in
                guard let self, self.gate.isActive(epoch) else { return }
                if self.engine?.isRunning != true || !self.captureFormatUnchanged() { self.interrupt(epoch: epoch) }
            }
        })
        for name in [AVAudioSession.mediaServicesWereLostNotification, AVAudioSession.mediaServicesWereResetNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
                self?.audioQueue.async { [weak self] in
                    guard let self, self.gate.isActive(epoch) else { return }
                    self.fail(.mediaServicesReset)
                }
            })
        }
    }

    private func dispatchInterruption(epoch: UInt64) {
        audioQueue.async { [weak self] in self?.interrupt(epoch: epoch) }
    }

    private func handleRouteChange(reason: UInt, epoch: UInt64) {
        guard gate.isActive(epoch) else { return }
        let session = AVAudioSession.sharedInstance()
        let signature = Self.signature(session.currentRoute)
        guard session.category == .playAndRecord, session.mode == .voiceChat,
              engine?.isRunning == true, captureFormatUnchanged() else { interrupt(epoch: epoch); return }
        if signature == routeSignature { return }
        if reason == AVAudioSession.RouteChangeReason.override.rawValue {
            routeSignature = signature // Our foreground speaker/receiver toggle.
        } else {
            // Headset loss/insertion or changed hardware ends this session. Do not
            // automatically reopen a microphone or replay old speech after a route
            // change; the controller offers an explicit fresh connection.
            interrupt(epoch: epoch)
        }
    }

    private func captureFormatUnchanged() -> Bool {
        guard let engine, let converter else { return false }
        let node = engine.inputNode
        return node.isVoiceProcessingEnabled && !node.isVoiceProcessingBypassed
            && node.outputFormat(forBus: 0).isEqual(converter.inputFormat)
    }

    private func interrupt(epoch: UInt64) {
        guard gate.isActive(epoch) else { return }
        gate.invalidateSession(ifCurrent: epoch)
        tearDown()
        readCallbacks().interruption?()
    }

    private func fail(_ failure: Failure) {
        guard gate.isActive(engineEpoch) else { return }
        gate.invalidateSession(ifCurrent: engineEpoch)
        tearDown()
        readCallbacks().failure?(failure.rawValue)
    }

    private func tearDown() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        if installedTap { engine?.inputNode.removeTap(onBus: 0); installedTap = false }
        flushPlayback(retire: false)
        engine?.stop()
        engine?.reset()
        engine = nil
        player = nil
        converter = nil
        conversionInput = nil
        conversionOutput = nil
        capturePool = nil
        playbackFormat = nil
        frame.removeAll(keepingCapacity: false)
        frameSquareSum = 0
        captureFrameTicket = nil
        retiredResponses.removeAll(keepingCapacity: false)
        routeSignature = ""
        if sessionActive {
            // No resume-on-interruption and no lingering recording session.
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            sessionActive = false
        }
    }

    private func readCallbacks() -> Callbacks {
        callbackLock.lock(); defer { callbackLock.unlock() }
        return callbacks
    }

    private func editCallbacks(_ edit: (inout Callbacks) -> Void) {
        callbackLock.lock(); defer { callbackLock.unlock() }
        edit(&callbacks)
    }

    private static func signature(_ route: AVAudioSessionRouteDescription) -> String {
        (route.inputs.map { $0.uid } + route.outputs.map { $0.uid }).joined(separator: "|")
    }

    /// Copies Float32 PCM in either planar or interleaved hardware layout.
    private static func copyFrames(from source: AVAudioPCMBuffer, offset: AVAudioFrameCount,
                                   count: AVAudioFrameCount, to destination: AVAudioPCMBuffer) -> Bool {
        guard source.format.isEqual(destination.format),
              count <= destination.frameCapacity, offset <= source.frameLength,
              count <= source.frameLength - offset else { return false }
        let inputs = UnsafeMutableAudioBufferListPointer(source.mutableAudioBufferList)
        let outputs = UnsafeMutableAudioBufferListPointer(destination.mutableAudioBufferList)
        guard inputs.count == outputs.count else { return false }
        for index in 0..<inputs.count {
            let stride = Int(inputs[index].mNumberChannels) * MemoryLayout<Float>.size
            let bytes = Int(count) * stride
            guard let input = inputs[index].mData, let output = outputs[index].mData,
                  Int(inputs[index].mDataByteSize) >= (Int(offset) * stride + bytes) else { return false }
            memcpy(output, input.advanced(by: Int(offset) * stride), bytes)
        }
        destination.frameLength = count
        return true
    }

    private struct OutputTicket: Sendable, Equatable { let epoch: UInt64; let revision: UInt64 }
    private struct CaptureTicket: Sendable, Equatable { let epoch: UInt64; let revision: UInt64 }

    /// Only short scalar updates are locked. Invalidation happens at API entry,
    /// independently of AVFoundation queue latency. At most three seconds / 128
    /// packets of playback, and eight capture buffers, can be retained by this type.
    private final class AdmissionGate: @unchecked Sendable {
        enum Admission { case accepted(OutputTicket), failed(Failure, OutputTicket), ignored }
        private let lock = NSLock()
        private var epoch: UInt64 = 0
        private var active = false
        private var muted = false
        private var useSpeaker = true
        private var captureRevision: UInt64 = 0
        private var outputRevision: UInt64 = 0
        private var bytes = 0
        private var packets = 0
        private var failurePending = false
        private func access<T>(_ action: () -> T) -> T {
            lock.lock(); defer { lock.unlock() }; return action()
        }
        var currentEpoch: UInt64 { access { epoch } }
        var isMuted: Bool { access { muted } }
        var speaker: Bool { access { useSpeaker } }
        var voiceProcessingAvailable: Bool { access { active } }
        var outputTicket: OutputTicket { access { OutputTicket(epoch: epoch, revision: outputRevision) } }
        func isCurrent(_ value: UInt64) -> Bool { access { epoch == value } }
        func isActive(_ value: UInt64) -> Bool { access { active && epoch == value } }
        func activate(epoch value: UInt64) -> Bool {
            access {
                guard epoch == value else { return false }
                active = true; failurePending = false
                return true
            }
        }
        func setSpeaker(_ value: Bool) { access { useSpeaker = value } }
        func setMuted(_ value: Bool) { access { muted = value; captureRevision &+= 1 } }
        @discardableResult func invalidateOutput() -> OutputTicket {
            access {
                let old = OutputTicket(epoch: epoch, revision: outputRevision)
                outputRevision &+= 1; bytes = 0; packets = 0; failurePending = false
                return old
            }
        }
        @discardableResult func invalidateSession(ifCurrent value: UInt64? = nil) -> UInt64? {
            access {
                guard value == nil || value == epoch else { return nil }
                let old = epoch
                epoch &+= 1; outputRevision &+= 1; captureRevision &+= 1
                active = false; bytes = 0; packets = 0; failurePending = false
                return old
            }
        }
        func captureTicket(epoch value: UInt64) -> CaptureTicket? {
            access { active && !muted && epoch == value ? CaptureTicket(epoch: epoch, revision: captureRevision) : nil }
        }
        func accepts(_ ticket: CaptureTicket) -> Bool {
            access { active && !muted && ticket.epoch == epoch && ticket.revision == captureRevision }
        }
        func accepts(_ ticket: OutputTicket) -> Bool {
            access { active && ticket.epoch == epoch && ticket.revision == outputRevision }
        }
        func admitPlayback(byteCount: Int) -> Admission {
            access {
                guard active, !failurePending else { return .ignored }
                guard byteCount > 0, byteCount.isMultiple(of: 2), byteCount <= 65_536 else {
                    failurePending = true; return .failed(.playbackFormatInvalid, OutputTicket(epoch: epoch, revision: outputRevision))
                }
                guard bytes + byteCount <= 144_000, packets < 128 else {
                    failurePending = true; return .failed(.playbackOverflow, OutputTicket(epoch: epoch, revision: outputRevision))
                }
                bytes += byteCount; packets += 1
                return .accepted(OutputTicket(epoch: epoch, revision: outputRevision))
            }
        }
        func releasePlayback(_ byteCount: Int, ticket: OutputTicket) {
            access {
                guard ticket.epoch == epoch, ticket.revision == outputRevision else { return }
                bytes = max(0, bytes - byteCount); packets = max(0, packets - 1)
            }
        }
    }

    private final class CapturePool: @unchecked Sendable {
        enum CopyResult { case buffer(AVAudioPCMBuffer), firstOverflow, discarded }
        private let lock = NSLock()
        private var buffers: [AVAudioPCMBuffer] = []
        private var overflowReported = false
        init?(format: AVAudioFormat, capacity: AVAudioFrameCount) {
            for _ in 0..<8 {
                guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
                buffers.append(buffer)
            }
        }
        func copy(_ source: AVAudioPCMBuffer) -> CopyResult {
            guard source.frameLength > 0 else { return .discarded }
            lock.lock()
            guard !overflowReported, let destination = buffers.popLast() else {
                let first = !overflowReported
                overflowReported = true
                lock.unlock()
                return first ? .firstOverflow : .discarded
            }
            lock.unlock()
            guard NativeVoiceAudioEngine.copyFrames(from: source, offset: 0, count: source.frameLength, to: destination) else {
                release(destination)
                lock.lock(); let first = !overflowReported; overflowReported = true; lock.unlock()
                return first ? .firstOverflow : .discarded
            }
            return .buffer(destination)
        }
        func release(_ buffer: AVAudioPCMBuffer) {
            buffer.frameLength = 0
            lock.lock(); buffers.append(buffer); lock.unlock()
        }
    }
}
