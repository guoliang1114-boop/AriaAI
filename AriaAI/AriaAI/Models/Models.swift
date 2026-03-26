import Foundation
import SwiftUI

// MARK: - Language

enum AppLanguage: String, CaseIterable {
    case zh = "zh"
    case en = "en"

    /// Returns zh string when language is .zh, en string otherwise.
    func t(_ zh: String, _ en: String) -> String {
        self == .zh ? zh : en
    }

    var displayName: String {
        switch self {
        case .zh: return "中文"
        case .en: return "English"
        }
    }
}

// MARK: - App State
enum AppScreen: String, CaseIterable, Identifiable {
    case chat = "chat"
    case skills = "skills"
    case projects = "projects"
    case clients = "clients"
    case knowledgeBase = "knowledgeBase"
    case schedules = "schedules"
    case templates = "templates"
    case settings = "settings"

    var id: String { rawValue }

    var label: String { label(for: .zh) }

    func label(for lang: AppLanguage) -> String {
        switch self {
        case .chat:          return lang.t("对话工作区", "Chat")
        case .skills:        return lang.t("技能中心", "Skills")
        case .projects:      return lang.t("项目空间", "Projects")
        case .clients:       return lang.t("客户管理", "Clients")
        case .knowledgeBase: return lang.t("知识库", "Knowledge Base")
        case .schedules:     return lang.t("定时任务", "Schedules")
        case .templates:     return lang.t("模板库", "Templates")
        case .settings:      return lang.t("设置", "Settings")
        }
    }

    var icon: String {
        switch self {
        case .chat: return "bubble.left.and.bubble.right"
        case .skills: return "puzzlepiece.extension"
        case .projects: return "folder"
        case .clients: return "person.2"
        case .knowledgeBase: return "books.vertical"
        case .schedules: return "clock"
        case .templates: return "doc.richtext"
        case .settings: return "gearshape"
        }
    }
}

// MARK: - Project
struct Project: Identifiable {
    let id: UUID
    var name: String
    var client: String
    var type: String
    var period: String
    var status: ProjectStatus
    var contextFreshness: Double // 0.0 - 1.0
    var filesCount: Int
    var taskType: TaskType
    var contextSummary: [String]
    var milestones: [Milestone]
    var files: [ProjectFile]

    enum ProjectStatus: String, CaseIterable {
        case lead       = "lead"        // 线索
        case opportunity = "opportunity" // 商机
        case won        = "won"         // 中标
        case delivering = "delivering"  // 执行交付
        case archived   = "archived"    // 已归档

        // Which top-level pipeline stage this belongs to
        enum Stage { case bd, delivery, archive }
        var stage: Stage {
            switch self {
            case .lead, .opportunity, .won: return .bd
            case .delivering:               return .delivery
            case .archived:                 return .archive
            }
        }

        func label(for lang: AppLanguage) -> String {
            switch self {
            case .lead:        return lang.t("线索", "Lead")
            case .opportunity:  return lang.t("商机", "Opportunity")
            case .won:          return lang.t("中标", "Won")
            case .delivering:   return lang.t("执行交付", "Delivering")
            case .archived:     return lang.t("已归档", "Archived")
            }
        }

        var color: String {
            switch self {
            case .lead:        return "#6750A4"  // purple
            case .opportunity:  return "#B45309"  // amber
            case .won:          return "#1a56db"  // blue
            case .delivering:   return "#1a7a4a"  // green
            case .archived:     return "#44474a"  // gray
            }
        }

        // Next stage for the "Promote" action
        var next: ProjectStatus? {
            switch self {
            case .lead:        return .opportunity
            case .opportunity:  return .won
            case .won:          return .delivering
            case .delivering, .archived: return nil
            }
        }

        func nextLabel(for lang: AppLanguage) -> String? {
            guard let n = next else { return nil }
            return lang.t("推进至「\(n.label(for: .zh))」", "Move to \"\(n.label(for: .en))\"")
        }
    }

