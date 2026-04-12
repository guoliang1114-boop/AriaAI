import SwiftUI

struct AIConfigView: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    
    // Provider selection
    @State private var llmProvider = "claude"
    @State private var bigmodelKeyConfigured = false
    @State private var bigmodelKeyMasked = ""
    @State private var isSavingProvider = false
    @State private var providerSaveSuccess = false
    
    // Claude settings
    @State private var claudeApiKey = ""
    @State private var showClaudeKey = false
    @State private var isSavingClaudeKey = false
    @State private var claudeKeySaveSuccess = false
    @State private var claudeKeyError: String? = nil
    @State private var claudeModel = "claude-sonnet-4-6"
    @State private var claudeProxyURL = ""
    @State private var claudeHttpMode = "auto"
    @State private var isSavingClaudeSettings = false
    @State private var claudeSettingsSaveSuccess = false
    
    // Kimi settings
    @State private var kimiApiKey = ""
    @State private var showKimiKey = false
    @State private var isSavingKimiKey = false
    @State private var kimiKeySaveSuccess = false
    @State private var kimiKeyError: String? = nil
    @State private var kimiModel = "moonshot-v1-32k"
    @State private var kimiKeyConfigured = false
    @State private var kimiKeyMasked = ""
    
    // BigModel settings
    @State private var bigmodelApiKey = ""
    @State private var showBigmodelKey = false
    @State private var isSavingBigmodelKey = false
    @State private var bigmodelKeySaveSuccess = false
    @State private var bigmodelKeyError: String? = nil
    @State private var bigmodelModel = "glm-4-plus"
    
    let claudeModels = [
        ("claude-opus-4-6", "Claude Opus 4.6", "最强大，适合复杂任务"),
        ("claude-sonnet-4-6", "Claude Sonnet 4.6", "平衡性能，推荐"),
        ("claude-haiku-4-5-20251001", "Claude Haiku 4.5", "最快，适合简单任务")
    ]
    
    let kimiModels = [
        ("moonshot-v1-32k", "Moonshot v1 32K", "推荐 - 平衡"),
        ("moonshot-v1-128k", "Moonshot v1 128K", "长文档处理"),
        ("moonshot-v1-8k", "Moonshot v1 8K", "轻量快速"),
        ("kimi-k2.5", "Kimi K2.5", "最新模型")
    ]
    
    let bigmodelModels = [
        ("glm-5.1", "GLM-5.1", "最强 Coding - 对标 Claude Opus 4.6"),
        ("glm-5v-turbo", "GLM-5V-Turbo", "多模态 Coding - 视觉理解"),
        ("glm-5-turbo", "GLM-5-Turbo", "龙虾场景优化 - OpenClaw"),
        ("glm-4-plus", "GLM-4-Plus", "GLM-4 最强模型"),
        ("glm-4-air", "GLM-4-Air", "高性价比"),
        ("glm-4-flash", "GLM-4-Flash", "轻量快速"),
        ("glm-4-long", "GLM-4-Long", "长上下文")
    ]
    
    let httpModes = [
        ("auto", "自动 (自定义地址时用HTTP)"),
        ("sdk", "SDK 模式 (Anthropic 官方)"),
        ("http", "HTTP 模式 (无 Stainless Headers)")
    ]
    
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                // Provider Selection Card
                providerCard
                
                // Dynamic Configuration Card based on provider
                if llmProvider == "claude" {
                    claudeConfigCard
                } else if llmProvider == "kimi" {
                    kimiConfigCard
                } else {
                    bigmodelConfigCard
                }
            }
            .padding(Spacing.xxl)
        }
        .background(.surfaceBase)
        .task { @MainActor in
            await loadSettings()
        }
    }
    
    // MARK: - Load Settings
    @MainActor
    private func loadSettings() async {
        // Step 1: 从缓存立即渲染（0 延迟）
        let cached = dataStore.readCachedAISettings()
        applySettings(
            provider: cached.provider,
            model:    cached.model,
            proxy:    cached.proxyURL,
            mode:     cached.httpMode,
            kimiConfigured: cached.kimiConfigured,
            kimiMasked:     cached.kimiMasked,
            bigmodelConfigured: cached.bigmodelConfigured,
            bigmodelMasked:     cached.bigmodelMasked
        )

        // Step 2: 后台并行刷新（1 次 GET /settings/ + 各 provider status）
        async let fresh         = dataStore.refreshAISettingsFromAPI()
        async let kimiStatus    = dataStore.kimiApiKeyStatus()
        async let bigmodelStatus = dataStore.bigmodelApiKeyStatus()
        let (f, kimi, bigmodel) = await (fresh, kimiStatus, bigmodelStatus)

        applySettings(
            provider: f.provider,
            model:    f.model,
            proxy:    f.proxyURL,
            httpMode: f.httpMode,
            kimiConfigured: kimi.configured,
            kimiMasked:     kimi.masked,
            bigmodelConfigured: bigmodel.configured,
            bigmodelMasked:     bigmodel.masked
        )
    }

    @MainActor
    private func applySettings(provider: String, model: String, proxy: String, mode: String,
                                kimiConfigured: Bool, kimiMasked: String,
                                bigmodelConfigured: Bool = false, bigmodelMasked: String = "") {
        llmProvider       = provider
        claudeProxyURL    = proxy
        claudeHttpMode    = mode
        kimiKeyConfigured = kimiConfigured
        kimiKeyMasked     = kimiMasked
        bigmodelKeyConfigured = bigmodelConfigured
        bigmodelKeyMasked     = bigmodelMasked
        claudeModel = claudeModels.contains(where: { $0.0 == model }) ? model : "claude-sonnet-4-6"
        kimiModel   = kimiModels.contains(where:   { $0.0 == model }) ? model : "moonshot-v1-32k"
        bigmodelModel = bigmodelModels.contains(where: { $0.0 == model }) ? model : "glm-5.1"
    }
    
    // MARK: - Provider Card
    private var providerCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                HStack(spacing: Spacing.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.primary500.opacity(0.1))
                            .frame(width: 40, height: 40)
                        Image(systemName: "cpu")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.primary500)
                    }
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text(lang.t("LLM 底座", "LLM Provider"))
                            .font(TextStyle.titleMD)
                            .foregroundColor(.onSurface)
                        Text(lang.t("选择 AI 服务提供商", "Choose AI service provider"))
                            .font(TextStyle.bodySM)
                            .foregroundColor(.onSurfaceVariant)
                    }
                    
                    Spacer()
                }
                
                Divider().opacity(0.4)
                
                HStack(spacing: Spacing.lg) {
                    ProviderButton(
                        icon: "cloud.fill",
                        name: "Claude",
                        description: "Anthropic",
                        isSelected: llmProvider == "claude",
                        status: dataStore.apiKeyConfigured ? .configured : .notConfigured
                    ) {
                        llmProvider = "claude"
                        saveProvider()
                    }
                    
                    ProviderButton(
                        icon: "moon.fill",
                        name: "Kimi",
                        description: "Moonshot AI",
                        isSelected: llmProvider == "kimi",
                        status: kimiKeyConfigured ? .configured : .notConfigured
                    ) {
                        llmProvider = "kimi"
                        saveProvider()
                    }
                    
                    ProviderButton(
                        icon: "bolt.fill",
                        name: "BigModel",
                        description: "智谱 AI",
                        isSelected: llmProvider == "bigmodel",
                        status: bigmodelKeyConfigured ? .configured : .notConfigured
                    ) {
                        llmProvider = "bigmodel"
                        saveProvider()
                    }
                }
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Claude Config Card
    private var claudeConfigCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Header
                HStack(spacing: Spacing.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.blue.opacity(0.1))
                            .frame(width: 40, height: 40)
                        Image(systemName: "cloud.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.blue)
                    }
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Claude 配置")
                            .font(TextStyle.titleMD)
                            .foregroundColor(.onSurface)
                        Text("Anthropic AI 服务设置")
                            .font(TextStyle.bodySM)
                            .foregroundColor(.onSurfaceVariant)
                    }
                    
                    Spacer()
                    
                    if dataStore.apiKeyConfigured {
                        StatusBadge(text: "已配置", type: .success)
                    } else {
                        StatusBadge(text: "未配置", type: .warning)
                    }
                }
                
                Divider().opacity(0.4)
                
                // Model Selection
                configSectionTitle("模型选择", "选择 Claude 模型")
                
                LazyVGrid(columns: [GridItem(.flexible())], spacing: Spacing.sm) {
                    ForEach(claudeModels, id: \.0) { id, name, desc in
                        ModelOptionCard(
                            name: name,
                            description: desc,
                            isSelected: claudeModel == id
                        ) {
                            claudeModel = id
                        }
                    }
                }
                
                // API Key
                configSectionTitle("API 密钥", "Claude API Key")
                
                VStack(spacing: Spacing.xs) {
                    HStack {
                        if showClaudeKey {
                            TextField("sk-ant-api03-...", text: $claudeApiKey)
                                .textFieldStyle(.plain)
                        } else {
                            SecureField("sk-ant-api03-...", text: $claudeApiKey)
                                .textFieldStyle(.plain)
                        }
                        
                        Button {
                            showClaudeKey.toggle()
                        } label: {
                            Image(systemName: showClaudeKey ? "eye.slash" : "eye")
                                .foregroundColor(.onSurfaceVariant)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(Spacing.md)
                    .background(Color.surfaceContainerHighest)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    
                    if let error = claudeKeyError {
                        Text(error)
                            .font(TextStyle.labelSM)
                            .foregroundColor(.statusFailed)
                    }
                }
                
                // Advanced Settings
                configSectionTitle("高级设置", "代理和调用方式")
                
                VStack(spacing: Spacing.md) {
                    // Proxy URL
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text("代理地址")
                            .font(TextStyle.labelSM)
                            .foregroundColor(.onSurfaceVariant)
                        TextField("https://api.anthropic.com (留空使用官方)", text: $claudeProxyURL)
                            .textFieldStyle(.plain)
                            .padding(Spacing.md)
                            .background(Color.surfaceContainerHighest)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                    
                    // HTTP Mode
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text("调用方式")
                            .font(TextStyle.labelSM)
                            .foregroundColor(.onSurfaceVariant)
                        
                        Picker("", selection: $claudeHttpMode) {
                            ForEach(httpModes, id: \.0) { mode, label in
                                Text(label).tag(mode)
                            }
                        }
                        .pickerStyle(.menu)
                        .padding(Spacing.md)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                }
                
                // Save Button
                HStack {
                    Spacer()
                    PrimaryButton(
                        claudeSettingsSaveSuccess ? "已保存 ✓" : (isSavingClaudeSettings ? "保存中..." : "保存 Claude 配置"),
                        icon: claudeSettingsSaveSuccess ? "checkmark" : "arrow.up.circle"
                    ) {
                        saveClaudeSettings()
                    }
                    .disabled(isSavingClaudeSettings)
                }
                .padding(.top, Spacing.md)
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Kimi Config Card
    private var kimiConfigCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Header
                HStack(spacing: Spacing.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.orange.opacity(0.1))
                            .frame(width: 40, height: 40)
                        Image(systemName: "moon.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.orange)
                    }
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Kimi 配置")
                            .font(TextStyle.titleMD)
                            .foregroundColor(.onSurface)
                        Text("Moonshot AI 服务设置")
                            .font(TextStyle.bodySM)
                            .foregroundColor(.onSurfaceVariant)
                    }
                    
                    Spacer()
                    
                    if kimiKeyConfigured {
                        StatusBadge(text: "已配置", type: .success)
                    } else {
                        StatusBadge(text: "未配置", type: .warning)
                    }
                }
                
                Divider().opacity(0.4)
                
                // Model Selection
                configSectionTitle("模型选择", "选择 Kimi 模型")
                
                LazyVGrid(columns: [GridItem(.flexible())], spacing: Spacing.sm) {
                    ForEach(kimiModels, id: \.0) { id, name, desc in
                        ModelOptionCard(
                            name: name,
                            description: desc,
                            isSelected: kimiModel == id
                        ) {
                            kimiModel = id
                        }
                    }
                }
                
                // API Key
                configSectionTitle("API 密钥", "Moonshot API Key")
                
                VStack(spacing: Spacing.xs) {
                    HStack {
                        if showKimiKey {
                            TextField("sk-...", text: $kimiApiKey)
                                .textFieldStyle(.plain)
                        } else {
                            SecureField("sk-...", text: $kimiApiKey)
                                .textFieldStyle(.plain)
                        }
                        
                        Button {
                            showKimiKey.toggle()
                        } label: {
                            Image(systemName: showKimiKey ? "eye.slash" : "eye")
                                .foregroundColor(.onSurfaceVariant)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(Spacing.md)
                    .background(Color.surfaceContainerHighest)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    
                    if kimiKeyConfigured && !kimiKeyMasked.isEmpty {
                        Text("已配置 Key: \(kimiKeyMasked)")
                            .font(TextStyle.labelSM)
                            .foregroundColor(.statusActive)
                    }
                    
                    if let error = kimiKeyError {
                        HStack(spacing: Spacing.xs) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.statusFailed)
                            Text(error)
                                .font(TextStyle.labelSM)
                                .foregroundColor(.statusFailed)
                        }
                    }
                }
                
                // Save Button
                HStack {
                    Spacer()
                    PrimaryButton(
                        kimiKeySaveSuccess ? "已保存 ✓" : (isSavingKimiKey ? "保存中..." : "保存 Kimi 配置"),
                        icon: kimiKeySaveSuccess ? "checkmark" : "arrow.up.circle"
                    ) {
                        saveKimiSettings()
                    }
                    .disabled(isSavingKimiKey || (kimiApiKey.isEmpty && !kimiKeyConfigured))
                }
                .padding(.top, Spacing.md)
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - BigModel Config Card
    private var bigmodelConfigCard: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Header
                HStack(spacing: Spacing.md) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.purple.opacity(0.1))
                            .frame(width: 40, height: 40)
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.purple)
                    }
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text("BigModel 配置")
                            .font(TextStyle.titleMD)
                            .foregroundColor(.onSurface)
                        Text("智谱 AI 服务设置")
                            .font(TextStyle.bodySM)
                            .foregroundColor(.onSurfaceVariant)
                    }
                    
                    Spacer()
                    
                    if bigmodelKeyConfigured {
                        StatusBadge(text: "已配置", type: .success)
                    } else {
                        StatusBadge(text: "未配置", type: .warning)
                    }
                }
                
                Divider().opacity(0.4)
                
                // Model Selection
                configSectionTitle("模型选择", "选择 BigModel 模型")
                
                LazyVGrid(columns: [GridItem(.flexible())], spacing: Spacing.sm) {
                    ForEach(bigmodelModels, id: \.0) { id, name, desc in
                        ModelOptionCard(
                            name: name,
                            description: desc,
                            isSelected: bigmodelModel == id
                        ) {
                            bigmodelModel = id
                        }
                    }
                }
                
                // API Key
                configSectionTitle("API 密钥", "智谱 AI API Key")
                
                VStack(spacing: Spacing.xs) {
                    HStack {
                        if showBigmodelKey {
                            TextField("sk-...", text: $bigmodelApiKey)
                                .textFieldStyle(.plain)
                        } else {
                            SecureField("sk-...", text: $bigmodelApiKey)
                                .textFieldStyle(.plain)
                        }
                        
                        Button {
                            showBigmodelKey.toggle()
                        } label: {
                            Image(systemName: showBigmodelKey ? "eye.slash" : "eye")
                                .foregroundColor(.onSurfaceVariant)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(Spacing.md)
                    .background(Color.surfaceContainerHighest)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    
                    if bigmodelKeyConfigured && !bigmodelKeyMasked.isEmpty {
                        Text("已配置 Key: \(bigmodelKeyMasked)")
                            .font(TextStyle.labelSM)
                            .foregroundColor(.statusActive)
                    }
                    
                    if let error = bigmodelKeyError {
                        HStack(spacing: Spacing.xs) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.statusFailed)
                            Text(error)
                                .font(TextStyle.labelSM)
                                .foregroundColor(.statusFailed)
                        }
                    }
                }
                
                // Save Button
                HStack {
                    Spacer()
                    PrimaryButton(
                        bigmodelKeySaveSuccess ? "已保存 ✓" : (isSavingBigmodelKey ? "保存中..." : "保存 BigModel 配置"),
                        icon: bigmodelKeySaveSuccess ? "checkmark" : "arrow.up.circle"
                    ) {
                        saveBigmodelSettings()
                    }
                    .disabled(isSavingBigmodelKey || (bigmodelApiKey.isEmpty && !bigmodelKeyConfigured))
                }
                .padding(.top, Spacing.md)
            }
            .padding(Spacing.xl)
        }
    }
    
    // MARK: - Helpers
    private func configSectionTitle(_ title: String, _ subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(TextStyle.titleSM)
                .foregroundColor(.onSurface)
            Text(subtitle)
                .font(TextStyle.bodySM)
                .foregroundColor(.onSurfaceVariant)
        }
        .padding(.top, Spacing.md)
    }
    
    // MARK: - Actions
    private func saveProvider() {
        isSavingProvider = true
        providerSaveSuccess = false
        Task {
            await dataStore.saveLLMProvider(llmProvider)
            // Save the appropriate default model
            let defaultModel: String = {
                switch llmProvider {
                case "kimi": return kimiModel
                case "bigmodel": return bigmodelModel
                default: return claudeModel
                }
            }()
            await dataStore.saveSelectedModel(defaultModel)
            isSavingProvider = false
            providerSaveSuccess = true
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            providerSaveSuccess = false
        }
    }
    
    private func saveClaudeSettings() {
        claudeKeyError = nil
        isSavingClaudeSettings = true
        claudeSettingsSaveSuccess = false
        
        Task { @MainActor in
            // Save API key if provided
            if !claudeApiKey.isEmpty {
                let ok = await dataStore.saveApiKey(claudeApiKey)
                if !ok {
                    claudeKeyError = dataStore.error ?? "保存 API Key 失败"
                    isSavingClaudeSettings = false
                    return
                }
            }
            
            // Save model
            await dataStore.saveSelectedModel(claudeModel)
            
            // Save proxy URL
            await dataStore.saveClaudeProxyURL(claudeProxyURL)
            
            // Save HTTP mode
            await dataStore.saveClaudeHttpMode(claudeHttpMode)
            
            // Refresh API key status
            await dataStore.checkApiKey()
            claudeApiKey = ""
            
            isSavingClaudeSettings = false
            claudeSettingsSaveSuccess = true
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            claudeSettingsSaveSuccess = false
        }
    }
    
    private func saveKimiSettings() {
        kimiKeyError = nil
        isSavingKimiKey = true
        kimiKeySaveSuccess = false
        
        Task { @MainActor in
            // Save API key if provided
            if !kimiApiKey.isEmpty {
                let ok = await dataStore.saveKimiApiKey(kimiApiKey)
                if !ok {
                    kimiKeyError = dataStore.error ?? "保存 API Key 失败"
                    isSavingKimiKey = false
                    return
                }
            }
            
            // Save model
            await dataStore.saveSelectedModel(kimiModel)
            
            // Refresh Kimi key status to get updated masked key
            let kimiStatus = await dataStore.kimiApiKeyStatus()
            kimiKeyConfigured = kimiStatus.configured
            kimiKeyMasked = kimiStatus.masked
            kimiApiKey = ""
            
            isSavingKimiKey = false
            kimiKeySaveSuccess = true
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            kimiKeySaveSuccess = false
        }
    }
    
    private func saveBigmodelSettings() {
        bigmodelKeyError = nil
        isSavingBigmodelKey = true
        bigmodelKeySaveSuccess = false
        
        Task { @MainActor in
            // Save API key if provided
            if !bigmodelApiKey.isEmpty {
                let ok = await dataStore.saveBigmodelApiKey(bigmodelApiKey)
                if !ok {
                    bigmodelKeyError = dataStore.error ?? "保存 API Key 失败"
                    isSavingBigmodelKey = false
                    return
                }
            }
            
            // Save model
            await dataStore.saveSelectedModel(bigmodelModel)
            
            // Refresh BigModel key status to get updated masked key
            let bigmodelStatus = await dataStore.bigmodelApiKeyStatus()
            bigmodelKeyConfigured = bigmodelStatus.configured
            bigmodelKeyMasked = bigmodelStatus.masked
            bigmodelApiKey = ""
            
            isSavingBigmodelKey = false
            bigmodelKeySaveSuccess = true
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            bigmodelKeySaveSuccess = false
        }
    }
}

