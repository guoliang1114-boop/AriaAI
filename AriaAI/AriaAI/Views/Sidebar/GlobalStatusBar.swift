import SwiftUI

/// The detail content shown inside the Connection Status popover.
/// Used by SidebarView — no trigger button here.
struct StatusPopoverContent: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang

    @State private var apiLatencyMs: Int? = nil
    @State private var modelDisplay: String = ""
    @State private var isRefreshing = false

    // ── Sync state ─────���──────────────────────────────────────────────────────
    enum SyncState {
        case loading, synced, inProgress(Int), failed(Int)
    }

    var syncState: SyncState {
        let docs = dataStore.apiDocuments
        guard !docs.isEmpty else { return dataStore.isLoading ? .loading : .synced }
        let failed = docs.filter { $0.vectorStatus == "failed" }.count
        let synced = docs.filter { $0.vectorStatus == "synced" }.count
        if failed > 0 && synced + failed == docs.count { return .failed(failed) }
        if synced == docs.count { return .synced }
        return .inProgress(Int(Double(synced) / Double(docs.count) * 100))
    }

    var syncDotColor: Color {
        switch syncState {
        case .loading:    return .onSurfaceVariant
        case .synced:     return .statusActive
        case .inProgress: return .primary500
        case .failed:     return .statusFailed
        }
    }

    private var syncLabel: String {
        switch syncState {
        case .loading:           return lang.t("检查中…", "Checking…")
        case .synced:            return lang.t("已同步", "Synced")
        case .inProgress(let p): return lang.t("同步中 \(p)%", "Syncing \(p)%")
        case .failed(let n):     return lang.t("\(n) 个失败", "\(n) failed")
        }
    }

    private var latencyColor: Color {
        guard let ms = apiLatencyMs else { return .onSurfaceVariant }
        return ms < 500 ? .statusActive : .statusOnHold
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Text(lang.t("连接状态", "Connection Status"))
                    .font(TextStyle.labelMD)
                    .foregroundColor(.onSurface)
                Spacer()
                Button { Task { await refresh() } } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.onSurfaceVariant)
                        .rotationEffect(.degrees(isRefreshing ? 360 : 0))
                        .animation(
                            isRefreshing
                                ? .linear(duration: 0.6).repeatForever(autoreverses: false)
                                : .default,
                            value: isRefreshing
                        )
                }
                .buttonStyle(.plain)
                .help(lang.t("刷新", "Refresh"))
            }
            .padding(.horizontal, Spacing.md)
            .padding(.top, Spacing.md)
            .padding(.bottom, Spacing.sm)

            Divider()

            VStack(spacing: 0) {
                row(icon: "circle.fill",    iconColor: syncDotColor,   label: lang.t("全局同步", "Global Sync"),  value: syncLabel)
                Divider().padding(.leading, 36)
                row(icon: "antenna.radiowaves.left.and.right", iconColor: latencyColor,
                    label: lang.t("API 延迟", "API Latency"),  value: apiLatencyMs.map { "\($0) ms" } ?? "–")
                Divider().padding(.leading, 36)
                row(icon: "cpu",            iconColor: .onSurfaceVariant, label: lang.t("当前模型", "Model"), value: modelDisplay.isEmpty ? "–" : modelDisplay)
            }
            .padding(.bottom, Spacing.sm)
        }
        .frame(width: 260)
        .background(Color.surfaceContainerLowest)
        .task {
            loadModel()
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await self.measureLatency() }
                g.addTask { await self.dataStore.loadDocuments() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UserDefaults.didChangeNotification)) { _ in
            loadModel()
        }
    }

    @ViewBuilder
    private func row(icon: String, iconColor: Color, label: String, value: String) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 11))
                .foregroundColor(iconColor)
                .frame(width: 20)
            Text(label)
                .font(TextStyle.labelSM)
                .foregroundColor(.onSurfaceVariant)
            Spacer()
            Text(value)
                .font(TextStyle.labelSM)
                .fontWeight(.semibold)
                .foregroundColor(.onSurface)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.vertical, Spacing.sm + 2)
    }

    private func refresh() async {
        isRefreshing = true
        await withTaskGroup(of: Void.self) { g in
            g.addTask { await self.dataStore.loadDocuments() }
            g.addTask { await self.measureLatency() }
        }
        isRefreshing = false
    }

    private func loadModel() {
        let id = UserDefaults.standard.string(forKey: "cache_selected_model") ?? ""
        modelDisplay = Self.friendlyName(for: id)
    }

    private func measureLatency() async {
        struct Pong: Decodable { let configured: Bool }
        let start = Date()
        _ = try? await APIClient.shared.get("/settings/api-key-status") as Pong
        apiLatencyMs = Int(Date().timeIntervalSince(start) * 1000)
    }

    static func friendlyName(for id: String) -> String {
        switch id {
        case "claude-opus-4":    return "Opus 4.6"
        case "claude-sonnet-4":  return "Sonnet 4.6"
        case "claude-haiku-4":   return "Haiku 4.5"
        case "moonshot-v1-32k":  return "Kimi 32K"
        case "moonshot-v1-128k": return "Kimi 128K"
        case "moonshot-v1-8k":   return "Kimi 8K"
        case "kimi-k2.5":        return "Kimi K2.5"
        default: return id.isEmpty ? "Sonnet 4.6" : id
        }
    }
}
