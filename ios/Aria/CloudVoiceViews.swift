import SwiftUI
import Combine

@MainActor
final class CloudVoiceWorkspace: ObservableObject {
    @Published private(set) var user: CloudVoiceUser?
    @Published private(set) var conversations: [CloudConversation] = []
    @Published private(set) var messages: [CloudTranscriptMessage] = []
    @Published private(set) var selectedConversationID: Int?
    @Published private(set) var busy = false
    @Published private(set) var error: String?
    @Published private(set) var hasOlderMessages = false
    @Published var pendingApproval = false
    private(set) var api: CloudVoiceAPI?
    private var task: Task<Void, Never>?
    private var generation = UUID()

    var endpoint: CloudVoiceEndpoint? { api?.endpoint }

    func login(endpoint: String, email: String, password: String) {
        guard !busy, !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !password.isEmpty else { return }
        do {
            let client = CloudVoiceAPI(endpoint: try CloudVoiceEndpoint(endpoint))
            close()
            api = client
            busy = true
            error = nil
            let current = generation
            task = Task { [weak self] in
                do {
                    let user = try await client.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
                    guard let self, self.generation == current, !Task.isCancelled else { client.clearCredentials(); return }
                    self.user = user
                    let conversations = try await client.conversations()
                    guard self.generation == current, !Task.isCancelled else { return }
                    self.conversations = conversations
                    self.busy = false
                    if let first = conversations.first { self.select(first.id) }
                } catch {
                    guard let self, self.generation == current, !Task.isCancelled else { client.clearCredentials(); return }
                    self.record(error)
                    self.busy = false
                }
            }
        } catch { record(error) }
    }

    func refreshConversations() {
        guard !busy, let api else { return }
        busy = true
        error = nil
        let current = generation
        task = Task { [weak self] in
            do {
                let items = try await api.conversations()
                guard let self, self.generation == current, !Task.isCancelled else { return }
                self.conversations = items
                self.busy = false
                if let selected = self.selectedConversationID, items.contains(where: { $0.id == selected }) {
                    self.refreshTranscript()
                } else if let first = items.first { self.select(first.id) }
                else { self.selectedConversationID = nil; self.messages = [] }
            } catch { self?.finish(error, generation: current) }
        }
    }

    /// Explicit UI action creates only a standalone conversation using native API defaults.
    func createConversation() {
        guard !busy, let api else { return }
        busy = true
        error = nil
        let current = generation
        task = Task { [weak self] in
            do {
                let item = try await api.createConversation()
                guard let self, self.generation == current, !Task.isCancelled else { return }
                self.conversations.insert(item, at: 0)
                self.busy = false
                self.select(item.id)
            } catch { self?.finish(error, generation: current) }
        }
    }

    func select(_ id: Int) {
        guard !busy, conversations.contains(where: { $0.id == id }) else { return }
        selectedConversationID = id
        messages = []
        pendingApproval = false
        refreshTranscript()
    }

    func refreshTranscript(older: Bool = false) {
        guard !busy, let api, let id = selectedConversationID else { return }
        busy = true
        error = nil
        let current = generation
        let beforeID = older ? messages.first?.id : nil
        task = Task { [weak self] in
            do {
                let items = try await api.messages(conversationID: id, beforeID: beforeID)
                guard let self, self.generation == current, self.selectedConversationID == id, !Task.isCancelled else { return }
                if older {
                    let existing = Set(self.messages.map(\.id))
                    self.messages.insert(contentsOf: items.filter { !existing.contains($0.id) }, at: 0)
                } else { self.messages = items }
                self.hasOlderMessages = items.count == 50
                self.busy = false
            } catch { self?.finish(error, generation: current) }
        }
    }

    func close() {
        generation = UUID()
        task?.cancel(); task = nil
        api?.clearCredentials(); api = nil
        user = nil
        messages = []
        conversations = []
        selectedConversationID = nil
        busy = false
        error = nil
        pendingApproval = false
        hasOlderMessages = false
    }

    func logout() async -> Bool {
        let client = api
        api = nil // close() must not erase the credential before its revocation request.
        close()
        busy = true
        let current = generation
        let revoked = await client?.revokeSession() ?? true
        guard generation == current else { return revoked }
        busy = false
        if !revoked {
            error = "本机登录信息已清除，但未能确认服务器登录令牌已撤销。请检查服务器登录会话；你可以再次关闭此页面。"
        }
        return revoked
    }

