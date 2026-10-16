import SwiftUI
import UIKit

private enum ChatSheet: String, Identifiable { case conversations, search, status; var id: String { rawValue } }
private enum ChatMode: String, Identifiable { case cloudVoice, voice, phone; var id: String { rawValue } }

struct ChatView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var sheet: ChatSheet?
    @State private var mode: ChatMode?
    @State private var showsVoiceOptions = false
    @State private var scrollTarget: UUID?
    @State private var highlightedMessageID: UUID?
    @State private var isNearBottom = true
    @State private var hasUnreadResponse = false
    @FocusState private var composerFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Divider().overlay(Theme.line)
                messagesView
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { composer }
            .background(Theme.background)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    IconButton(symbol: "line.3.horizontal", label: "打开会话列表") { present(.conversations) }
                }
                ToolbarItem(placement: .principal) {
                    Button { present(.status) } label: {
                        HStack(spacing: 9) {
                            if horizontalSizeClass == .regular && !dynamicTypeSize.isAccessibilitySize {
                                AriaMark(size: 32, circular: true)
                            }
                            Text("Aria").font(.headline).foregroundStyle(Theme.ink).lineLimit(1)
                        }.frame(minHeight: 44)
                    }.buttonStyle(.plain).accessibilityLabel("Aria 状态与个人设置")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if dynamicTypeSize.isAccessibilitySize {
                        Menu {
                            Button { present(.search) } label: { Label("搜索聊天记录", systemImage: "magnifyingglass") }
                            Button { composerFocused = false; showsVoiceOptions = true } label: { Label("语音对话", systemImage: "mic") }
                            Button { present(.status) } label: { Label("状态与设置", systemImage: "person.crop.circle") }
                        } label: {
                            Image(systemName: "ellipsis.circle").font(.title3).frame(width: 44, height: 44)
                        }.accessibilityLabel("更多聊天操作")
                    } else {
                        IconButton(symbol: "magnifyingglass", label: "搜索聊天记录") { present(.search) }
                        IconButton(symbol: "mic", label: "选择真实或演示语音对话") { composerFocused = false; showsVoiceOptions = true }
                    }
                    IconButton(symbol: "phone", label: "模拟电话") { composerFocused = false; mode = .phone }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("收起键盘") { composerFocused = false }
                        .accessibilityLabel("收起消息输入键盘")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $sheet) { sheet in
                switch sheet {
                case .conversations: ConversationListView { scrollTarget = nil; highlightedMessageID = nil }
                case .search: ChatSearchView { conversationID, messageID in
                    store.selectConversation(id: conversationID)
                    scrollTarget = messageID
                    highlightedMessageID = messageID
                }
                case .status: StatusView()
                }
            }
            .confirmationDialog("选择语音模式", isPresented: $showsVoiceOptions, titleVisibility: .visible) {
                Button("连接真实 Aria 语音") { mode = .cloudVoice }
                Button("查看本地语音演示") { mode = .voice }
                Button("取消", role: .cancel) { }
            } message: {
                Text("真实语音需要登录自己的 HTTPS Aria 服务器；本地演示不连接服务。")
            }
            .fullScreenCover(item: $mode) { mode in
                switch mode {
                case .cloudVoice:
                    CloudVoiceWorkspaceView(onClose: { self.mode = nil })
                case .voice:
                    VoiceModeView(onClose: { self.mode = nil }, onComplete: { summary in store.addCallSummary(summary) })
                case .phone:
                    PhoneFlowView(onClose: { self.mode = nil }, onComplete: { summary in store.addCallSummary(summary) })
                }
            }
            .onChange(of: store.selectedConversationID) { _, _ in composerFocused = false }
            .onChange(of: store.chatContextID) { _, _ in scrollTarget = nil; highlightedMessageID = nil }
        }
    }

    private var messagesView: some View {
        ScrollViewReader { proxy in
            GeometryReader { viewport in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 25) {
                    Text("今天 · 本地演示").font(.caption2).foregroundStyle(Theme.secondary)
                        .frame(maxWidth: .infinity).padding(.top, 20).padding(.bottom, 3)
                    ForEach(store.messages) { message in
                        MessageRow(message: message, highlighted: highlightedMessageID == message.id, reply: {
                            store.replyQuote = message.text
                            composerFocused = true
                        }).id(message.id)
                        if let approvalID = message.approvalID, let approval = store.approvals.first(where: { $0.id == approvalID }) {
                            ApprovalCard(approval: approval)
                        }
                    }
                    Text("长按消息查看菜单 · 左滑快速回复").font(.system(size: 11)).foregroundStyle(Theme.secondary)
                        .frame(maxWidth: .infinity)
                    if store.isResponding {
                        HStack(spacing: 10) {
                            AriaMark(size: 27, circular: true)
                            ProgressView().controlSize(.small)
                            Text("Aria 正在整理思路…").font(.caption).foregroundStyle(Theme.secondary)
                            Spacer(minLength: 4)
                            Button { store.stopResponse() } label: {
                                Image(systemName: "stop.circle").font(.title3).frame(width: 44, height: 44)
                            }.accessibilityLabel("停止当前会话的模拟回复")
                        }.padding(.horizontal, 2)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                        .background(GeometryReader { marker in
                            Color.clear.preference(key: ChatBottomPreferenceKey.self,
                                value: marker.frame(in: .named("chatTranscript")).maxY)
                        })
                }.padding(.horizontal, 20).padding(.bottom, 12).frame(maxWidth: 760).frame(maxWidth: .infinity)
            }
            .coordinateSpace(name: "chatTranscript")
            .scrollDismissesKeyboard(.interactively)
            .onPreferenceChange(ChatBottomPreferenceKey.self) { bottom in
                isNearBottom = bottom <= viewport.size.height + 70
                if isNearBottom { hasUnreadResponse = false }
            }
            .overlay(alignment: .bottomTrailing) {
                if hasUnreadResponse && !isNearBottom {
                    Button {
                        withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                        hasUnreadResponse = false
                    } label: {
                        Label("新回复", systemImage: "arrow.down")
                            .font(.subheadline.weight(.medium)).padding(.horizontal, 16).frame(minHeight: 44)
                            .foregroundStyle(.white).background(Theme.ink, in: Capsule())
                    }.padding(16).accessibilityLabel("有新的模拟回复，跳到最新消息")
                }
            }
            .onChange(of: store.messages.count) { _, _ in
                if isNearBottom || store.messages.last?.role == .user {
                    withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("bottom", anchor: .bottom) }
                } else {
                    hasUnreadResponse = true
                }
            }
            .onChange(of: store.selectedConversationID) { _, _ in
                hasUnreadResponse = false
                if scrollTarget == nil { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: composerFocused) { _, focused in
                if focused { withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) } }
            }
            .onChange(of: sheet) { _, newValue in
                if newValue == nil, let target = scrollTarget {
                    withAnimation { proxy.scrollTo(target, anchor: .center) }
                    scrollTarget = nil
                }
            }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 10) {
            if let replyingTo = store.replyQuote {
                HStack(alignment: .top, spacing: 10) {
                    RoundedRectangle(cornerRadius: 1).fill(Theme.accent.opacity(0.6)).frame(width: 3)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("回复").font(.caption.weight(.medium)).foregroundStyle(Theme.accent)
                        Text(replyingTo).font(.caption).lineLimit(composerFocused ? 1 : 2).foregroundStyle(Theme.secondary)
                    }
                    Spacer(minLength: 0)
                    Button { store.replyQuote = nil } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                        .accessibilityLabel("取消引用回复")
                }.padding(12).fixedSize(horizontal: false, vertical: true)
                    .background(Theme.background, in: RoundedRectangle(cornerRadius: 12))
            }
            VStack(alignment: .leading, spacing: 3) {
                TextField("给 Aria 发消息…", text: $store.chatDraft, axis: .vertical)
                    .font(.subheadline).lineLimit(1...(dynamicTypeSize.isAccessibilitySize ? 2 : (composerFocused ? 3 : 5))).padding(.horizontal, 7).padding(.top, 7).padding(.bottom, 6)
                    .focused($composerFocused).accessibilityLabel("消息输入框")
                HStack(spacing: 3) {
                    Menu {
                        Button("引用示例项目方案") { store.chatDraft += store.chatDraft.isEmpty ? "请帮我整理《个人助手 App 总体方案》" : "\n参考：《个人助手 App 总体方案》（示例）" }
                        Button("引用示例日程") { store.chatDraft += store.chatDraft.isEmpty ? "帮我看看示例日程" : "\n参考：明天的安排（示例）" }
                    } label: {
                        Image(systemName: "paperclip").font(.system(size: 19)).foregroundStyle(Theme.secondary).frame(width: 44, height: 44)
                    }.accessibilityLabel("添加示例资料，不访问真实文件")
                    IconButton(symbol: "mic", label: "选择真实或演示语音对话") { composerFocused = false; showsVoiceOptions = true }
                    Spacer()
                    Button(action: send) {
                        Image(systemName: "arrow.up").font(.system(size: 17, weight: .semibold))
                            .frame(width: 35, height: 35).foregroundStyle(.white)
                            .background(canSend ? Theme.ink : Theme.secondary.opacity(0.28), in: Circle())
                            .frame(width: 44, height: 44)
                    }.disabled(!canSend).accessibilityLabel("发送消息")
                }
            }
            .padding(9)
            .background(.white, in: RoundedRectangle(cornerRadius: 25))
            .overlay(RoundedRectangle(cornerRadius: 25).stroke(Theme.line, lineWidth: 1))
            .shadow(color: .black.opacity(0.035), radius: 6, y: 2)
            if !composerFocused {
                Text("Aria 可能会有遗漏，重要信息请核实 · 当前为模拟体验")
                    .font(.caption2).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
            }
        }.padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 9)
            .background(Theme.background).frame(maxWidth: 760).frame(maxWidth: .infinity)
    }
    private func present(_ destination: ChatSheet) {
        composerFocused = false
        sheet = destination
    }
    private var canSend: Bool { !store.chatDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !store.isResponding }
    private func send() {
        guard canSend else { return }
        guard store.sendDraft() else { return }
        scrollTarget = nil
        highlightedMessageID = nil
        composerFocused = false
    }
}

