import SwiftUI

@main
struct AriaApp: App {
    @StateObject private var store = AppStore()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store)
                .preferredColorScheme(.light)
                .tint(Theme.accent)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: AppStore
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