    private func finish(_ error: Error, generation: UUID) {
        guard self.generation == generation, !Task.isCancelled else { return }
        record(error)
        busy = false
    }

    private func record(_ error: Error) {
        let failure = error as? CloudVoiceFailure ?? .unavailable
        if failure == .signedOut {
            api?.clearCredentials(); api = nil
            user = nil
            messages = []
            conversations = []
            selectedConversationID = nil
        }
        self.error = failure.explanation
    }
}

/// A separate, real account workspace. It cannot see AppStore's demo credentials or UUIDs.
struct CloudVoiceWorkspaceView: View {
    let onClose: () -> Void
    @StateObject private var workspace = CloudVoiceWorkspace()
    @Environment(\.scenePhase) private var scenePhase
    @State private var endpoint = ""
    @State private var email = ""
    @State private var password = ""
    @State private var controller: VoiceSessionController?
    @State private var showingVoice = false
    @State private var loggingOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if workspace.user == nil { loginForm } else { conversationWorkspace }
                    if workspace.busy { ProgressView("正在读取自己的 Aria 服务器…").font(.caption) }
                    if let error = workspace.error {
                        Text(error).font(.subheadline).foregroundStyle(.red).accessibilityLabel("错误：\(error)")
                    }
                }.padding(22).frame(maxWidth: 760).frame(maxWidth: .infinity)
            }
            .background(Color.white)
            .navigationTitle("真实 Aria 语音")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("关闭") { close() }.frame(minHeight: 44).disabled(loggingOut)
                }
                if workspace.user != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("退出登录") { logout(closeAfter: false) }
                            .frame(minHeight: 44)
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $showingVoice, onDismiss: {
            if let controller { workspace.pendingApproval = controller.approvalRequired }
            controller?.end()
            controller = nil
            workspace.refreshTranscript()
        }) {
            if let controller, let endpoint = workspace.endpoint {
                CloudLiveVoiceView(controller: controller, approvalURL: endpoint.approvalURL(conversationID: controller.conversationID)) {
                    controller.end()
                    showingVoice = false
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { password = ""; controller?.suspend() }
        }
        .onDisappear {
            password = ""
            if !showingVoice { controller?.end(); workspace.close() }
        }
    }

    private var loginForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            AriaVoiceOrb(diameter: 148, mood: .resting, animated: false).frame(maxWidth: .infinity)
            Text("连接你自己的 Aria").font(.title2.weight(.semibold)).foregroundStyle(Theme.ink)
            Text("输入已部署的 HTTPS API 地址和真实账号。登录凭据仅用于本次连接，令牌只保留在内存中。")
                .font(.subheadline).foregroundStyle(Theme.secondary)
            VStack(alignment: .leading, spacing: 8) {
                Text("HTTPS API 地址").font(.caption.weight(.medium))
                TextField("https://你的域名/api", text: $endpoint)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder).accessibilityLabel("自己的 Aria HTTPS API 地址")
                Text("通常以 /api 结尾；不会跟随重定向。")
                    .font(.caption2).foregroundStyle(Theme.secondary)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("邮箱").font(.caption.weight(.medium))
                TextField("Aria 账号邮箱", text: $email)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder).accessibilityLabel("真实 Aria 账号邮箱")
                Text("密码").font(.caption.weight(.medium)).padding(.top, 8)
                SecureField("Aria 账号密码", text: $password)
                    .textFieldStyle(.roundedBorder).accessibilityLabel("真实 Aria 账号密码")
            }
            PrimaryButton("登录自己的服务器") {
                let secret = password
                password = ""
                workspace.login(endpoint: endpoint, email: email, password: secret)
            }
            .disabled(workspace.busy || endpoint.isEmpty || email.isEmpty || password.isEmpty)
            Text("开始语音后，麦克风音频会通过加密连接发送到此服务器，再由服务器调用已配置的识别、Aria Agent 和合成服务。本机不保存原始音频。")
                .font(.caption).foregroundStyle(Theme.secondary)
        }
    }

    private var conversationWorkspace: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let user = workspace.user {
                Text(user.display_name.isEmpty ? user.email : user.display_name).font(.headline)
                Text(workspace.endpoint?.baseURL.absoluteString ?? "").font(.caption).foregroundStyle(Theme.secondary)
                    .textSelection(.enabled)
            }
            HStack {
                Text("服务器会话").font(.headline)
                Spacer()
                Button { workspace.refreshConversations() } label: { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44) }
                    .disabled(workspace.busy).accessibilityLabel("刷新真实服务器会话")
            }
            if !workspace.conversations.isEmpty {
                Picker("选择真实会话", selection: Binding(
                    get: { workspace.selectedConversationID ?? 0 }, set: { workspace.select($0) }
                )) {
                    ForEach(workspace.conversations) { item in
                        Text(item.title.isEmpty ? "会话 \(item.id)" : item.title).tag(item.id)
                    }
                }.pickerStyle(.menu).disabled(workspace.busy)
            } else {
                Text("账号还没有可访问的会话，可以创建一个新的独立会话。").font(.subheadline).foregroundStyle(Theme.secondary)
            }
            Button { workspace.createConversation() } label: { Label("新建真实会话", systemImage: "plus.bubble").frame(minHeight: 44) }
                .disabled(workspace.busy)
            PrimaryButton("开始真实语音") {
                guard let api = workspace.api, let id = workspace.selectedConversationID,
                      workspace.conversations.contains(where: { $0.id == id }) else { return }
                controller = VoiceSessionController(api: api, conversationID: id)
                showingVoice = true
            }.disabled(workspace.busy || workspace.selectedConversationID == nil)
            if workspace.pendingApproval, let endpoint = workspace.endpoint, let id = workspace.selectedConversationID {
                CloudApprovalNotice(url: endpoint.approvalURL(conversationID: id))
            }
            Divider()
            HStack {
                Text("真实会话记录").font(.headline)
                Spacer()
                Button("刷新") { workspace.refreshTranscript() }.disabled(workspace.busy).frame(minHeight: 44)
            }
            if workspace.hasOlderMessages {
                Button("加载更早消息") { workspace.refreshTranscript(older: true) }.disabled(workspace.busy).frame(minHeight: 44)
            }
            if workspace.messages.isEmpty {
                Text(workspace.busy ? "正在读取会话记录…" : "这里会显示服务器已保存的消息。")
                    .font(.subheadline).foregroundStyle(Theme.secondary).padding(.vertical, 20)
            }
            ForEach(workspace.messages) { message in
                VStack(alignment: .leading, spacing: 7) {
                    Text(message.role == "user" ? "你" : (message.role == "assistant" ? "Aria" : "系统"))
                        .font(.caption.weight(.medium)).foregroundStyle(Theme.secondary)
                    Text(message.content).font(.body).textSelection(.enabled)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
                    .background(Theme.background, in: RoundedRectangle(cornerRadius: 16))
            }
            Text("此页面的记录来自服务器，与本地演示会话独立。涉及确认的操作，请进入真实网页会话审阅。")
                .font(.caption).foregroundStyle(Theme.secondary)
        }
    }

    private func close() {
        logout(closeAfter: true)
    }

    private func logout(closeAfter: Bool) {
        guard !loggingOut else { return }
        controller?.end()
        controller = nil
        password = ""
        loggingOut = true
        Task {
            let revoked = await workspace.logout()
            loggingOut = false
            if closeAfter && revoked { onClose() }
        }
    }
}

