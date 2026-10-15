import SwiftUI
import Foundation

/// Native, visual-only counterpart of the supplied HTML voice prototype.
/// No microphone, audio, network, or speech APIs are used.
struct VoiceModeView: View {
    let onClose: () -> Void
    let onComplete: (String) -> Void

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var phase: VoiceDemoPhase = .listening
    @State private var isMuted = false
    @State private var captionsEnabled = true
    @State private var elapsedSeconds = 0
    @State private var timerTask: Task<Void, Never>?
    @State private var isClosing = false
    @State private var previewedReply = false

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    topBar
                    Spacer(minLength: 36)
                    VStack(spacing: 23) {
                        Button(action: advanceState) {
                            AriaVoiceOrb(
                                diameter: min(max(geometry.size.width * 0.48, 205), 330),
                                mood: isMuted ? .resting : phase.orbMood,
                                animated: !isMuted && !isClosing && scenePhase == .active
                            )
                            .padding(26)
                            .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Aria 光球，\(isMuted ? "已静音" : phase.title)")
                        .accessibilityHint(phase == .speaking ? "轻点打断，继续模拟聆听" : "轻点预览下一个语音状态")
                        .accessibilityAction(named: Text("打断并继续说")) { selectState(.listening) }
                        VStack(spacing: 0) {
                            (Text("Aria ").foregroundColor(Theme.secondary)
                             + Text(isMuted ? "已静音" : phase.title).foregroundColor(Theme.ink))
                                .font(.subheadline.weight(.medium))
                            stateIndicators
                        }
                    }
                    Spacer(minLength: 24)
                    transcript
                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 24)
                .padding(.top, 22)
                .padding(.bottom, 10)
                .frame(maxWidth: 600)
                .frame(minHeight: max(0, geometry.size.height))
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
        .background(Color.white.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) { voiceControls }
        .onAppear { if scenePhase == .active { startTimer() } }
        .onChange(of: scenePhase) { _, state in
            if state == .active { startTimer() } else { stopTimer() }
        }
        .onDisappear { stopTimer() }
    }

    private var topBar: some View {
        HStack {
            HStack(spacing: 10) {
                Circle().fill(Theme.ink).frame(width: 8, height: 8)
                    .background(Circle().fill(Theme.ink.opacity(0.07)).frame(width: 16, height: 16))
                    .accessibilityHidden(true)
                Text("Aria").font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
            }
            Spacer()
            Text("模拟 · \(demoDuration(elapsedSeconds))")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(Theme.secondary)
                .accessibilityLabel("语音演示时长 \(elapsedSeconds) 秒，不会使用麦克风")
        }
        .padding(.horizontal, 3)
    }

    private var stateIndicators: some View {
        HStack(spacing: 0) {
            ForEach(VoiceDemoPhase.allCases, id: \.self) { state in
                Button { selectState(state) } label: {
                    Capsule()
                        .fill(phase == state ? Theme.ink : Color(red: 0.87, green: 0.87, blue: 0.89))
                        .frame(width: 28, height: 6)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("预览\(state.title)")
                .accessibilityAddTraits(phase == state ? .isSelected : [])
            }
        }
        .padding(.top, 2)
    }

    private var transcript: some View {
        VStack(spacing: 10) {
            Text("“帮我把明天最重要的三件事排出来。”")
                .font(.caption)
                .foregroundStyle(Theme.secondary.opacity(0.85))
            Text(isMuted ? "已静音，准备好了再继续。" : phase.caption)
                .font(.body)
                .foregroundStyle(Theme.ink)
                .lineSpacing(5)
                .contentTransition(.opacity)
            if phase == .speaking && !isMuted {
                Text("轻点光球，打断并继续说")
                    .font(.caption2)
                    .foregroundStyle(Theme.secondary)
                    .padding(.top, 3)
            }
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: 520, minHeight: 92)
        .opacity(captionsEnabled ? 1 : 0)
        .accessibilityHidden(!captionsEnabled)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("模拟字幕。\(isMuted ? "已静音" : phase.caption)")
    }

    private var voiceControls: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(spacing: 12) { voiceButtons }
                    .frame(maxWidth: 350)
            } else {
                HStack(spacing: 25) { voiceButtons }
                    .frame(maxWidth: 330)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.top, 15)
        .padding(.bottom, 26)
        .background(Color.white)
    }

    @ViewBuilder private var voiceButtons: some View {
        DemoCallControl(
            symbol: isMuted ? "mic.slash" : "mic",
            title: isMuted ? "已静音" : "静音",
            selected: isMuted,
            accessibilityTitle: isMuted ? "取消模拟静音" : "开启模拟静音"
        ) { isMuted.toggle() }
        DemoCallControl(
            symbol: "captions.bubble",
            title: captionsEnabled ? "字幕已开" : "字幕已关",
            selected: captionsEnabled,
            accessibilityTitle: captionsEnabled ? "隐藏模拟字幕" : "显示模拟字幕"
        ) { captionsEnabled.toggle() }
        DemoCallControl(
            symbol: "phone.down",
            title: "结束",
            accessibilityTitle: "结束语音演示并返回聊天",
            action: finishConversation
        )
    }

    private func advanceState() {
        switch phase {
        case .listening: selectState(.thinking)
        case .thinking: selectState(.speaking)
        case .speaking: selectState(.listening)
        }
    }

    private func selectState(_ state: VoiceDemoPhase) {
        guard !isClosing else { return }
        isMuted = false
        if state == .speaking { previewedReply = true }
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) { phase = state }
    }

    private func startTimer() {
        stopTimer()
        guard !isClosing else { return }
        let initialSeconds = elapsedSeconds
        timerTask = Task { @MainActor in
            let startedAt = Date()
            while !Task.isCancelled {
                guard await demoPause(seconds: 1), !isClosing else { return }
                elapsedSeconds = initialSeconds + max(0, Int(Date().timeIntervalSince(startedAt)))
            }
        }
    }

    private func stopTimer() {
        timerTask?.cancel()
        timerTask = nil
    }

    private func finishConversation() {
        guard !isClosing else { return }
        isClosing = true
        stopTimer()
        onComplete(previewedReply
            ? "语音演示已结束。示例安排：优先完成项目决策，再处理沟通事项，最后留出一段不被打扰的深度工作时间。"
            : "语音演示已结束，体验时长 \(demoDuration(elapsedSeconds))。没有使用麦克风或录制音频。")
        onClose()
    }
}

