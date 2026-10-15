import SwiftUI

@main
struct AriaApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = AppStore(persistence: FileDemoPersistence())
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store)
                .preferredColorScheme(.light)
                .tint(Theme.accent)
                .onChange(of: scenePhase) { _, phase in
                    if phase != .active { store.flushPersistence() }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showLocalDataControls = false
    var body: some View {
        ZStack(alignment: .top) {
            Group {
                switch store.stage {
                case .splash: SplashView()
                case .onboarding: OnboardingView()
                case .login: LoginView()
                case .main: MainTabView()
                }
            }
            if let toast = store.toast {
                Text(toast).font(.subheadline.weight(.medium)).foregroundStyle(.white)
                    .padding(.horizontal, 20).padding(.vertical, 14)
                    .background(Theme.ink, in: Capsule())
                    .padding(.horizontal, 20).padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .accessibilityAddTraits(.updatesFrequently)
                    .allowsHitTesting(false)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: store.toast)
        .animation(.easeInOut(duration: 0.3), value: store.stage)
        .safeAreaInset(edge: .top, spacing: 0) {
            if store.stage == .main && store.persistenceState.needsAttention {
                Button { showLocalDataControls = true } label: {
                    Label("本地存储需要处理 · 查看", systemImage: "exclamationmark.triangle")
                        .font(.subheadline.weight(.medium))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 16).padding(.vertical, 4)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color(red: 0.65, green: 0.27, blue: 0.04))
                .background(.white)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.line).frame(height: 1) }
                .accessibilityLabel("本地存储需要处理，查看详情")
                .accessibilityHint("查看当前本地存储状态，并选择重试或管理演示数据")
            }
        }
        .sheet(isPresented: $showLocalDataControls) {
            NavigationStack {
                DataControlView()
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("关闭") { showLocalDataControls = false }
                                .frame(minWidth: 44, minHeight: 44)
                                .accessibilityLabel("关闭数据控制")
                        }
                    }
            }.environmentObject(store)
        }
        .onChange(of: store.stage) { _, stage in
            if stage != .main { showLocalDataControls = false }
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        TabView(selection: $store.selectedTab) {
            ChatView().tag(AppTab.chat)
                .tabItem { Label("聊天", systemImage: "bubble.left.and.bubble.right") }
            ActivityView().tag(AppTab.activity)
                .tabItem { Label("动态", systemImage: "waveform.path") }
            InspirationView().tag(AppTab.inspiration)
                .tabItem { Label("灵感", systemImage: "sparkles") }
            GoalsView().tag(AppTab.goals)
                .tabItem { Label("目标", systemImage: "scope") }
            LibraryView().tag(AppTab.library)
                .tabItem { Label("资料库", systemImage: "tray.full") }
        }
        .toolbarBackground(.white, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}