private struct ChatBottomPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = .infinity
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct MessageRow: View {
    @EnvironmentObject private var store: AppStore
    let message: ChatMessage
    let highlighted: Bool
    let reply: () -> Void
    @GestureState private var swipeOffset: CGFloat = 0
    private var isUser: Bool { message.role == .user }
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if isUser { Spacer(minLength: 35) }
            else { AriaMark(size: 28, circular: true).padding(.top, 2) }
            VStack(alignment: .leading, spacing: 12) {
                if let quote = message.replyTo {
                    HStack(spacing: 8) {
                        Rectangle().fill(Theme.secondary.opacity(0.35)).frame(width: 2)
                        Text(quote).font(.caption).lineLimit(3).foregroundStyle(Theme.secondary)
                    }.fixedSize(horizontal: false, vertical: true)
                }
                Text(message.text).font(.subheadline).lineSpacing(6).foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(message.date, style: .time).font(.system(size: 10)).foregroundStyle(Theme.secondary)
            }
            .padding(isUser ? 16 : 0)
            .background(isUser ? Color(red: 236.0/255, green: 236.0/255, blue: 240.0/255) : (highlighted ? Theme.accent.opacity(0.06) : Color.clear), in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(highlighted ? Theme.accent.opacity(0.55) : Color.clear, lineWidth: 1.5))
            .contentShape(RoundedRectangle(cornerRadius: 20))
            .contextMenu {
                Button { UIPasteboard.general.string = message.text; store.showToast("已复制消息") } label: { Label("复制", systemImage: "doc.on.doc") }
                Button(action: reply) { Label("回复", systemImage: "arrowshape.turn.up.left") }
            }
            .accessibilityElement(children: .combine)
            .accessibilityHint(isUser ? "你的消息。可使用复制或回复操作。" : "Aria 的模拟回复。可使用复制或回复操作。")
            .accessibilityAction(named: Text("回复"), reply)
            .accessibilityAction(named: "复制") { UIPasteboard.general.string = message.text; store.showToast("已复制消息") }
            .offset(x: swipeOffset)
            .simultaneousGesture(DragGesture(minimumDistance: 24)
                .updating($swipeOffset) { value, state, _ in
                    if abs(value.translation.height) < 35 { state = max(-36, min(0, value.translation.width / 2)) }
                }
                .onEnded { value in
                    if value.translation.width < -60, abs(value.translation.height) < 45 { reply() }
                })
            if !isUser { Spacer(minLength: 5) }
        }
    }
}

