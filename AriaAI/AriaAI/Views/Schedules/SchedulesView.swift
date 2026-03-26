import SwiftUI

struct SchedulesView: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @State private var tasks: [ScheduledTask] = []
    @State private var showAddSheet = false

    private func syncTasks() {
        tasks = dataStore.scheduledTasks.isEmpty ? SampleData.scheduledTasks(for: lang) : dataStore.scheduledTasks
    }

    var successRate: Double {
        guard !tasks.isEmpty else { return 0 }
        return Double(tasks.filter { $0.status == .success }.count) / Double(tasks.count)
    }

    var newThisWeekCount: Int {
        let weekAgo = Date().addingTimeInterval(-7 * 86400)
        return dataStore.apiSchedules.filter { $0.createdAt > weekAgo }.count
    }

    var totalTaskCount: Int {
        dataStore.apiSchedules.isEmpty ? tasks.count : dataStore.apiSchedules.count
    }

    var nextRunLabel: String {
        let upcoming = dataStore.apiSchedules.compactMap { $0.nextRun }.sorted()
        guard let next = upcoming.first else { return "–" }
        let diff = next.timeIntervalSinceNow
        if diff <= 0 { return lang.t("现在", "Now") }
        if diff < 3600 { return "\(Int(diff / 60))m" }
        if diff < 86400 { return "\(Int(diff / 3600))h" }
        return "\(Int(diff / 86400))d"
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBarView(
                title: lang.t("定时任务", "Scheduled Tasks"),
                subtitle: lang.t("自动化智能工作流，管理周期性分析与报告任务", "Automated intelligence workflows. Manage recurring analysis and reporting tasks.")
            ) {
                PrimaryButton(lang.t("添加任务", "Add New Task"), icon: "plus") {
                    showAddSheet = true
                }
            }

            ScrollView {
                VStack(spacing: Spacing.xl) {
                    // Stats row
                    HStack(spacing: Spacing.lg) {
                        statCard(lang.t("任务总数", "TOTAL TASKS"), value: "\(tasks.count)",
                                 sub: newThisWeekCount > 0
                                    ? lang.t("+\(newThisWeekCount) 本周", "+\(newThisWeekCount) this week")
                                    : lang.t("本周无新增", "None this week"),
                                 subColor: newThisWeekCount > 0 ? .statusActive : .onSurfaceVariant)
                        statCard(lang.t("成功率", "SUCCESS RATE"), value: "\(Int(successRate * 100))%", sub: lang.t("稳定", "Stable"), subColor: .statusActive)
                        statCard(lang.t("下次执行", "NEXT EXECUTION"), value: nextRunLabel, sub: lang.t("全局同步", "Global Sync"), subColor: nil)
                        computeCard
                    }

                    // Table
                    VStack(alignment: .leading, spacing: Spacing.md) {
                        HStack {
                            Text(lang.t("活跃计划", "ACTIVE SCHEDULES")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.6)
                            Spacer()
                            Image(systemName: "line.3.horizontal.decrease").foregroundColor(.onSurfaceVariant).font(.system(size: 14))
                        }

                        HStack {
                            Text(lang.t("任务名称 & 项目", "TASK NAME & PROJECT")).frame(maxWidth: .infinity, alignment: .leading)
                            Text(lang.t("频率", "FREQUENCY")).frame(width: 120, alignment: .leading)
                            Text(lang.t("下次运行", "NEXT RUN")).frame(width: 140, alignment: .leading)
                            Text(lang.t("状态", "STATUS")).frame(width: 100, alignment: .leading)
                            Text(lang.t("启用", "ENABLED")).frame(width: 70, alignment: .center)
                        }
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                        .padding(.horizontal, Spacing.lg)

                        SeparatedList(tasks) { task in
                            ScheduleRow(task: binding(for: task))
                        }

                        Text(lang.t("显示 \(tasks.count) / \(totalTaskCount) 个定时任务", "Showing \(tasks.count) of \(totalTaskCount) scheduled tasks"))
                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                            .padding(.horizontal, Spacing.lg)
                    }
                }
                .padding(Spacing.xxl)
            }
            .background(.surfaceBase)
        }
        .onAppear { syncTasks() }
        .onChange(of: dataStore.scheduledTasks.count) { syncTasks() }
        .onChange(of: lang) { syncTasks() }
        .sheet(isPresented: $showAddSheet) {
            AddScheduledTaskSheet()
                .environmentObject(dataStore)
        }
    }

    private func binding(for task: ScheduledTask) -> Binding<ScheduledTask> {
        guard let idx = tasks.firstIndex(where: { $0.id == task.id }) else {
            fatalError("Task not found")
        }
        return $tasks[idx]
    }

    @ViewBuilder private func statCard(_ title: String, value: String, sub: String, subColor: Color?) -> some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(title).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                Text(value).font(TextStyle.headlineLG).foregroundColor(.onSurface)
                HStack(spacing: 3) {
                    if let color = subColor { Circle().fill(color).frame(width: 5, height: 5) }
                    Text(sub).font(TextStyle.labelSM).foregroundColor(subColor ?? .onSurfaceVariant)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
        }
    }

    private var computeCard: some View {
        let ran = dataStore.apiSchedules.filter { $0.lastRun != nil }.count
        let total = max(dataStore.apiSchedules.count, 1)
        let progress = dataStore.apiSchedules.isEmpty ? 0.0 : min(Double(ran) / Double(total), 1.0)
        let label = dataStore.apiSchedules.isEmpty
            ? lang.t("暂无数据", "No data yet")
            : lang.t("已执行 \(ran) / \(total) 个任务", "\(ran) of \(total) tasks executed")
        return CardContainer {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(lang.t("任务执行率", "TASK EXECUTION RATE")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                ProgressBar(progress: progress)
                Text(label).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.lg)
        }
    }
}