private struct CloudApprovalNotice: View {
    let url: URL
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("有操作等待你确认", systemImage: "hand.raised").font(.subheadline.weight(.medium))
            Text("请在真实 Aria 网页会话中查看完整内容并确认。语音里的“同意”不会替代审批。")
                .font(.caption).foregroundStyle(Theme.secondary)
            Link("打开真实 Aria 会话审阅", destination: url).font(.subheadline).frame(minHeight: 44)
            Text("网页可能需要单独登录，不会通过链接传递令牌。").font(.caption2).foregroundStyle(Theme.secondary)
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.background, in: RoundedRectangle(cornerRadius: 14))
    }
}

struct CloudLiveVoiceView: View {
    @ObservedObject var controller: VoiceSessionController
    let approvalURL: URL
    let onClose: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var captionsEnabled = true

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 24) {
                    HStack {
                        Text("Aria").font(.headline)
                        Spacer()
                        Text("真实会话 · \(controller.conversationID)").font(.caption).foregroundStyle(Theme.secondary)
                    }.padding(.top, 18)
                    Button { controller.interrupt() } label: {
                        AriaVoiceOrb(diameter: min(310, max(180, geometry.size.width * 0.55)), mood: mood,
                                     animated: scenePhase == .active && active && !controller.isMuted)
                            .padding(20).contentShape(Circle())
                    }.buttonStyle(.plain)
                        .accessibilityLabel("Aria 光球，\(controller.phase.title)")
                        .accessibilityHint("回复过程中轻点可打断")
                    Text(controller.isMuted && active ? "麦克风已静音" : controller.phase.title)
                        .font(.title3.weight(.medium))
                    if let error = controller.errorExplanation {
                        Text(error).font(.subheadline).foregroundStyle(.red).multilineTextAlignment(.center)
                    }
                    if let notice = controller.serviceNotice {
                        Text(notice).font(.subheadline).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
                    }
                    if captionsEnabled {
                        VStack(spacing: 14) {
                            if !controller.userCaption.isEmpty {
                                Text(controller.userCaption).font(.subheadline).foregroundStyle(Theme.secondary)
                                    .accessibilityLabel("你的话：\(controller.userCaption)")
                            }
                            if !controller.assistantCaption.isEmpty {
                                Text(controller.assistantCaption).font(.body).foregroundStyle(Theme.ink)
                                    .accessibilityLabel("Aria：\(controller.assistantCaption)")
                            } else if case .listening = controller.phase {
                                Text("直接说话，停顿后会自动发送。")
                                    .font(.subheadline).foregroundStyle(Theme.secondary)
                            }
                        }.multilineTextAlignment(.center).textSelection(.enabled)
                            .frame(maxWidth: .infinity, minHeight: 84)
                    }
                    if controller.approvalRequired { CloudApprovalNotice(url: approvalURL) }
                    if canRetry {
                        PrimaryButton(controller.phase == .interrupted ? "恢复语音连接" : "重试连接") { controller.retry() }
                    }
                    if let milliseconds = controller.latency.firstPlaybackMS {
                        Text("本机首段播放调度延迟估计：\(milliseconds) ms").font(.caption2).foregroundStyle(Theme.secondary)
                    }
                    Text("音频仅发往你配置的 Aria 服务器 · 离开前台会暂停麦克风")
                        .font(.caption2).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
                }.padding(.horizontal, 24).padding(.bottom, 20).frame(maxWidth: 650).frame(maxWidth: .infinity)
            }
        }
        .background(Color.white.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 12) {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(spacing: 10) { controls }
                } else { HStack(spacing: 12) { controls } }
                Button(captionsEnabled ? "隐藏字幕" : "显示字幕") { captionsEnabled.toggle() }
                    .font(.caption).frame(minHeight: 44).accessibilityLabel(captionsEnabled ? "隐藏真实语音字幕" : "显示真实语音字幕")
            }.padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 12)
                .frame(maxWidth: .infinity).background(Color.white)
        }
        .task { controller.start() }
        .onChange(of: scenePhase) { _, phase in if phase == .background { controller.suspend() } }
        .onDisappear { controller.end() }
    }

    @ViewBuilder private var controls: some View {
        control(controller.isMuted ? "取消静音" : "静音", symbol: controller.isMuted ? "mic.slash" : "mic", disabled: !active) {
            controller.setMuted(!controller.isMuted)
        }
        control(controller.speakerEnabled ? "扬声器" : "听筒", symbol: controller.speakerEnabled ? "speaker.wave.2" : "ear", disabled: !active) {
            controller.setSpeaker(!controller.speakerEnabled)
        }
        control("结束", symbol: "phone.down", disabled: false) { controller.end(); onClose() }
    }

    private func control(_ title: String, symbol: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) { Image(systemName: symbol).font(.title3); Text(title).font(.caption) }
                .frame(maxWidth: .infinity, minHeight: 66).foregroundStyle(.white)
                .background(Theme.ink.opacity(disabled ? 0.4 : 1), in: RoundedRectangle(cornerRadius: 23))
        }.buttonStyle(.plain).disabled(disabled).accessibilityLabel(title)
    }

    private var active: Bool {
        switch controller.phase {
        case .listening, .thinking, .speaking: return true
        default: return false
        }
    }

    private var canRetry: Bool {
        switch controller.phase {
        case .interrupted: return true
        case .failed(_, let retryable): return retryable
        default: return false
        }
    }

    private var mood: VoiceOrbMood {
        if controller.isMuted { return .resting }
        switch controller.phase {
        case .listening: return .listening
        case .thinking, .connecting: return .thinking
        case .speaking: return .speaking
        default: return .resting
        }
    }
}