struct ApprovalCard: View {
    @EnvironmentObject private var store: AppStore
    let approval: ApprovalItem
    @State private var expanded = false
    @State private var showDetail = false
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 8) {
                Image(systemName: approval.status == .pending ? "hand.raised" : "checkmark.shield")
                Text(approval.status.rawValue).font(.caption.weight(.semibold))
                Spacer()
                Text("模拟操作").font(.caption2).foregroundStyle(Theme.secondary)
            }.foregroundStyle(approval.status == .pending ? Theme.accent : Theme.secondary)
            Text(approval.status == .pending ? "需要你的确认" : approval.status.rawValue).font(.subheadline.weight(.semibold))
            Text(approval.title).font(.subheadline)
            Text(approval.detail).font(.caption).foregroundStyle(Theme.secondary).lineSpacing(4)
                .lineLimit(expanded ? nil : 3)
            Button(expanded ? "收起详情" : "查看完整内容") { expanded.toggle() }
                .font(.caption.weight(.medium)).foregroundStyle(Theme.accent)
            if approval.status == .pending {
                HStack(spacing: 10) {
                    Button { store.decideApproval(id: approval.id, approved: false) } label: {
                        Text("拒绝").frame(maxWidth: .infinity).padding(.vertical, 11)
                    }.foregroundStyle(Theme.ink).background(.white, in: RoundedRectangle(cornerRadius: 11))
                        .overlay(RoundedRectangle(cornerRadius: 11).stroke(Theme.line, lineWidth: 1))
                    Button { store.decideApproval(id: approval.id, approved: true) } label: {
                        Text("允许").frame(maxWidth: .infinity).padding(.vertical, 11)
                    }.foregroundStyle(.white).background(Theme.ink, in: RoundedRectangle(cornerRadius: 11))
                }.font(.subheadline.weight(.medium)).buttonStyle(.plain)
            } else {
                Label(approval.status == .approved ? "你已同意，本地演示已完成" : "你已拒绝，此操作已停止", systemImage: approval.status == .approved ? "checkmark.circle" : "xmark.circle")
                    .font(.caption).foregroundStyle(Theme.secondary)
            }
            Button("查看审批详情") { showDetail = true }.font(.caption).foregroundStyle(Theme.secondary)
        }.padding(17).background(.white, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.line, lineWidth: 1))
            .sheet(isPresented: $showDetail) { ApprovalDetailView(approvalID: approval.id) }
    }
}