// MARK: - Add Scheduled Task Sheet

struct AddScheduledTaskSheet: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.dismiss) var dismiss
    @Environment(\.appLanguage) var lang

    @State private var name = ""
    @State private var prompt = ""
    @State private var frequency = "Daily"
    @State private var isSaving = false

    private let frequencies = ["Daily", "Weekly", "Bi-weekly", "Monthly", "Workdays"]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            // Header
            HStack {
                Text(lang.t("添加定时任务", "Add Scheduled Task"))
                    .font(TextStyle.headlineSM).foregroundColor(.onSurface)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                }
                .buttonStyle(.plain)
            }

            Divider().opacity(0.4)

            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Task name
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(lang.t("任务名称", "Task Name"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                    TextField(lang.t("例：每周市场报告", "e.g. Weekly Market Report"), text: $name)
                        .textFieldStyle(.plain).font(TextStyle.bodyMD)
                        .padding(Spacing.md)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                }

                // Prompt
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(lang.t("执行提示词", "Prompt / Instruction"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                    TextEditor(text: $prompt)
                        .font(TextStyle.bodyMD)
                        .scrollContentBackground(.hidden)
                        .padding(Spacing.sm)
                        .frame(height: 80)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                        .overlay(
                            Group {
                                if prompt.isEmpty {
                                    Text(lang.t("描述 AI 需要执行的任务…", "Describe what the AI should do…"))
                                        .font(TextStyle.bodyMD).foregroundColor(.onSurfaceVariant.opacity(0.5))
                                        .padding(Spacing.md)
                                        .allowsHitTesting(false)
                                } else { EmptyView() }
                            }, alignment: .topLeading
                        )
                }

                // Frequency
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(lang.t("执行频率", "Frequency"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant).tracking(0.4)
                    Picker("", selection: $frequency) {
                        ForEach(frequencies, id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)
                }
            }

            Spacer()

            HStack(spacing: Spacing.md) {
                SecondaryButton(lang.t("取消", "Cancel")) { dismiss() }
                PrimaryButton(isSaving ? lang.t("创建中…", "Creating…") : lang.t("创建任务", "Create Task"), icon: "plus") {
                    guard !name.isEmpty else { return }
                    isSaving = true
                    Task {
                        await dataStore.createScheduledTask(name: name, prompt: prompt, frequency: frequency)
                        isSaving = false
                        dismiss()
                    }
                }
                .disabled(name.isEmpty || isSaving)
            }
        }
        .padding(Spacing.xxl)
        .frame(width: 480, height: 420)
        .background(Color.surfaceContainerLowest)
    }
}