    enum TaskType: String {
        case deepTask = "DEEP TASK"
        case quickTool = "QUICK TOOL"
        case archival = "ARCHIVAL"

        func label(for lang: AppLanguage) -> String {
            switch self {
            case .deepTask:  return lang.t("深度任务", "DEEP TASK")
            case .quickTool: return lang.t("快捷工具", "QUICK TOOL")
            case .archival:  return lang.t("归档", "ARCHIVAL")
            }
        }
    }
}

struct Milestone: Identifiable {
    let id: UUID
    var title: String
    var isCompleted: Bool
    var date: String
    var isPriority: Bool
    var dueNote: String?
}

struct ProjectFile: Identifiable {
    let id: UUID
    var name: String
    var type: FileType
    var size: String

    enum FileType: String {
        case pdf = "PDF"
        case xlsx = "XLSX"
        case pptx = "PPTX"
        case docx = "DOCX"

        var iconName: String {
            switch self {
            case .pdf:  return "doc.fill"
            case .xlsx: return "tablecells.fill"
            case .pptx: return "play.rectangle.fill"
            case .docx: return "doc.text.fill"
            }
        }

        var iconColor: Color {
            switch self {
            case .pdf:  return Color(hex: "#b3261e")
            case .xlsx: return Color(hex: "#1a8a4a")
            case .pptx: return Color(hex: "#c4760a")
            case .docx: return Color(hex: "#1a56db")
            }
        }
    }
}

// MARK: - File type helpers for string-based document types (KnowledgeBase)
extension String {
    var fileTypeIconName: String {
        switch self.uppercased() {
        case "PDF":  return "doc.fill"
        case "DOCX": return "doc.text.fill"
        case "XLSX": return "tablecells.fill"
        case "PPTX": return "play.rectangle.fill"
        default:     return "doc"
        }
    }

    var fileTypeIconColor: Color {
        switch self.uppercased() {
        case "PDF":  return Color(hex: "#b3261e")
        case "DOCX": return Color(hex: "#1a56db")
        case "XLSX": return Color(hex: "#1a8a4a")
        case "PPTX": return Color(hex: "#c4760a")
        default:     return Color(hex: "#44474a")
        }
    }
}

// MARK: - Message / Chat

enum ChatAttachment: Equatable {
    case skill(Int)       // skill_id
    case document(Int)    // doc_id
    case file(Int)        // file_id
    case project(Int)     // project_id
}

struct ChatMessage: Identifiable {
    let id: UUID
    var role: Role
    var content: String
    var timestamp: Date
    var attachments: [ChatAttachment]
    var cards: [InsightCard]?

    enum Role {
        case user, assistant
    }
}

struct InsightCard: Identifiable {
    let id: UUID
    var icon: String
    var title: String
    var body: String
}

// MARK: - Skill
struct Skill: Identifiable {
    let id: UUID
    var apiId: Int? = nil   // set when converted from APISkill
    var name: String
    var description: String
    var type: SkillType
    var category: String = ""   // business domain (战略与增长, 运营与效能, ...)
    var estimatedTime: String
    var tools: [String]

    enum SkillType: String {
        case quickTool       = "Quick Tool"
        case deepTask        = "Deep Task"
        case guidedWorkflow  = "Guided Workflow"

        func label(for lang: AppLanguage) -> String {
            switch self {
            case .quickTool:      return lang.t("快捷工具", "Quick Tool")
            case .deepTask:       return lang.t("深度任务", "Deep Task")
            case .guidedWorkflow: return lang.t("专家工作流", "Guided Workflow")
            }
        }
    }
}

// MARK: - Knowledge Document
struct KnowledgeDocument: Identifiable {
    let id: UUID
    var name: String
    var fileType: String
    var category: String
    var vectorStatus: VectorStatus
    var vectorProgress: Double
    var date: String

