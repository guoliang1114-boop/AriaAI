import Foundation
import SwiftUI

// MARK: - Projects

struct APIProject: Codable, Identifiable {
    let id: Int
    var name: String
    var client: String
    var description: String
    var status: String
    var contextFreshness: Double
    var contractAmount: Double
    var contextSummary: String
    var notes: String
    let createdAt: Date
    var updatedAt: Date

    // Note: APIClient uses keyDecodingStrategy = .convertFromSnakeCase
    // So backend's context_summary automatically maps to contextFreshness
}

struct APIMilestone: Codable, Identifiable {
    let id: Int
    let projectId: Int
    var title: String
    var isDone: Bool
    var priority: String
    var dueDate: String?
}

struct APIProjectFolder: Codable, Identifiable {
    let id: Int
    let projectId: Int
    var name: String
    var sortOrder: Int
}

struct APIProjectFile: Codable, Identifiable {
    let id: Int
    let projectId: Int
    var folderId: Int?
    var name: String
    var fileType: String
    var path: String
    var sizeBytes: Int
    var summary: String
    let uploadedAt: Date

    // Note: APIClient uses keyDecodingStrategy = .convertFromSnakeCase

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        projectId = try c.decode(Int.self, forKey: .projectId)
        folderId = try? c.decode(Int.self, forKey: .folderId)
        name = try c.decode(String.self, forKey: .name)
        fileType = try c.decode(String.self, forKey: .fileType)
        path = try c.decode(String.self, forKey: .path)
        sizeBytes = try c.decode(Int.self, forKey: .sizeBytes)
        summary = (try? c.decode(String.self, forKey: .summary)) ?? ""
        uploadedAt = try c.decode(Date.self, forKey: .uploadedAt)
    }
}

struct APIProjectPayment: Codable, Identifiable {
    let id: Int
    let projectId: Int
    var amount: Double
    var paymentDate: String         // YYYY-MM-DD
    var note: String
    var paymentType: String         // received | expense | milestone_payment
    let createdAt: Date
}

struct APIProjectFinancials: Codable {
    var contractAmount: Double
    var totalReceived: Double
    var totalExpense: Double
    var totalInvoiced: Double
    var uncollected: Double     // 已开票未收款
    var remaining: Double
    var payments: [APIProjectPayment]
}

// MARK: - Chat

struct APIConversation: Codable, Identifiable {
    let id: Int
    var title: String
    var projectId: Int?
    var skillId: Int?
    let createdAt: Date
    var updatedAt: Date
}

struct APIMessageMetadata: Codable {
    let skillId: Int?
    let docIds: [Int]?
    let fileIds: [Int]?
    let projectId: Int?
    
    enum CodingKeys: String, CodingKey {
        case skillId = "skill_id"
        case docIds = "doc_ids"
        case fileIds = "file_ids"
        case projectId = "project_id"
    }
}

struct APIMessage: Codable, Identifiable {
    let id: Int
    let conversationId: Int
    let role: String      // "user" | "assistant"
    let content: String
    let metadataJson: String?  // JSON string from backend
    let createdAt: Date
    
    // Note: APIClient uses keyDecodingStrategy = .convertFromSnakeCase
    
    var metadata: APIMessageMetadata? {
        guard let jsonString = metadataJson,
              let data = jsonString.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(APIMessageMetadata.self, from: data)
    }
}

// MARK: - Knowledge

struct APIKnowledgeDocument: Codable, Identifiable {
    let id: Int
    var name: String
    var fileType: String
    var path: String
    var category: String
    var vectorStatus: String   // pending | processing | synced | failed
    var vectorProgress: Double
    var chunkCount: Int
    let uploadedAt: Date
    var clientId: Int?
}

struct APIKnowledgeStats: Codable {
    let documentCount: Int
    let totalVectors: Int
}

// MARK: - Skills

struct APISkill: Codable, Identifiable {
    let id: Int
    var name: String
    var category: String
    var description: String
    var systemPrompt: String
    var userTemplate: String
    var estimatedTime: String
    var toolsJson: String