struct ApprovalDetailView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    let approvalID: UUID
    private var approval: ApprovalItem? { store.approvals.first { $0.id == approvalID } }
    var body: some View {
        NavigationStack {
            ScrollView {
                if let approval {
                    VStack(alignment: .leading, spacing: 25) {
                        SectionEyebrow(approval.status == .pending ? "等待你的决定" : approval.status.rawValue)
                        Text(approval.title).font(.system(size: 28, weight: .medium))
                        Text("确认前不会执行任何操作。此处的批准与拒绝仅修改本地演示状态。")
                            .font(.subheadline).lineSpacing(5).foregroundStyle(Theme.secondary)
                        SurfaceCard { Text(approval.detail).font(.subheadline).lineSpacing(8) }
                        SectionEyebrow("为什么需要确认")
                        Text("持续访问、对外发送或其他关键操作，需要你了解访问范围、对象与影响后再决定。本演示没有连接邮件、日历或后台任务。")
                            .font(.subheadline).lineSpacing(6).foregroundStyle(Theme.secondary)
                        if approval.status == .pending {
                            HStack(spacing: 14) {
                                Button("拒绝") { store.decideApproval(id: approvalID, approved: false) }
                                    .frame(maxWidth: .infinity).padding(14).background(.white, in: RoundedRectangle(cornerRadius: 12))
                                PrimaryButton("允许") { store.decideApproval(id: approvalID, approved: true) }
                            }
                        } else {
                            Label(approval.status.rawValue + " · 仅模拟", systemImage: approval.status == .approved ? "checkmark.circle" : "xmark.circle")
                                .font(.subheadline).foregroundStyle(approval.status == .approved ? Theme.accent : Theme.secondary)
                        }
                    }.padding(24)
                }
            }.background(Theme.background).navigationTitle("审批详情").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { dismiss() } } }
        }
    }
}