    enum VectorStatus {
        case synced, processing, failed
        var label: String {
            switch self {
            case .synced: return "Synced 100%"
            case .processing: return "Processing..."
            case .failed: return "Failed"
            }
        }
    }
}

// MARK: - Scheduled Task
struct ScheduledTask: Identifiable {
    let id: UUID
    var apiId: Int? = nil
    var name: String
    var project: String
    var frequency: String
    var nextRun: String
    var status: TaskStatus
    var isEnabled: Bool

    enum TaskStatus: String {
        case success = "Success"
        case failed = "Failed"
        case running = "Running"
        case scheduled = "Scheduled"
    }
}

// MARK: - Template
struct Template: Identifiable {
    let id: UUID
    var apiId: Int? = nil
    var name: String
    var category: String
    var tags: [String]
    var thumbnail: String // SF Symbol name for placeholder
    var lastModified: String
    var assignedProject: String?
    var status: String?
}

// MARK: - Client
struct ClientRecord: Identifiable {
    let id: UUID
    var apiId: Int
    var name: String
    var industry: String
    var contact: String
    var notes: String
    var documentCount: Int
    var projectNames: [String]
}

// MARK: - Sample Data
enum SampleData {

    static func skills(for lang: AppLanguage) -> [Skill] {
        let isZh = lang == .zh
        return [
            Skill(id: UUID(),
                  name: isZh ? "SWOT 分析" : "SWOT Analysis",
                  description: isZh ? "AI 辅助分析内部优劣势与外部机会威胁，用于战略审计。" : "AI for internal strengths/weaknesses and external opportunities/threats for strategic audits.",
                  type: .deepTask, estimatedTime: isZh ? "6 小时" : "6 HOURS", tools: ["Logic Tree"]),
            Skill(id: UUID(),
                  name: isZh ? "市场情绪分析" : "Market Sentiment",
                  description: isZh ? "基于 AI 合成数据集的实时市场情绪分析。" : "Real-time sentiment analysis with AI-synthesized datasets.",
                  type: .quickTool, estimatedTime: isZh ? "45 分钟" : "45 MIN", tools: ["Search"]),
            Skill(id: UUID(),
                  name: isZh ? "LBO 建模" : "LBO Modeling",
                  description: isZh ? "包含债务瀑布和五年敏感性分析的完整杠杆收购财务模型。" : "Full layout financial projections including debt waterfalls and sensitivity analysis across 5 years.",
                  type: .deepTask, estimatedTime: isZh ? "8 小时" : "8 HOURS", tools: ["Excel Projection"]),
            Skill(id: UUID(),
                  name: isZh ? "MECE 逻辑检查" : "MECE Logic Check",
                  description: isZh ? "验证问题树是否符合相互独立、完全穷举原则，消除结构重叠。" : "Validate problem trees are Mutually Exclusive and Collectively Exhaustive to ensure no structural overlaps.",
                  type: .quickTool, estimatedTime: isZh ? "30 分钟" : "30 MIN", tools: ["Logic Tree"]),
            Skill(id: UUID(),
                  name: isZh ? "供应链审计" : "Supply Chain Audit",
                  description: isZh ? "全价值链透明度审计、瓶颈识别与物流成本优化建模。" : "Full value chain transparency audit, bottleneck identification, and logistics cost optimization modeling.",
                  type: .deepTask, estimatedTime: isZh ? "6 小时" : "6 HOURS", tools: ["Optimization Deck"]),
            Skill(id: UUID(),
                  name: isZh ? "会议纪要" : "Meeting Minutes",
                  description: isZh ? "自动转录并生成含行动项的结构化会议纪要。" : "Automatic transcription and structured meeting notes with action items.",
                  type: .quickTool, estimatedTime: isZh ? "10 分钟" : "10 MIN", tools: []),
            Skill(id: UUID(),
                  name: isZh ? "PPT 润色" : "PPT Polish",
                  description: isZh ? "优化演示文稿的表达清晰度、视觉一致性与高管汇报冲击力。" : "Refine presentation decks for clarity, visual consistency, and executive impact.",
                  type: .quickTool, estimatedTime: isZh ? "20 分钟" : "20 MIN", tools: []),
            Skill(id: UUID(),
                  name: isZh ? "邮件起草" : "Email Drafts",
                  description: isZh ? "起草专业的面向客户的邮件沟通内容。" : "Draft professional client-facing email communications.",
                  type: .quickTool, estimatedTime: isZh ? "5 分钟" : "5 MIN", tools: [])
        ]
    }