    var tools: [String] {
        (try? JSONDecoder().decode([String].self, from: Data(toolsJson.utf8))) ?? []
    }
}

// MARK: - Schedules

struct APIScheduledTask: Codable, Identifiable {
    let id: Int
    var name: String
    var projectId: Int?
    var skillId: Int?
    var prompt: String
    var frequency: String
    var cronExpr: String
    var isEnabled: Bool
    var status: String
    var lastRun: Date?
    var nextRun: Date?
    let createdAt: Date
}

// MARK: - Templates

struct APITemplate: Codable, Identifiable {
    let id: Int
    var name: String
    var category: String
    var fileType: String
    var path: String
    var tagsJson: String
    var status: String?
    let uploadedAt: Date

    var tags: [String] {
        (try? JSONDecoder().decode([String].self, from: Data(tagsJson.utf8))) ?? []
    }
}

// MARK: - Project AI Suggest

struct APIProjectSuggestion: Codable {
    var name: String
    var description: String
}

// MARK: - Clients

struct APIClientSuggestion: Codable {
    var name: String
    var industry: String
    var contact: String
    var notes: String
}

struct APIClientRecord: Codable, Identifiable {
    let id: Int
    var name: String
    var industry: String
    var contact: String
    var notes: String
    let createdAt: String
    var documentCount: Int
    var projectNames: [String]
}

// MARK: - Settings

struct APIKeyStatus: Codable {
    let configured: Bool
    var masked: String?
}

// MARK: - Conversion helpers — API → local SwiftUI models

extension APIProject {
    func toLocal() -> Project {
        let s: Project.ProjectStatus = {
            switch status {
            case "lead":        return .lead
            case "opportunity":  return .opportunity
            case "won":          return .won
            case "delivering":   return .delivering
            case "archived":     return .archived
            // backward compat with old status values
            case "active":       return .delivering
            case "on_hold":      return .won
            default:             return .delivering
            }
        }()
        let startYear = Calendar.current.component(.year, from: createdAt)
        let period = status == "active" ? "\(startYear) – Present" : "\(startYear)"
        return Project(
            id: UUID(),
            name: name,
            client: client,
            type: "–",
            period: period,
            status: s,
            contextFreshness: contextFreshness,
            filesCount: 0,
            taskType: .deepTask,
            contextSummary: [],
            milestones: [],
            files: []
        )
    }
}

extension APIMessage {
    func toLocal() -> ChatMessage {
        var attachments: [ChatAttachment] = []
        
        // Convert metadata references to attachments for display
        if let meta = metadata {
            if let skillId = meta.skillId {
                attachments.append(.skill(skillId))
            }
            if let docIds = meta.docIds {
                for docId in docIds {
                    attachments.append(.document(docId))
                }
            }
            if let fileIds = meta.fileIds {
                for fileId in fileIds {
                    attachments.append(.file(fileId))
                }
            }
        }
        
        return ChatMessage(
            id: UUID(),
            role: role == "user" ? .user : .assistant,
            content: content,
            timestamp: createdAt,
            attachments: attachments,
            cards: nil
        )
    }
}

// Helper for parsing metadata from JSON string
extension APIMessageMetadata {
    init?(from jsonString: String) {
        guard let data = jsonString.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        self.skillId = dict["skill_id"] as? Int
        self.docIds = dict["doc_ids"] as? [Int]
        self.fileIds = dict["file_ids"] as? [Int]
        self.projectId = dict["project_id"] as? Int
    }
}

extension APIMilestone {
    func toLocal() -> Milestone {
        Milestone(
            id: UUID(),
            title: title,
            isCompleted: isDone,
            date: dueDate ?? "–",
            isPriority: priority == "high"
        )
    }
}

