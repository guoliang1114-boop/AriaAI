import SwiftUI

struct ServerConfigView: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    
    @State private var backendBaseURL = ""
    @State private var isSavingBackendURL = false
    @State private var backendURLSaveSuccess = false
    
    @State private var connectionStatus: ConnectionStatus = .unknown
    @State private var isTestingConnection = false
    
    enum ConnectionStatus {
        case unknown
        case connected
        case failed
        
        var icon: String {
            switch self {
            case .unknown: return "ellipsis.circle"
            case .connected: return "checkmark.circle.fill"
            case .failed: return "xmark.circle.fill"
            }
        }
        
        var color: Color {
            switch self {
            case .unknown: return .onSurfaceVariant
            case .connected: return .statusActive
            case .failed: return .statusFailed
            }
        }
        
        var text: String {
            switch self {
            case .unknown: return "未测试"
            case .connected: return "连接正常"
            case .failed: return "连接失败"
            }
        }
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                // Server URL Card
                serverURLCard
                
                // Connection Test Card
                connectionTestCard
                
                // Info Card
                infoCard
            }
            .padding(Spacing.xxl)
        }
        .background(.surfaceBase)
        .task {
            backendBaseURL = UserDefaults.standard.string(forKey: "apiBaseURL") ?? "https://aria.d2cgo.co"
        }
    }
    
    // MARK: - Server URL Card
    private var serverURLCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                sectionHeader(
                    icon: "server.rack",
                    title: lang.t("后端服务器", "Backend Server"),
                    subtitle: lang.t("配置后端服务连接地址", "Configure backend server connection")
                )
                
                Divider().opacity(0.4)
                
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(lang.t("服务器地址", "Server URL"))
                        .font(TextStyle.labelSM)
                        .foregroundColor(.onSurfaceVariant)
                    
                    TextField("https://aria.d2cgo.co", text: $backendBaseURL)
                        .textFieldStyle(.plain)
                        .padding(Spacing.md)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                }
                
                HStack {
                    Spacer()
                    PrimaryButton(
                        backendURLSaveSuccess ? lang.t("已保存 ✓", "Saved ✓") : (isSavingBackendURL ? lang.t("保存中...", "Saving...") : lang.t("保存地址", "Save URL")),
                        icon: "checkmark"
                    ) {
                        saveServerURL()
                    }
                    .disabled(backendBaseURL.isEmpty || isSavingBackendURL)
                }
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Connection Test Card
    private var connectionTestCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                sectionHeader(
                    icon: "antenna.radiowaves.left.and.right",
                    title: lang.t("连接测试", "Connection Test"),
                    subtitle: lang.t("测试与后端服务的连接状态", "Test connection to backend service")
                )
                
                Divider().opacity(0.4)
                
                HStack(spacing: Spacing.lg) {
                    // Status Indicator
                    HStack(spacing: Spacing.md) {
                        Image(systemName: connectionStatus.icon)
                            .font(.system(size: 24))
                            .foregroundColor(connectionStatus.color)
                        
                        VStack(alignment: .leading, spacing: 2) {
                            Text(lang.t("连接状态", "Status"))
                                .font(TextStyle.labelSM)
                                .foregroundColor(.onSurfaceVariant)
                            Text(connectionStatus.text)
                                .font(TextStyle.bodyMD)
                                .foregroundColor(connectionStatus.color)
                        }
                    }
                    
                    Spacer()
                    
                    SecondaryButton(
                        isTestingConnection ? lang.t("测试中...", "Testing...") : lang.t("测试连接", "Test Connection"),
                        icon: "arrow.clockwise"
                    ) {
                        testConnection()
                    }
                    .disabled(isTestingConnection)
                }
                .padding(Spacing.md)
                .background(Color.surfaceContainerHighest.opacity(0.3))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Info Card
    private var infoCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                sectionHeader(
                    icon: "info.circle.fill",
                    title: lang.t("说明", "Information"),
                    subtitle: lang.t("配置注意事项", "Configuration notes")
                )
                
                Divider().opacity(0.4)
                
                VStack(alignment: .leading, spacing: Spacing.md) {
                    InfoRow(
                        icon: "exclamationmark.triangle.fill",
                        text: lang.t("修改服务器地址后需要重启应用才能生效", "Restart app after changing server URL")
                    )
                    
                    InfoRow(
                        icon: "lock.fill",
                        text: lang.t("请确保使用 HTTPS 协议以保证数据传输安全", "Use HTTPS for secure data transmission")
                    )
                    
                    InfoRow(
                        icon: "network",
                        text: lang.t("默认服务器地址: https://aria.d2cgo.co", "Default server: https://aria.d2cgo.co")
                    )
                }
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Helpers
    private func sectionHeader(icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: Spacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.primary500.opacity(0.1))
                    .frame(width: 36, height: 36)
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.primary500)
            }
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(TextStyle.titleMD)
                    .foregroundColor(.onSurface)
                Text(subtitle)
                    .font(TextStyle.bodySM)
                    .foregroundColor(.onSurfaceVariant)
            }
            
            Spacer()
        }
    }
    
    // MARK: - Actions
    private func saveServerURL() {
        isSavingBackendURL = true
        backendURLSaveSuccess = false
        Task {
            await dataStore.saveApiBaseURL(backendBaseURL)
            isSavingBackendURL = false
            backendURLSaveSuccess = true
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            backendURLSaveSuccess = false
        }
    }
    
    private func testConnection() {
        isTestingConnection = true
        connectionStatus = .unknown
        
        Task {
            do {
                // Try to fetch current user as a connection test
                let _: DataStore.AppUser? = try? await APIClient.shared.get("/users/me")
                connectionStatus = .connected
            }
            isTestingConnection = false
        }
    }
}

// MARK: - Info Row
struct InfoRow: View {
    let icon: String
    let text: String
    
    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(.primary500)
                .frame(width: 20)
            
            Text(text)
                .font(TextStyle.bodySM)
                .foregroundColor(.onSurfaceVariant)
            
            Spacer()
        }
    }
}