/// Visual-only phone confirmation, connection, and controls. No real call or payment is made.
struct PhoneFlowView: View {
    let onClose: () -> Void
    let onComplete: (String) -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var phase: PhoneDemoPhase = .confirmation
    @State private var isMuted = false
    @State private var speakerEnabled = false
    @State private var showsKeypad = false
    @State private var digits = ""
    @State private var elapsedSeconds = 0
    @State private var simulationTask: Task<Void, Never>?
    @State private var isClosing = false

    var body: some View {
        // A stable container prevents changing phases from cancelling the connection task.
        ZStack {
            Color.white.ignoresSafeArea()
            if phase == .confirmation { confirmationView } else { callView }
        }
        .onChange(of: scenePhase) { _, state in
            if state == .background {
                if phase == .active { finishCall() } else { cancel() }
            }
        }
        .onDisappear { stopSimulation() }
    }

    private var confirmationView: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            Theme.ink.opacity(0.18).ignoresSafeArea()
                .onTapGesture(perform: cancel)
                .accessibilityHidden(true)
            GeometryReader { geometry in
                ScrollView {
                    VStack(alignment: .leading, spacing: 17) {
                        Image(systemName: "phone")
                            .font(.system(size: 21))
                            .foregroundStyle(Theme.ink)
                            .frame(width: 42, height: 42)
                            .background(Color(red: 0.94, green: 0.94, blue: 0.95), in: RoundedRectangle(cornerRadius: 9))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 10) {
                            Text("呼叫 Aria？")
                                .font(.title3.weight(.medium))
                                .foregroundStyle(Theme.ink)
                            Text("电话资费说明（模拟）")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Theme.ink)
                                .accessibilityLabel("电话资费说明，仅为模拟")
                            Text("真实电话通常按运营商资费计费。此处仅演示呼叫流程，不会拨打电话、使用麦克风或产生费用。")
                                .font(.subheadline)
                                .foregroundStyle(Theme.secondary)
                                .lineSpacing(5)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        HStack(spacing: 9) {
                            Spacer(minLength: 0)
                            Button("取消", action: cancel)
                                .foregroundStyle(Theme.ink)
                                .padding(.horizontal, 18)
                                .frame(minHeight: 44)
                                .background(Theme.background, in: RoundedRectangle(cornerRadius: 9))
                                .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.line, lineWidth: 1))
                            Button("呼叫", action: startCall)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 18)
                                .frame(minHeight: 44)
                                .background(Theme.ink, in: RoundedRectangle(cornerRadius: 9))
                                .accessibilityLabel("确认模拟资费并开始模拟呼叫")
                        }
                        .font(.subheadline.weight(.medium))
                        .buttonStyle(.plain)
                        .padding(.top, 6)
                    }
                    .padding(23)
                    .frame(maxWidth: 400, alignment: .leading)
                    .background(.white, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1))
                    .shadow(color: .black.opacity(0.12), radius: 28, y: 18)
                    .padding(20)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: geometry.size.height)
                }
                .scrollIndicators(.hidden)
                .scrollBounceBehavior(.basedOnSize)
            }
        }
    }

    private var callView: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 26) {
                    (Text("Aria").foregroundColor(Theme.ink) + Text(" · 经由电话网关（模拟）").foregroundColor(Theme.secondary))
                        .font(.caption)
                        .multilineTextAlignment(.center)
                        .padding(.top, 26)
                    Spacer(minLength: 20)
                    if showsKeypad {
                        keypad
                    } else {
                        VStack(spacing: 17) {
                            Text("A")
                                .font(.system(size: 38, weight: .medium))
                                .foregroundStyle(.white)
                                .frame(width: 108, height: 108)
                                .background(Theme.ink, in: Circle())
                                .padding(9)
                                .background(Color(red: 0.945, green: 0.945, blue: 0.953), in: Circle())
                                .accessibilityHidden(true)
                            Text("Aria")
                                .font(.system(.title, design: .default, weight: .medium))
                                .foregroundStyle(Theme.ink)
                                .padding(.top, 5)
                            HStack(spacing: 8) {
                                if phase == .calling {
                                    Circle().fill(Theme.ink).frame(width: 7, height: 7)
                                }
                                Text(phase == .calling ? "正在呼叫…" : demoDuration(elapsedSeconds))
                                    .font(.subheadline)
                                    .monospacedDigit()
                                    .foregroundStyle(Theme.secondary)
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(phase == .calling ? "正在模拟呼叫" : "模拟通话时长 \(elapsedSeconds) 秒")
                        }
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: min(340, geometry.size.height * 0.52))
                    }
                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 18)
                .frame(maxWidth: 560)
                .frame(minHeight: max(0, geometry.size.height))
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 20) {
                if phase == .calling {
                    Button("取消", action: cancel)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 32)
                        .frame(minHeight: 52)
                        .background(phoneRed, in: Capsule())
                        .buttonStyle(.plain)
                        .accessibilityLabel("取消模拟呼叫")
                } else {
                    callControls
                }
                Text("模拟体验 · 无真实通话、录音或费用")
                    .font(.caption2)
                    .foregroundStyle(Theme.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity)
            .background(Color.white)
        }
    }

    private var callControls: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) { callButtons }
            } else {
                HStack(spacing: 9) { callButtons }
            }
        }
        .frame(maxWidth: 420)
    }

    @ViewBuilder private var callButtons: some View {
        DemoCallControl(
            symbol: isMuted ? "mic.slash" : "mic",
            title: isMuted ? "已静音" : "静音",
            selected: isMuted,
            accessibilityTitle: isMuted ? "取消模拟静音" : "开启模拟静音"
        ) { isMuted.toggle() }
        DemoCallControl(
            symbol: "speaker.wave.2",
            title: speakerEnabled ? "免提已开" : "免提",
            selected: speakerEnabled,
            accessibilityTitle: speakerEnabled ? "关闭模拟免提" : "打开模拟免提"
        ) { speakerEnabled.toggle() }
        DemoCallControl(
            symbol: "circle.grid.3x3",
            title: showsKeypad ? "关闭键盘" : "拨号键盘",
            selected: showsKeypad,
            accessibilityTitle: showsKeypad ? "关闭模拟拨号键盘" : "打开模拟拨号键盘"
        ) { showsKeypad.toggle() }
        DemoCallControl(
            symbol: "phone.down",
            title: "挂断",
            destructive: true,
            accessibilityTitle: "挂断模拟电话并返回聊天",
            action: finishCall
        )
    }

    private var keypad: some View {
        VStack(spacing: 16) {
            Text(demoDuration(elapsedSeconds))
                .font(.caption).monospacedDigit().foregroundStyle(Theme.secondary)
            HStack(spacing: 10) {
                Text(digits.isEmpty ? "模拟拨号键盘" : digits)
                    .font(.title3)
                    .foregroundStyle(digits.isEmpty ? Theme.secondary : Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .frame(maxWidth: .infinity)
                if !digits.isEmpty {
                    Button { digits.removeLast() } label: {
                        Image(systemName: "delete.left").foregroundStyle(Theme.secondary).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("删除最后一个模拟按键")
                }
            }
            .frame(minHeight: 44)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14), count: 3), spacing: 12) {
                ForEach(["1", "2", "3", "4", "5", "6", "7", "8", "9", "＊", "0", "＃"], id: \.self) { digit in
                    Button { if digits.count < 24 { digits.append(digit) } } label: {
                        Text(digit)
                            .font(.title2)
                            .foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity)
                            .aspectRatio(1, contentMode: .fit)
                            .background(Color(red: 0.94, green: 0.94, blue: 0.95), in: Circle())
                            .overlay(Circle().stroke(Theme.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("模拟按键 \(digit)")
                }
            }
            Text("按键仅展示，不会发送拨号音").font(.caption2).foregroundStyle(Theme.secondary)
        }
        .frame(maxWidth: 300)
    }

    private var phoneRed: Color { Color(red: 223.0 / 255, green: 76.0 / 255, blue: 76.0 / 255) }

    private func startCall() {
        guard phase == .confirmation, !isClosing else { return }
        stopSimulation()
        phase = .calling
        elapsedSeconds = 0
        simulationTask = Task { @MainActor in
            guard await demoPause(seconds: 1.7), !isClosing, scenePhase == .active else {
                cancel()
                return
            }
            phase = .active
            let startedAt = Date()
            while !Task.isCancelled {
                guard await demoPause(seconds: 1), !isClosing else { return }
                elapsedSeconds = max(0, Int(Date().timeIntervalSince(startedAt)))
            }
        }
    }

    private func stopSimulation() {
        simulationTask?.cancel()
        simulationTask = nil
    }

    private func cancel() {
        guard !isClosing else { return }
        isClosing = true
        stopSimulation()
        onClose()
    }

    private func finishCall() {
        guard !isClosing else { return }
        isClosing = true
        stopSimulation()
        onComplete("与 Aria 的模拟电话已结束，体验时长 \(demoDuration(elapsedSeconds))。未拨打真实电话，未产生任何费用。")
        onClose()
    }
}