    static func documents(for lang: AppLanguage) -> [KnowledgeDocument] {
        let isZh = lang == .zh
        return [
            KnowledgeDocument(id: UUID(), name: "2023_Financial_Review_v2.pdf", fileType: "PDF",
                              category: isZh ? "历史案例" : "HISTORY CASE",
                              vectorStatus: .synced, vectorProgress: 1.0,
                              date: isZh ? "2023年10月12日" : "Oct 12, 2023"),
            KnowledgeDocument(id: UUID(), name: "Global_Supply_Chain_Trends_2024.docx", fileType: "DOCX",
                              category: isZh ? "行业研究" : "INDUSTRY RESEARCH",
                              vectorStatus: .processing, vectorProgress: 0.64,
                              date: isZh ? "今天 09:42" : "Today, 09:42"),
            KnowledgeDocument(id: UUID(), name: "Market_Cap_Mapping_Asia.xlsx", fileType: "XLSX",
                              category: isZh ? "市场数据" : "MARKET DATA",
                              vectorStatus: .synced, vectorProgress: 1.0,
                              date: isZh ? "2023年10月10日" : "Oct 10, 2023")
        ]
    }

    static func scheduledTasks(for lang: AppLanguage) -> [ScheduledTask] {
        let isZh = lang == .zh
        return [
            ScheduledTask(id: UUID(),
                          name: isZh ? "每周项目报告" : "Weekly Project Report",
                          project: isZh ? "Q4 战略审计" : "Q4 Strategy Audit",
                          frequency: isZh ? "每周一" : "Every Monday",
                          nextRun: isZh ? "5月20日 09:00" : "May 20, 09:00 AM",
                          status: .success, isEnabled: true),
            ScheduledTask(id: UUID(),
                          name: isZh ? "市场情绪分析" : "Market Sentiment Analysis",
                          project: isZh ? "全球金融科技审计" : "Global FinTech Audit",
                          frequency: isZh ? "每天 18:00" : "Daily at 18:00",
                          nextRun: isZh ? "今天 18:00" : "Today, 06:00 PM",
                          status: .success, isEnabled: true),
            ScheduledTask(id: UUID(),
                          name: isZh ? "竞争对手扫描" : "Competitor Scan",
                          project: isZh ? "零售市场扩张" : "Market Retail Expansion",
                          frequency: isZh ? "每月一次" : "Monthly",
                          nextRun: isZh ? "6月1日 00:01" : "Jun 01, 00:01 AM",
                          status: .failed, isEnabled: false),
            ScheduledTask(id: UUID(),
                          name: isZh ? "简报摘要生成" : "Newsletter Summarization",
                          project: isZh ? "全球知识库" : "Global Knowledge Base",
                          frequency: isZh ? "工作日" : "Work Days",
                          nextRun: isZh ? "明天 00:00" : "Tomorrow, 00:00 AM",
                          status: .running, isEnabled: true)
        ]
    }