// MARK: - Provider Status
enum ProviderStatus {
    case configured
    case notConfigured
}

// MARK: - Status Badge
struct StatusBadge: View {
    let text: String
    let type: BadgeType
    
    enum BadgeType {
        case success
        case warning
    }
    
    var body: some View {
        Text(text)
            .font(TextStyle.labelSM)
            .foregroundColor(type == .success ? .statusActive : .statusOnHold)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background((type == .success ? Color.statusActive : Color.statusOnHold).opacity(0.1))
            .clipShape(Capsule())
    }
}

// MARK: - Provider Button
struct ProviderButton: View {
    let icon: String
    let name: String
    let description: String
    let isSelected: Bool
    let status: ProviderStatus
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(isSelected ? Color.primary500.opacity(0.15) : Color.surfaceContainerHigh)
                        .frame(width: 48, height: 48)
                    Image(systemName: icon)
                        .font(.system(size: 22))
                        .foregroundColor(isSelected ? .primary500 : .onSurfaceVariant)
                }
                
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(TextStyle.titleSM)
                        .foregroundColor(.onSurface)
                    Text(description)
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                }
                
                Spacer()
                
                VStack(spacing: 4) {
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.primary500)
                            .font(.system(size: 22))
                    }
                    
                    Circle()
                        .fill(status == .configured ? Color.statusActive : Color.statusOnHold)
                        .frame(width: 8, height: 8)
                }
            }
            .padding(Spacing.lg)
            .background(isSelected ? Color.primary500.opacity(0.05) : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: Radius.lg)
                    .stroke(isSelected ? Color.primary500 : Color.clear, lineWidth: 2)
            )
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Model Option Card
struct ModelOptionCard: View {
    let name: String
    let description: String
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.md) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(name)
                        .font(TextStyle.bodyMD)
                        .foregroundColor(.onSurface)
                    Text(description)
                        .font(TextStyle.bodySM)
                        .foregroundColor(.onSurfaceVariant)
                }
                
                Spacer()
                
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.primary500)
                        .font(.system(size: 20))
                } else {
                    Circle()
                        .stroke(Color.onSurfaceVariant.opacity(0.3), lineWidth: 1.5)
                        .frame(width: 20, height: 20)
                }
            }
            .padding(Spacing.md)
            .background(isSelected ? Color.primary500.opacity(0.08) : Color.surfaceContainerHigh.opacity(0.4))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.md)
                    .stroke(isSelected ? Color.primary500.opacity(0.5) : Color.clear, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        }
        .buttonStyle(.plain)
    }
}