private enum VoiceDemoPhase: CaseIterable {
    case listening, thinking, speaking

    var title: String {
        switch self {
        case .listening: return "正在听"
        case .thinking: return "正在想"
        case .speaking: return "正在说"
        }
    }

    var caption: String {
        switch self {
        case .listening: return "我在听，你可以自然地说。"
        case .thinking: return "我正在结合你的日程和优先级整理。"
        case .speaking: return "明天可以先完成最重要的项目决策，再处理沟通事项，最后留一段不被打扰的深度工作时间。"
        }
    }

    var orbMood: VoiceOrbMood {
        switch self {
        case .listening: return .listening
        case .thinking: return .thinking
        case .speaking: return .speaking
        }
    }
}

private enum PhoneDemoPhase { case confirmation, calling, active }
private enum VoiceOrbMood { case resting, listening, thinking, speaking }

/// Circular charcoal controls mirror the reference; large text uses roomy rounded rows.
private struct DemoCallControl: View {
    let symbol: String
    let title: String
    var selected = false
    var destructive = false
    let accessibilityTitle: String
    let action: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var color: Color {
        if destructive { return Color(red: 223.0 / 255, green: 76.0 / 255, blue: 76.0 / 255) }
        return selected ? Color(red: 21.0 / 255, green: 21.0 / 255, blue: 23.0 / 255) : Theme.ink
    }