// MARK: - Schedule Row
struct ScheduleRow: View {
    @Binding var task: ScheduledTask
    @Environment(\.appLanguage) var lang
    @EnvironmentObject var dataStore: DataStore
    @State private var isHovered = false
    @State private var confirmDelete = false

    private func statusInfo() -> (label: String, color: Color) {
        switch task.status {
        case .success:   return (lang.t("成功", "Success"), .statusActive)
        case .failed:    return (lang.t("失败（审计）", "Failed (Audit)"), .statusFailed)
        case .running:   return (lang.t("运行中", "Running"), .primary500)
        case .scheduled: return (lang.t("已计划", "Scheduled"), .onSurfaceVariant)
        }
    }

    private var taskIcon: String {
        if task.name.contains("Report") || task.name.contains("报告") { return "doc.text.fill" }
        if task.name.contains("Analysis") || task.name.contains("分析") { return "chart.bar.fill" }
        if task.name.contains("Competitor") || task.name.contains("竞争") { return "person.2.fill" }
        return "envelope.fill"
    }

    var body: some View {
        HStack(alignment: .center) {
            HStack(spacing: Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8).fill(Color.primaryFixed).frame(width: 36, height: 36)
                    Image(systemName: taskIcon).font(.system(size: 14)).foregroundColor(.primary500)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.name).font(TextStyle.titleSM).foregroundColor(.onSurface)
                    Text(lang.t("项目：\(task.project)", "Project: \(task.project)")).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 4) {
                Image(systemName: "arrow.clockwise").font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                Text(task.frequency).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
            }
            .frame(width: 120, alignment: .leading)

            Text(task.nextRun).font(TextStyle.bodySM).foregroundColor(.onSurface)
                .frame(width: 140, alignment: .leading)

            let info = statusInfo()
            HStack(spacing: 4) {
                Circle().fill(info.color).frame(width: 6, height: 6)
                Text(info.label).font(TextStyle.labelSM).foregroundColor(info.color)
            }
            .frame(width: 100, alignment: .leading)

            Toggle("", isOn: $task.isEnabled)
                .toggleStyle(.switch).tint(.primary500)
                .scaleEffect(0.75).frame(width: 70)
                .onChange(of: task.isEnabled) { _, newValue in
                    if let apiId = task.apiId {
                        Task { await dataStore.toggleTask(apiId: apiId, enabled: newValue) }
                    }
                }

            if isHovered {
                Button { confirmDelete = true } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 12))
                        .foregroundColor(.statusFailed.opacity(0.7))
                }
                .buttonStyle(.plain)
                .frame(width: 28)
            } else {
                Spacer().frame(width: 28)
            }
        }
        .padding(.horizontal, Spacing.lg)
        .padding(.vertical, Spacing.md)
        .onHover { isHovered = $0 }
        .alert(lang.t("删除任务？", "Delete task?"), isPresented: $confirmDelete) {
            Button(lang.t("删除", "Delete"), role: .destructive) {
                if let apiId = task.apiId {
                    Task { await dataStore.deleteScheduledTask(apiId: apiId) }
                }
            }
            Button(lang.t("取消", "Cancel"), role: .cancel) {}
        } message: {
            Text(lang.t("「\(task.name)」将被永久删除。", "\"\(task.name)\" will be permanently deleted."))
        }
    }
}
