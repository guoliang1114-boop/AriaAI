import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showLogout = false
    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 7) {
                    Text("设置").font(.title2.weight(.medium))
                    Text("管理 Aria 与你的连接方式").font(.subheadline).foregroundStyle(Theme.secondary)
                    Text(store.profileEmail).font(.caption).foregroundStyle(Theme.secondary)
                }.padding(.vertical, 8).listRowBackground(Color.clear)
            }
            Section("连接与设备") {
                NavigationLink { ConnectorDetailView() } label: { SettingsRow(symbol: "link", title: "连接器", value: "管理") }
                NavigationLink { SettingsInfoView(title: "设备", symbol: "iphone", detail: "当前设备", bodyText: "本机 · iOS 应用演示\n本示例不会读取设备标识，也没有注册远程设备。") } label: { SettingsRow(symbol: "iphone", title: "设备", value: "本机") }
                NavigationLink { SettingsInfoView(title: "钱包", symbol: "wallet.bifold", detail: "未设置", bodyText: "这是本地前端演示，没有支付方式、余额或真实交易。电话页面仅展示模拟资费说明，不会产生费用。") } label: { SettingsRow(symbol: "wallet.bifold", title: "钱包", value: "未设置") }
            }
            Section("安全与权限") {
                NavigationLink { SettingsInfoView(title: "安全凭据", symbol: "lock", detail: "不保存真实凭据", bodyText: "登录时输入的模拟密码只用于本地校验，并在登录成功或离开登录页面后清空。没有服务器、Keychain 或密码保存操作。") } label: { SettingsRow(symbol: "lock", title: "安全凭据", value: "本地演示") }
                NavigationLink { SettingsInfoView(title: "权限", symbol: "checkmark.shield", detail: "未请求系统权限", bodyText: "此演示不会请求麦克风、相机、通讯录、通知或定位权限。审批只更新本地状态，不会连接邮件、日历或创建真实任务。") } label: { SettingsRow(symbol: "checkmark.shield", title: "权限", value: "查看") }
            }
            Section("沟通") {
                NavigationLink { SettingsInfoView(title: "消息通道", symbol: "bubble.left", detail: "App", bodyText: "所有对话都在当前应用内模拟。没有短信、邮件或第三方消息通道连接。") } label: { SettingsRow(symbol: "bubble.left", title: "消息通道", value: "App") }
                NavigationLink { NotificationPreferencesView() } label: { SettingsRow(symbol: "bell", title: "通知", value: "演示设置") }
            }
            Section("体验与数据") {
                NavigationLink { SettingsInfoView(title: "外观", symbol: "sun.max", detail: "浅色", bodyText: "根据原型要求，所有页面保持白色或浅灰色。系统切换到深色模式时，Aria 的界面仍保持浅色。") } label: { SettingsRow(symbol: "sun.max", title: "外观", value: "浅色") }
                NavigationLink { DataControlView() } label: { SettingsRow(symbol: "externaldrive", title: "数据控制", value: "管理") }
                NavigationLink { SettingsInfoView(title: "关于 Aria", symbol: "info.circle", detail: "Aria · 1.0 演示版", bodyText: "让复杂工作有清晰的下一步。\n\n本项目基于提供的 HTML 原型，以 SwiftUI 实现原生 iOS 前端。所有内容、状态和结果均为本地模拟。") } label: { SettingsRow(symbol: "info.circle", title: "关于 Aria", value: "1.0") }
            }
            Section {
                Button(role: .destructive) { showLogout = true } label: { Label("退出登录", systemImage: "rectangle.portrait.and.arrow.right") }
            }
        }
        .listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Theme.background)
        .navigationTitle("设置").navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("退出登录？", isPresented: $showLogout, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) { store.logout() }
            Button("取消", role: .cancel) { }
        } message: { Text("将清除本次演示的会话状态，返回登录页。") }
    }
}

private struct SettingsRow: View {
    let symbol: String
    let title: String
    var value: String
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(Theme.secondary).frame(width: 23)
            Text(title).foregroundStyle(Theme.ink)
            Spacer()
            Text(value).font(.caption).foregroundStyle(Theme.secondary)
        }.font(.subheadline).padding(.vertical, 4)
    }
}

