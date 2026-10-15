import SwiftUI

struct SplashView: View {
    @EnvironmentObject private var store: AppStore
    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            AriaMark(size: 64)
            Text("Aria").font(.system(size: 31, weight: .medium, design: .rounded)).tracking(-1.5)
            Text("让复杂工作有清晰的下一步。").font(.subheadline).foregroundStyle(Theme.secondary)
            Spacer()

        }
        .frame(maxWidth: .infinity).background(.white)
        .task {
            do { try await Task.sleep(nanoseconds: 1_100_000_000) } catch { return }
            store.finishSplash()
        }
    }
}

private struct OnboardingPage {
    let title: String
    let subtitle: String
    let symbol: String
}

struct OnboardingView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var page = 0
    private let pages = [
        OnboardingPage(title: "从项目开始", subtitle: "把资料、对话和交付放进同一工作空间，让 Aria 理解项目目标、客户背景和团队上下文。", symbol: "bubble.left"),
        OnboardingPage(title: "和 Aria 一起做事", subtitle: "不止回答问题。调用技能和工具，完成研究、分析、写作与办公交付。", symbol: "folder"),
        OnboardingPage(title: "关键操作，始终可控", subtitle: "查看每一步工具调用；发送、修改和其他高风险操作，都会先征得你的确认。", symbol: "checkmark.shield")
    ]
    var body: some View {
        VStack(spacing: 0) {
            HStack { Spacer(); Button("跳过") { store.finishOnboarding() }.font(.subheadline).foregroundStyle(Theme.secondary).padding(.horizontal, 9).frame(minWidth: 44, minHeight: 44) }
                .padding(.horizontal, 28).padding(.top, 16)
            TabView(selection: $page) {
                ForEach(pages.indices, id: \.self) { index in
                    ScrollView {
                        VStack(spacing: 0) {
                            Image(systemName: pages[index].symbol).font(.system(size: 58, weight: .ultraLight))
                                .frame(width: 164, height: 164).background(Theme.background, in: Circle())
                                .padding(.bottom, 37)
                            Text(pages[index].title).font(.title.weight(.medium)).tracking(-1).multilineTextAlignment(.center)
                                .padding(.bottom, 13)
                            Text(pages[index].subtitle).font(.subheadline).lineSpacing(6)
                                .foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
                        }.padding(.horizontal, 36).frame(maxWidth: 500)
                            .frame(maxWidth: .infinity).padding(.vertical, 30)
                    }.defaultScrollAnchor(.center).tag(index)
                }
            }.tabViewStyle(.page(indexDisplayMode: .never))
            footer.padding(.horizontal, 28).padding(.bottom, 28)

        }.foregroundStyle(Theme.ink).background(.white)
    }
    private var footer: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
            : AnyLayout(HStackLayout(spacing: 8))
        return layout {
            HStack(spacing: 0) {
                ForEach(0..<3) { index in
                    Button { withAnimation { page = index } } label: {
                        Capsule().fill(index == page ? Theme.ink : Theme.line)
                            .frame(width: index == page ? 22 : 7, height: 7)
                            .frame(width: 44, height: 44)
                    }.accessibilityLabel("第 \(index + 1) 页，共 3 页")
                        .accessibilityAddTraits(page == index ? .isSelected : [])
                }
            }
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
            Button(page == 2 ? "开始使用" : "下一步") {
                if page == 2 { store.finishOnboarding() }
                else { withAnimation(.easeInOut) { page += 1 } }
            }.font(.body.weight(.medium)).foregroundStyle(.white)
                .padding(.horizontal, 20).padding(.vertical, 12).frame(minHeight: 48)
                .background(Theme.ink, in: RoundedRectangle(cornerRadius: 12))
        }
    }

}

struct LoginView: View {
    @EnvironmentObject private var store: AppStore
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var passwordVisible = false
    @State private var showHelp = false
    @FocusState private var focusedField: Field?
    private enum Field { case email, password }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                AriaMark(size: 48)
                    .padding(.top, 80).padding(.bottom, 4)
                VStack(alignment: .leading, spacing: 12) {
                    Text("登录 Aria").font(.title.weight(.medium)).tracking(-0.8)
                    Text("使用邮箱进入你的智能工作空间。").font(.subheadline).foregroundStyle(Theme.secondary)
                }
                VStack(alignment: .leading, spacing: 19) {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("邮箱").font(.subheadline.weight(.medium))
                        TextField("请输入邮箱", text: $email)
                            .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .textContentType(.emailAddress).focused($focusedField, equals: .email)
                            .submitLabel(.next).onSubmit { focusedField = .password }
                            .padding(17).background(.white, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
                            .accessibilityLabel("邮箱")
                    }
                    VStack(alignment: .leading, spacing: 9) {
                        Text("密码").font(.subheadline.weight(.medium))
                        HStack {
                            Group {
                                if passwordVisible { TextField("请输入模拟密码（至少 6 位）", text: $password) }
                                else { SecureField("请输入模拟密码（至少 6 位）", text: $password) }
                            }.textInputAutocapitalization(.never).autocorrectionDisabled()
                                .focused($focusedField, equals: .password).submitLabel(.go).onSubmit(login)
                            Button { passwordVisible.toggle() } label: {
                                Image(systemName: passwordVisible ? "eye.slash" : "eye").foregroundStyle(Theme.secondary).frame(width: 44, height: 44)
                            }.accessibilityLabel(passwordVisible ? "隐藏密码" : "显示密码")
                        }.padding(.horizontal, 17).padding(.vertical, 10)
                            .background(.white, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
                    }
                    if let error {
                        Label(error, systemImage: "exclamationmark.circle").font(.caption).foregroundStyle(.red)
                    }
                    HStack { Spacer(); Button("忘记密码？") { showHelp = true }.font(.subheadline).foregroundStyle(Theme.secondary).frame(minHeight: 44) }
                    PrimaryButton("登录") { login() }
                }.padding(.top, 15)
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: "info.circle").padding(.top, 2)
                    Text("本地演示 · 使用任意有效邮箱和至少 6 位模拟密码。请勿输入真实密码；输入不会上传或保存。")
                        .lineSpacing(4)
                }.font(.caption).foregroundStyle(Theme.secondary)
                Spacer(minLength: 30)
            }.padding(.horizontal, 28).frame(maxWidth: 520).frame(maxWidth: .infinity)
        }
        .background(.white).foregroundStyle(Theme.ink)
        .scrollDismissesKeyboard(.interactively)
        .onDisappear { password = ""; passwordVisible = false }
        .alert("这是一个本地演示", isPresented: $showHelp) {
            Button("知道了", role: .cancel) { }
        } message: { Text("没有真实账号或已保存的密码。输入任意有效邮箱和至少 6 位模拟密码即可体验。") }
    }
    private func login() {
        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard LoginValidation.isValidEmail(cleanEmail) else { error = "请输入有效的邮箱地址"; focusedField = .email; return }
        guard password.count >= 6 else { error = "模拟密码至少需要 6 位"; focusedField = .password; return }
        error = nil
        focusedField = nil
        password = ""
        email = ""
        store.login(email: cleanEmail)
    }
}

enum LoginValidation {
    static func isValidEmail(_ email: String) -> Bool {
        email.range(of: "^[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", options: .regularExpression) != nil
    }
}