extension APIProjectFile {
    func toLocal() -> ProjectFile {
        let ft: ProjectFile.FileType = {
            switch fileType.lowercased() {
            case "pdf": return .pdf
            case "xlsx", "xls": return .xlsx
            case "pptx", "ppt": return .pptx
            default: return .docx
            }
        }()
        let kb = sizeBytes / 1024
        let size = kb > 1024 ? "\(kb / 1024) MB" : "\(kb) KB"
        return ProjectFile(id: UUID(), name: name, type: ft, size: size)
    }
}

extension APIScheduledTask {
    func toLocal(projectName: String? = nil) -> ScheduledTask {
        let ts: ScheduledTask.TaskStatus = {
            switch status {
            case "success": return .success
            case "failed": return .failed
            case "running": return .running
            default: return .scheduled
            }
        }()
        let nextRunStr: String = {
            guard let d = nextRun else { return "–" }
            let f = DateFormatter()
            f.dateStyle = .short
            f.timeStyle = .short
            return f.string(from: d)
        }()
        return ScheduledTask(
            id: UUID(),
            apiId: self.id,
            name: name,
            project: projectName ?? "–",
            frequency: frequency,
            nextRun: nextRunStr,
            status: ts,
            isEnabled: isEnabled
        )
    }
}

extension APIKnowledgeDocument {
    func toLocal() -> KnowledgeDocument {
        let vs: KnowledgeDocument.VectorStatus = {
            switch vectorStatus {
            case "synced": return .synced
            case "processing": return .processing
            default: return .failed
            }
        }()
        let f = DateFormatter()
        f.dateStyle = .medium
        return KnowledgeDocument(
            id: UUID(),
            name: name,
            fileType: fileType.uppercased(),
            category: category,
            vectorStatus: vs,
            vectorProgress: vectorProgress,
            date: f.string(from: uploadedAt)
        )
    }
}

extension APISkill {
    /// Client-side localization lookup.
    /// DEFAULT_SKILLS are stored in English → zh lookup gives Chinese.
    /// GSTACK_PRO_SKILLS are stored in Chinese → en lookup gives English.
    func localizedName(for lang: AppLanguage) -> String {
        if lang == .zh {
            return APISkill.zhNames[name] ?? name
        } else {
            return APISkill.enNames[name] ?? name
        }
    }

    func localizedDescription(for lang: AppLanguage) -> String {
        if lang == .zh {
            return APISkill.zhDescriptions[name] ?? description
        } else {
            return APISkill.enDescriptions[name] ?? description
        }
    }

    func localizedEstimatedTime(for lang: AppLanguage) -> String {
        if lang == .zh {
            return APISkill.zhTimes[estimatedTime] ?? estimatedTime
        } else {
            return APISkill.enTimes[estimatedTime] ?? estimatedTime
        }
    }

    func localizedTools(for lang: AppLanguage) -> [String] {
        if lang == .zh {
            return tools.map { APISkill.zhTools[$0] ?? $0 }
        } else {
            return tools.map { APISkill.enTools[$0] ?? $0 }
        }
    }

    private static let zhNames: [String: String] = [
        // DEFAULT_SKILLS (quick_tool)
        "Executive Summary":   "执行摘要",
        "Market Sizing":       "市场规模测算",
        "Competitor Intel":    "竞争情报扫描",
        // DEFAULT_SKILLS (deep_task)
        "Full Due Diligence":  "完整尽职调查",
        "Strategic Roadmap":   "战略路线图",
        "Client Report Draft": "客户报告起草",
    ]

    private static let zhDescriptions: [String: String] = [
        "Executive Summary":   "将复杂材料提炼为结构清晰的高管摘要，突出关键结论与行动建议。",
        "Market Sizing":       "通过自上而下与自下而上两种路径测算市场规模，生成 TAM/SAM/SOM 数据。",
        "Competitor Intel":    "扫描竞争对手动态、产品矩阵与市场定位，输出竞争格局简报。",
        "Full Due Diligence":  "覆盖市场、财务、运营、团队四大维度的完整尽调报告，含风险与机会评估。",
        "Strategic Roadmap":   "结合现状诊断与战略目标，规划分阶段的战略执行路线图与优先级矩阵。",
        "Client Report Draft": "基于项目背景与分析结论，起草符合咨询行业标准的客户正式报告。",
    ]