private struct SettingsInfoView: View {
    let title: String
    let symbol: String
    let detail: String
    let bodyText: String
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 23) {
                Image(systemName: symbol).font(.system(size: 34, weight: .light)).foregroundStyle(Theme.secondary)
                Text(detail).font(.title2.weight(.medium))
                Text(bodyText).font(.body).lineSpacing(6).foregroundStyle(Theme.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
        }.background(Theme.background).navigationTitle(title).navigationBarTitleDisplayMode(.inline)
    }
}

private struct ConnectorDetailView: View {
    @State private var connected = true
    @State private var showConfirmation = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                VStack(alignment: .leading, spacing: 12) {
                    Label(connected ? "模拟已连接" : "模拟未连接", systemImage: connected ? "checkmark.circle.fill" : "minus.circle")
                        .font(.caption).foregroundStyle(connected ? Theme.accent : Theme.secondary)
                    Text("Gmail").font(.system(size: 30, weight: .medium))
                    Text("让 Aria 在你明确授权的范围内查找邮件、整理信息和准备草稿。")
                        .font(.subheadline).lineSpacing(5).foregroundStyle(Theme.secondary)
                }
                VStack(alignment: .leading, spacing: 17) {
                    SectionEyebrow("当前权限 · 模拟")
                    permission("envelope", "读取邮件", "搜索与你的问题相关的邮件和附件信息。")
                    permission("square.and.pencil", "创建草稿", "准备邮件草稿；发送前仍会向你确认。")
                    permission("checkmark.shield", "受控操作", "发送、删除或更改订阅等操作始终单独审批。")
                }
                Text("演示说明：未连接任何 Google 账号，按钮只改变本页的展示状态，不会授权、撤销授权或访问邮件。")
                    .font(.caption).lineSpacing(4).foregroundStyle(Theme.secondary)
                    .padding(15).background(.white, in: RoundedRectangle(cornerRadius: 12))
                Button { showConfirmation = true } label: {
                    Text(connected ? "断开 Gmail（模拟）" : "连接 Gmail（模拟）")
                        .font(.subheadline.weight(.medium)).frame(maxWidth: .infinity).padding(15)
                }.foregroundStyle(connected ? Color.red : Theme.ink).background(.white, in: RoundedRectangle(cornerRadius: 12))
            }.padding(24)
        }.background(Theme.background).navigationTitle("连接器").navigationBarTitleDisplayMode(.inline)
            .confirmationDialog(connected ? "模拟断开 Gmail？" : "模拟连接 Gmail？", isPresented: $showConfirmation, titleVisibility: .visible) {
                Button(connected ? "断开（仅演示）" : "连接（仅演示）") { connected.toggle() }
                Button("取消", role: .cancel) { }
            } message: { Text("只更新当前页面，不影响任何真实账号。") }
    }
    private func permission(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol).frame(width: 35, height: 35).background(.white, in: RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.subheadline.weight(.medium))
                Text(detail).font(.caption).lineSpacing(4).foregroundStyle(Theme.secondary)
            }
        }
    }
}

private struct NotificationPreferencesView: View {
    @State private var important = true
    @State private var approval = true
    var body: some View {
        Form {
            Section {
                Toggle("重要事项提醒", isOn: $important)
                Toggle("审批状态提醒", isOn: $approval)
            } footer: { Text("这些开关只展示界面交互，不会请求或发送系统通知。离开页面后不会持久保存。") }
        }.tint(Theme.accent).navigationTitle("通知").navigationBarTitleDisplayMode(.inline)
    }
}

private struct DataControlView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showReset = false
    var body: some View {
        List {
            Section("保留的数据") {
                Text("只保存“已完成引导”的本地标记。邮箱、模拟密码、消息、审批与其他演示操作不上传，也不会写入持久数据库。")
                    .font(.subheadline).foregroundStyle(Theme.secondary).padding(.vertical, 6)
            }
            Section {
                Button("重新查看功能引导") { showReset = true }
            } footer: { Text("会退出当前模拟会话，并清除引导完成标记。") }
        }.navigationTitle("数据控制").navigationBarTitleDisplayMode(.inline)
            .confirmationDialog("重新开始演示？", isPresented: $showReset, titleVisibility: .visible) {
                Button("重新开始") { store.replayOnboarding() }
                Button("取消", role: .cancel) { }
            }
    }
}