    static func templates(for lang: AppLanguage) -> [Template] {
        let isZh = lang == .zh
        return [
            Template(id: UUID(),
                     name: isZh ? "精英董事会汇报 2024" : "Elite Board Deck 2024",
                     category: isZh ? "董事会汇报" : "BOARD DECK",
                     tags: [isZh ? "标准" : "STANDARD"],
                     thumbnail: "rectangle.portrait.and.arrow.right",
                     lastModified: isZh ? "3小时前 by Sarah J." : "3h ago by Sarah J.",
                     assignedProject: "Project Aurora", status: isZh ? "活跃" : "ACTIVE"),
            Template(id: UUID(),
                     name: isZh ? "全球市场洞察" : "Global Market Insights",
                     category: isZh ? "市场研究" : "MARKET RESEARCH",
                     tags: [isZh ? "分析型" : "ANALYTICAL"],
                     thumbnail: "chart.bar.doc.horizontal",
                     lastModified: isZh ? "昨天 by Mike R." : "Yesterday by Mike R.",
                     assignedProject: "FY24 Governance", status: nil),
            Template(id: UUID(),
                     name: isZh ? "财富500强视觉规范" : "Fortune 500 Styleguide",
                     category: isZh ? "客户样式" : "CLIENT A STYLE",
                     tags: [isZh ? "标准" : "STANDARD"],
                     thumbnail: "doc.text.image",
                     lastModified: isZh ? "3天前 by AI" : "3 days ago by AI",
                     assignedProject: nil, status: nil),
            Template(id: UUID(),
                     name: isZh ? "投资路演 Deck" : "Investment Pitch Deck",
                     category: isZh ? "金融" : "FINANCE",
                     tags: [isZh ? "行业" : "INDUSTRY"],
                     thumbnail: "chart.line.uptrend.xyaxis.circle",
                     lastModified: isZh ? "1周前" : "1 week ago",
                     assignedProject: nil, status: nil),
            Template(id: UUID(),
                     name: isZh ? "执行摘要框架" : "Executive Summary Frame",
                     category: isZh ? "高管" : "EXECUTIVE",
                     tags: [isZh ? "标准" : "STANDARD"],
                     thumbnail: "text.document",
                     lastModified: isZh ? "2周前" : "2 weeks ago",
                     assignedProject: nil, status: nil)
        ]
    }

    static let chatMessages: [ChatMessage] = [
        ChatMessage(
            id: UUID(),
            role: .user,
            content: "帮我分析一下最近上传的某半导体行业报告，提取关键增长因素。",
            timestamp: Date(),
            attachments: [],
            cards: nil
        ),
        ChatMessage(
            id: UUID(),
            role: .assistant,
            content: "根据您提供的《2024年全球半导体行业趋势与前瞻报告》，我已完成深度扫描。以下是该行业未来 18-24 个月内最具影响力的四个关键增长驱动因素：",
            timestamp: Date(),
            attachments: [],
            cards: [
                InsightCard(id: UUID(), icon: "cpu", title: "生成式 AI 引发的算力革命", body: "大规模语言模型（LLM）的训练与推理需求直接拉动了 High-End GPU 及 HBM3 内存出货量。预计到 2025 年，AI 相关芯片产值将占总行业总量的 35%。"),
                InsightCard(id: UUID(), icon: "car", title: "汽车电子化与智能座舱", body: "随着 L3+ 级自动驾驶的普及，单车半导体价值（BOM）预计将从当前的 $700 跃升至 $1,500 以上，特别是高功率半导体（SiC/GaN）。"),
                InsightCard(id: UUID(), icon: "globe.asia.australia", title: "供应链多元化与本土化布局", body: "全球政经局势推动半导体制造进入「主权芯片时代」，各国激烈的补贴政策（如 Chips Act）正加速成熟工艺与先进制程的同步产能。"),
                InsightCard(id: UUID(), icon: "square.3.layers.3d", title: "Chiplet 工艺与异构集成", body: "在摩尔定律放缓的背景下，通过 2.5D/3D 封装实现的 Chiplet 技术成为降低成本并开拓性能提升的核心路径，带动封装产业链价值跃升。")
            ]
        )
    ]
}