private struct ConversationListView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    let onSelect: () -> Void
    private var results: [Conversation] {
        query.isEmpty ? store.conversations : store.conversations.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.subtitle.localizedCaseInsensitiveContains(query) }
    }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { onSelect(); store.newConversation(); dismiss() } label: {
                        Label("开启新的对话", systemImage: "square.and.pencil").font(.body.weight(.medium)).padding(.vertical, 5)
                    }
                }
                Section("最近的对话") {
                    ForEach(results) { conversation in
                        Button {
                            onSelect()
                            store.selectConversation(id: conversation.id)
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "bubble.left").foregroundStyle(Theme.secondary)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(conversation.title).font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                                    let pendingDraft = store.draft(for: conversation.id).text
                                    Text(pendingDraft.isEmpty ? conversation.subtitle : "草稿 · " + pendingDraft)
                                        .font(.caption).foregroundStyle(pendingDraft.isEmpty ? Theme.secondary : Theme.accent).lineLimit(1)
                                }
                                Spacer()
                                if conversation.id == store.selectedConversationID { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                            }.padding(.vertical, 8)
                        }
                    }
                    if results.isEmpty { Text("没有匹配的对话").foregroundStyle(Theme.secondary) }
                }
            }.searchable(text: $query, prompt: "搜索会话")
                .navigationTitle("对话").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("完成") { dismiss() } } }
                .scrollContentBackground(.hidden).background(Theme.background)
        }
    }
}

private struct ChatSearchView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    let select: (UUID, UUID) -> Void
    private var results: [MessageSearchResult] { store.searchMessages(matching: query) }

    var body: some View {
        NavigationStack {
            Group {
                if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    EmptyState(symbol: "magnifyingglass", title: "找到之前的想法", detail: "搜索所有本地会话里的文字")
                } else if results.isEmpty {
                    EmptyState(symbol: "text.magnifyingglass", title: "没有找到相关消息", detail: "试试“项目”“关键词”或“评审”")
                } else {
                    List(results) { result in
                        Button {
                            select(result.conversationID, result.message.id)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 9) {
                                Text(result.conversationTitle).font(.caption.weight(.medium)).foregroundStyle(Theme.accent)
                                Text(result.message.text).font(.subheadline).foregroundStyle(Theme.ink).lineLimit(4)
                            }.padding(.vertical, 8)
                        }
                    }.listStyle(.plain).scrollDismissesKeyboard(.interactively)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Theme.background)
                .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索聊天记录")
                .navigationTitle("搜索").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("取消") { dismiss() } } }
        }
    }
}