    private static let zhTimes: [String: String] = [
        "~2 min":  "约 2 分钟",
        "~3 min":  "约 3 分钟",
        "~5 min":  "约 5 分钟",
        "~10 min": "约 10 分钟",
        "~15 min": "约 15 分钟",
        "~20 min": "约 20 分钟",
        "~25 min": "约 25 分钟",
        "~30 min": "约 30 分钟",
        "~45 min": "约 45 分钟",
        "~1 hour": "约 1 小时",
        "~2 hours":"约 2 小时",
    ]

    private static let zhTools: [String: String] = [
        "summarize":  "摘要",
        "structure":  "结构化",
        "research":   "调研",
        "calculate":  "计算",
        "compare":    "对比",
        "analyze":    "分析",
        "model":      "建模",
        "report":     "报告",
        "plan":       "规划",
        "timeline":   "时间线",
        "write":      "撰写",
        "pptx":       "PPT",
    ]

    // English translations for skills stored in Chinese in the DB (GSTACK_PRO_SKILLS)
    private static let enNames: [String: String] = [
        "根因分析": "Root Cause Analysis",
        "提案挑战": "Proposal Challenge",
        "项目启动": "Project Kickoff",
        "项目复盘": "Project Retrospective",
        "交付审查": "Delivery Review",
    ]

    private static let enDescriptions: [String: String] = [
        "根因分析": "AI proactively probes causes layer by layer — investigate, analyze, hypothesize, and recommend.",
        "提案挑战": "Stress-test your proposal's premises, check completeness, and generate three alternative versions.",
        "项目启动": "Six structured questions to align goals, then auto-generate a project brief.",
        "项目复盘": "Five-dimension retrospective analysis to extract learnings and build institutional knowledge.",
        "交付审查": "Five-point quality checklist, scoring, and targeted revision suggestions for your deliverable.",
    ]

    private static let enTimes: [String: String] = [
        // Chinese time strings from GSTACK_PRO_SKILLS → English
        "约 20 分钟": "~20 min",
        "约 15 分钟": "~15 min",
        "约 10 分钟": "~10 min",
        "约 30 分钟": "~30 min",
        "约 25 分钟": "~25 min",
        "20分钟":    "~20 min",
        "15分钟":    "~15 min",
        "10分钟":    "~10 min",
        "30分钟":    "~30 min",
    ]

    private static let enTools: [String: String] = [
        // Chinese tool names → English (for GSTACK_PRO_SKILLS tools stored in Chinese)
        "摘要":   "Summarize",
        "结构化": "Structure",
        "调研":   "Research",
        "计算":   "Calculate",
        "对比":   "Compare",
        "分析":   "Analyze",
        "建模":   "Model",
        "报告":   "Report",
        "规划":   "Plan",
        "时间线": "Timeline",
        "撰写":   "Write",
    ]

    func toLocal() -> Skill {
        return Skill(
            id: UUID(),
            apiId: self.id,
            name: name,
            description: description,
            type: .quickTool,
            category: category,
            estimatedTime: estimatedTime,
            tools: tools
        )
    }
}

extension APIClientRecord {
    func toLocal() -> ClientRecord {
        ClientRecord(
            id: UUID(),
            apiId: self.id,
            name: name,
            industry: industry,
            contact: contact,
            notes: notes,
            documentCount: documentCount,
            projectNames: projectNames
        )
    }
}

extension APITemplate {
    func toLocal() -> Template {
        let df = DateFormatter()
        df.dateStyle = .medium
        df.timeStyle = .none
        return Template(
            id: UUID(),
            apiId: self.id,
            name: name,
            category: category,
            tags: tags,
            thumbnail: fileType == "pptx" ? "play.rectangle.fill" : "doc.text.fill",
            lastModified: df.string(from: uploadedAt),
            assignedProject: nil,
            status: status
        )
    }
}
