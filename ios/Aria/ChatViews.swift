import SwiftUI
import UIKit

private enum ChatSheet: String, Identifiable { case conversations, search, status; var id: String { rawValue } }
private enum ChatMode: String, Identifiable { case voice, phone; var id: String { rawValue } }

struct ChatView: View {
    @EnvironmentObject private var store: AppStore
    @State private var replyingTo: String?
    @State private var sheet: ChatSheet?
    @State private var mode: ChatMode?
    @State private var scrollTarget: UUID?
    @State private var highlightedMessageID: UUID?
    @FocusState private var composerFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Divider().overlay(Theme.line)
                messagesView
                composer
            }
            .background(Theme.background)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    IconButton(symbol: "line.3.horizontal", label: "打开会话列表") { sheet = .conversations }
                }
                ToolbarItem(placement: .principal) {
                    Button { sheet = .status } label: {
                        HStack(spacing: 9) {
                            AriaMark(size: 32, circular: true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Aria").font(.headline).foregroundStyle(Theme.ink)
                                HStack(spacing: 4) {
                                    Circle().fill(Color.green.opacity(0.65)).frame(width: 5, height: 5)
                                    Text("在线 · 模拟").font(.system(size: 10)).foregroundStyle(Theme.secondary)
                                }
                            }
                        }
                    }.buttonStyle(.plain).accessibilityLabel("Aria 状态与个人设置")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    IconButton(symbol: "magnifyingglass", label: "搜索聊天记录") { sheet = .search }
                    IconButton(symbol: "mic", label: "开始模拟语音对话") { composerFocused = false; mode = .voice }
                    IconButton(symbol: "phone", label: "模拟电话") { composerFocused = false; mode = .phone }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $sheet) { sheet in
                switch sheet {
                case .conversations: ConversationListView { scrollTarget = nil; highlightedMessageID = nil }
                case .search: ChatSearchView { conversationID, messageID in
                    store.selectedConversationID = conversationID
                    scrollTarget = messageID
                    highlightedMessageID = messageID
                }
                case .status: StatusView()
                }
            }
            .fullScreenCover(item: $mode) { mode in
                switch mode {
                case .voice:
                    VoiceModeView(onClose: { self.mode = nil }, onComplete: { summary in store.addCallSummary(summary) })
                case .phone:
                    PhoneFlowView(onClose: { self.mode = nil }, onComplete: { summary in store.addCallSummary(summary) })
                }
            }
            .onChange(of: store.selectedConversationID) { _, _ in store.chatDraft = ""; replyingTo = nil }
            .onChange(of: store.chatContextID) { _, _ in replyingTo = nil }
        }
    }

    private var messagesView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 25) {
                    Text("今天 · 本地演示").font(.caption2).foregroundStyle(Theme.secondary)
                        .frame(maxWidth: .infinity).padding(.top, 20).padding(.bottom, 3)
                    ForEach(store.messages) { message in
                        MessageRow(message: message, highlighted: highlightedMessageID == message.id, reply: {
                            replyingTo = message.text
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
                        }.padding(.horizontal, 2).accessibilityLabel("Aria 正在整理模拟回复")
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }.padding(.horizontal, 20).padding(.bottom, 12).frame(maxWidth: 760).frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: store.selectedConversationID) { _, _ in
                if scrollTarget == nil { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: sheet) { _, newValue in
                if newValue == nil, let target = scrollTarget {
                    withAnimation { proxy.scrollTo(target, anchor: .center) }
                    scrollTarget = nil
                }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 10) {
            if let replyingTo {
                HStack(alignment: .top, spacing: 10) {
                    RoundedRectangle(cornerRadius: 1).fill(Theme.accent.opacity(0.6)).frame(width: 3)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("回复").font(.caption.weight(.medium)).foregroundStyle(Theme.accent)
                        Text(replyingTo).font(.caption).lineLimit(2).foregroundStyle(Theme.secondary)
                    }
                    Spacer(minLength: 0)
                    Button { self.replyingTo = nil } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                        .accessibilityLabel("取消引用回复")
                }.padding(12).fixedSize(horizontal: false, vertical: true)
                    .background(Theme.background, in: RoundedRectangle(cornerRadius: 12))
            }
            VStack(alignment: .leading, spacing: 3) {
                TextField("给 Aria 发消息…", text: $store.chatDraft, axis: .vertical)
                    .font(.subheadline).lineLimit(1...5).padding(.horizontal, 7).padding(.top, 7).padding(.bottom, 6)
                    .focused($composerFocused).accessibilityLabel("消息输入框")
                HStack(spacing: 3) {
                    Menu {
                        Button("引用示例项目方案") { store.chatDraft += store.chatDraft.isEmpty ? "请帮我整理《个人助手 App 总体方案》" : "\n参考：《个人助手 App 总体方案》（示例）" }
                        Button("引用示例日程") { store.chatDraft += store.chatDraft.isEmpty ? "帮我看看示例日程" : "\n参考：明天的安排（示例）" }
                    } label: {
                        Image(systemName: "paperclip").font(.system(size: 19)).foregroundStyle(Theme.secondary).frame(width: 40, height: 40)
                    }.accessibilityLabel("添加示例资料，不访问真实文件")
                    IconButton(symbol: "mic", label: "进入模拟语音对话") { composerFocused = false; mode = .voice }
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
            Text("Aria 可能会有遗漏，重要信息请核实 · 当前为模拟体验")
                .font(.system(size: 10)).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
        }.padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 9)
            .background(Theme.background).frame(maxWidth: 760).frame(maxWidth: .infinity)
    }
    private var canSend: Bool { !store.chatDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !store.isResponding }
    private func send() {
        guard canSend else { return }
        store.send(store.chatDraft, replyTo: replyingTo)
        store.chatDraft = ""
        replyingTo = nil
        scrollTarget = nil
        highlightedMessageID = nil
        composerFocused = false
    }
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
            .contentShape(RoundedRectangle(cornerRadius: 20))
            .contextMenu {
                Button { UIPasteboard.general.string = message.text; store.showToast("已复制消息") } label: { Label("复制", systemImage: "doc.on.doc") }
                Button(action: reply) { Label("回复", systemImage: "arrowshape.turn.up.left") }
            }
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
                            Label(approval.status.rawValue + " · 仅模拟", systemImage: "checkmark.circle").font(.subheadline).foregroundStyle(Theme.accent)
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
                            store.selectedConversationID = conversation.id
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "bubble.left").foregroundStyle(Theme.secondary)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(conversation.title).font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                                    Text(conversation.subtitle).font(.caption).foregroundStyle(Theme.secondary).lineLimit(1)
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

private struct ChatSearchResult: Identifiable {
    let conversationID: UUID
    let conversationTitle: String
    let message: ChatMessage
    var id: UUID { message.id }
}

private struct ChatSearchView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    let select: (UUID, UUID) -> Void
    private var results: [ChatSearchResult] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        return store.conversations.flatMap { conversation in
            conversation.messages.filter { $0.text.localizedCaseInsensitiveContains(query) }.map {
                ChatSearchResult(conversationID: conversation.id, conversationTitle: conversation.title, message: $0)
            }
        }
    }
    var body: some View {
        NavigationStack {
            Group {
                if query.isEmpty {
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
                    }.listStyle(.plain)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Theme.background)
                .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索聊天记录")
                .navigationTitle("搜索").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("取消") { dismiss() } } }
        }
    }
}