    var body: some View {
        Button(action: action) {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    HStack(spacing: 12) {
                        Image(systemName: symbol).font(.title3)
                        Text(title).font(.caption)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, minHeight: 60)
                    .background(color, in: RoundedRectangle(cornerRadius: 18))
                } else {
                    VStack(spacing: 6) {
                        Image(systemName: symbol).font(.system(size: 22, weight: .regular))
                        Text(title).font(.caption2).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity)
                    .aspectRatio(1, contentMode: .fit)
                    .background(color, in: Circle())
                }
            }
            .foregroundStyle(.white)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : 74)
        .accessibilityLabel(accessibilityTitle)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Native gradient layers reproduce the reference's cyan, conic, and peach states.
private struct AriaVoiceOrb: View {
    let diameter: CGFloat
    var mood: VoiceOrbMood = .listening
    var animated = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var listeningColors: [Color] {
        [.white, Color(red: 0.81, green: 0.99, blue: 0.96), Color(red: 0.44, green: 0.86, blue: 0.86), Color(red: 0.62, green: 0.59, blue: 0.96), Color(red: 0.96, green: 0.62, blue: 0.78).opacity(0.80)]
    }
    private var speakingColors: [Color] {
        [.white, Color(red: 1, green: 0.89, blue: 0.72), Color(red: 0.98, green: 0.60, blue: 0.57), Color(red: 0.83, green: 0.53, blue: 0.89), Color(red: 0.40, green: 0.75, blue: 0.91).opacity(0.74)]
    }
    private var conicColors: [Color] {
        [Color(red: 0.45, green: 0.81, blue: 0.96), Color(red: 0.58, green: 0.52, blue: 0.96), Color(red: 0.94, green: 0.60, blue: 0.80), Color(red: 0.46, green: 0.87, blue: 0.81), Color(red: 0.45, green: 0.81, blue: 0.96)]
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion || !animated)) { context in
            let time = reduceMotion || !animated ? 0 : context.date.timeIntervalSinceReferenceDate
            let period = mood == .thinking ? 2.1 : (mood == .speaking ? 0.78 : 3.8)
            let wave = sin(time * 2 * .pi / period)
            let breathing = mood == .resting ? 1.0 : (mood == .speaking ? 1.01 + wave * 0.07 : 0.988 + wave * 0.038)
            let core = diameter * 0.70
            ZStack {
                Circle()
                    .stroke(Color(red: 0.55, green: 0.50, blue: 0.90).opacity(0.13), lineWidth: 1)
                    .frame(width: diameter * 1.04, height: diameter * 1.04)
                    .scaleEffect(reduceMotion || !animated ? 1 : 1 + wave * 0.025)
                Circle()
                    .stroke(Color(red: 0.29, green: 0.75, blue: 0.73).opacity(0.22), lineWidth: 1)
                    .frame(width: diameter * 0.92, height: diameter * 0.92)
                Circle()
                    .fill(mood == .speaking ? Color(red: 0.96, green: 0.57, blue: 0.54).opacity(0.28) : Color(red: 0.30, green: 0.79, blue: 0.76).opacity(0.28))
                    .frame(width: core * 1.08, height: core * 1.08)
                    .blur(radius: 27)
                Circle()
                    .fill(Color(red: 0.54, green: 0.50, blue: 0.93).opacity(0.22))
                    .frame(width: core * 1.25, height: core * 1.25)
                    .blur(radius: 44)
                ZStack {
                    if mood == .thinking {
                        Circle().fill(AngularGradient(colors: conicColors, center: .center, startAngle: .degrees(35), endAngle: .degrees(395)))
                        Circle()
                            .fill(RadialGradient(colors: [.white.opacity(0.82), .white.opacity(0.10), .clear], center: .center, startRadius: 0, endRadius: core * 0.50))
                            .blur(radius: 9)
                    } else {
                        Circle().fill(RadialGradient(colors: mood == .speaking ? speakingColors : listeningColors, center: UnitPoint(x: 0.34, y: 0.28), startRadius: core * 0.025, endRadius: core * 0.90))
                        Ellipse()
                            .fill(.white.opacity(0.62))
                            .frame(width: core * 0.68, height: core * 0.35)
                            .blur(radius: 15)
                            .offset(x: -core * 0.08, y: -core * 0.23)
                        Ellipse()
                            .fill(Color(red: 0.47, green: 0.91, blue: 0.85).opacity(0.19))
                            .frame(width: core * 0.56, height: core * 0.44)
                            .blur(radius: 17)
                            .offset(x: core * 0.17, y: core * 0.23)
                            .blendMode(.multiply)
                    }
                }
                .frame(width: core, height: core)
                .clipShape(Circle())
                .rotationEffect(.degrees(mood == .thinking && !reduceMotion && animated ? wave * 8.5 : 0))
                .scaleEffect(breathing)
                .offset(y: mood == .listening && !reduceMotion && animated ? wave * -3 : 0)
            }
            .frame(width: diameter, height: diameter)
            .opacity(mood == .resting ? 0.58 : 1)
        }
        .frame(width: diameter, height: diameter)
        .accessibilityHidden(true)
    }
}

private func demoDuration(_ seconds: Int) -> String {
    String(format: "%02d:%02d", seconds / 60, seconds % 60)
}

private func demoPause(seconds: Double) async -> Bool {
    do {
        try await Task.sleep(for: .seconds(seconds))
        return !Task.isCancelled
    } catch {
        return false
    }
}
