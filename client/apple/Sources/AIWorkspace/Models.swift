import Foundation

struct WorkspaceInfo: Codable {
    struct Root: Codable, Identifiable {
        let id: String
        let name: String
        let path: String
    }

    struct LegacyHermesInfo: Codable {
        let serverUrl: String
        let dashboardLoginConfigured: Bool
    }

    struct RuntimeInfo: Codable {
        let status: String
        let owner: String?
        let configPath: String?
    }

    struct SearchInfo: Codable {
        let provider: String
        let available: Bool
        let indexed: Bool
        let realtimeIndexing: Bool
        let description: String
        let searchableExtensions: [String]
    }

    let rootName: String
    let workspaceRoot: String
    let roots: [Root]
    let runtime: RuntimeInfo?
    let hermes: LegacyHermesInfo?
    let search: SearchInfo?
}

struct TreeResponse: Codable {
    let path: String
    let children: [WorkspaceItem]
}

struct WorkspaceItem: Codable, Identifiable, Hashable {
    var id: String { path }
    let name: String
    let path: String
    let kind: String
    let isDirectory: Bool
    let size: Int
    let modifiedAt: String
}

struct FileResponse: Codable {
    let path: String
    let name: String
    let kind: String
    let size: Int
    let modifiedAt: String
    var content: String
}

struct RawFilePreview: Identifiable {
    var id: String { path }
    let path: String
    let name: String
    let kind: String
    let url: URL
}

enum UploadStatus: String, Codable {
    case reading
    case uploading
    case completed
    case failed
    case cancelled

    var label: String {
        switch self {
        case .reading: "Reading"
        case .uploading: "Uploading"
        case .completed: "Done"
        case .failed: "Failed"
        case .cancelled: "Cancelled"
        }
    }

    var systemImage: String {
        switch self {
        case .reading: "doc"
        case .uploading: "arrow.up.circle"
        case .completed: "checkmark.circle"
        case .failed: "exclamationmark.triangle"
        case .cancelled: "xmark.circle"
        }
    }
}

struct UploadItem: Identifiable, Hashable {
    let id: UUID
    let root: String
    let fileName: String
    let destinationPath: String
    var status: UploadStatus
    var progress: Double
    var bytesSent: Int64
    var totalBytes: Int64
    var message: String

    var isActive: Bool {
        status == .reading || status == .uploading
    }
}

struct UploadStartResponse: Codable {
    let ok: Bool
    let uploadId: String
    let path: String
    let received: Int64
}

struct UploadChunkResponse: Codable {
    let ok: Bool
    let uploadId: String
    let received: Int64
    let size: Int64
}

struct SearchResponse: Codable {
    struct Result: Codable, Identifiable {
        var id: String { path }
        let path: String
        let kind: String
        let size: Int
        let modifiedAt: String
        let score: Double
        let snippet: String
    }

    let provider: String
    let query: String
    let scopePath: String
    let totalCandidates: Int
    let resultCount: Int
    let results: [Result]
}

struct AgentTasksResponse: Codable {
    let tasks: [AgentTaskSummary]
}

struct AgentTaskSummary: Codable, Identifiable, Hashable {
    let id: String
    let type: String?
    let status: String?
    let createdAt: String?
    let updatedAt: String?
    let runtime: String?
    let sessionId: String?
    let scopePath: String?
    let message: String?
    let summary: String?
    let approvalIds: [String]?
    let hasPendingState: Bool?
    let error: String?
}

struct AgentTaskActionResponse: Codable {
    let ok: Bool?
    let engine: String?
    let runtime: String?
    let status: String?
    let task: AgentTaskSummary?
    let alreadyResolved: Bool?
}

struct CodeTaskRecord: Codable, Identifiable {
    struct Plan: Codable {
        struct Step: Codable, Identifiable {
            var id: String { title }
            let title: String
            let status: String?
            let detail: String?
        }

        let summary: String?
        let instruction: String?
        let steps: [Step]?
        let risks: [String]?
    }

    struct GitInfo: Codable {
        let isRepository: Bool?
        let root: String?
        let status: String?
        let diffStat: String?
        let diffRef: String?
    }

    let id: String
    let type: String?
    let status: String?
    let createdAt: String?
    let updatedAt: String?
    let message: String?
    let scopePath: String?
    let plan: Plan?
    let git: GitInfo?
    let taskMemory: CodeTaskMemory?
    let patchProposals: [CodePatchProposal]?
    let checks: [CodeCheckRun]?
    let filesChanged: [String]?
}

struct CodeTaskMemory: Codable, Hashable {
    let readFiles: [String]
    let proposedFiles: [String]
    let changedFiles: [String]
    let commands: [String]
    let checkResults: [CodeCheckSummary]
    let failureLogs: [CodeFailureLog]
    let nextSteps: [String]
    let notes: [String]
}

struct CodeCheckSummary: Codable, Hashable, Identifiable {
    let id: String
    let allPassed: Bool?
    let finishedAt: String?
    let results: [CodeCheckCommandSummary]?
}

struct CodeCheckRun: Codable, Hashable, Identifiable {
    let id: String
    let approved: Bool?
    let startedAt: String?
    let finishedAt: String?
    let scopePath: String?
    let commands: [String]?
    let allPassed: Bool?
    let results: [CodeCheckCommandResult]?
}

struct CodeCheckCommandResult: Codable, Hashable {
    let command: String?
    let ok: Bool?
    let exitCode: Int?
    let signal: String?
    let durationMs: Int?
    let stdout: String?
    let stderr: String?
}

struct CodeCheckCommandSummary: Codable, Hashable {
    let command: String?
    let ok: Bool?
    let exitCode: Int?
    let durationMs: Int?
}

struct CodeFailureLog: Codable, Hashable {
    let command: String?
    let exitCode: Int?
    let stderr: String?
    let stdout: String?
}

struct CodePatchProposal: Codable, Hashable, Identifiable {
    struct Change: Codable, Hashable, Identifiable {
        var id: String { path }
        let operation: String?
        let path: String
        let existed: Bool?
        let oldHash: String?
        let newHash: String?
        let oldSize: Int?
        let newSize: Int?
    }

    let id: String
    let status: String?
    let approved: Bool?
    let createdAt: String?
    let appliedAt: String?
    let rejectedAt: String?
    let rejectionReason: String?
    let scopePath: String?
    let summary: String?
    let diffRef: String?
    let changes: [Change]?
    let filesChanged: [String]?
}

struct CodeTaskResponse: Codable {
    let ok: Bool
    let engine: String?
    let runtime: String?
    let taskId: String
    let status: String?
    let scopePath: String?
    let summary: String?
    let plan: CodeTaskRecord.Plan?
    let git: CodeTaskRecord.GitInfo?
    let taskMemory: CodeTaskMemory?
}

struct CodePatchApplyResponse: Codable {
    let ok: Bool
    let engine: String?
    let runtime: String?
    let taskId: String
    let status: String?
    let scopePath: String?
    let proposalId: String?
    let filesChanged: [String]?
    let git: CodeTaskRecord.GitInfo?
    let taskMemory: CodeTaskMemory?
    let checkRun: CodeCheckRun?
    let checkApprovalRequired: Bool?
}

struct CodePatchRejectResponse: Codable {
    let ok: Bool
    let engine: String?
    let runtime: String?
    let taskId: String
    let status: String?
    let scopePath: String?
    let proposalId: String?
    let taskMemory: CodeTaskMemory?
}

struct CodeChecksResponse: Codable {
    let ok: Bool
    let engine: String?
    let runtime: String?
    let taskId: String
    let status: String?
    let scopePath: String?
    let taskMemory: CodeTaskMemory?
}

struct RenderedMarkdownResponse: Codable {
    let html: String
}

struct HealthResponse: Codable {
    let ok: Bool
    let service: String
}

struct HermesModelOption: Identifiable, Hashable {
    var id: String { provider.map { "\($0):\(model)" } ?? model }
    let label: String
    let provider: String?
    let model: String

    var shortLabel: String {
        let value = model
            .split(separator: "/")
            .last
            .map(String.init) ?? model
        guard value.count > 14 else { return value }
        return String(value.prefix(11)) + "..."
    }
}

struct RuntimeProvidersResponse: Codable {
    let providers: [RuntimeProviderOption]
}

struct RuntimeProviderOption: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let authType: String
    let tab: String?
    let env: [String]?
    let baseUrlEnv: String?
    let defaultBaseUrl: String?
    let models: [String]?
    let configured: Bool?
    let isDefault: Bool?

    var needsAPIKey: Bool { authType == "api_key" }
    var isOAuth: Bool { authType.hasPrefix("oauth") }
    var isLocalOllama: Bool { id == "ollama-local" }
    var isLocalProvider: Bool { tab == "local" || authType == "none" || isLocalOllama }
    var sectionTitle: String {
        if isLocalProvider { return "Local" }
        if isOAuth || authType == "external_process" { return "Accounts" }
        return "API Keys"
    }
    var setupHint: String {
        if isLocalOllama { return "Uses the Workspace Server's local Ollama endpoint." }
        if isOAuth { return "Account sign-in is managed by the Codmes Server runtime." }
        if needsAPIKey { return "Stores an API key in the server runtime config." }
        return "No API key is required."
    }
}

struct RuntimeProviderModelsResponse: Codable {
    let provider: String
    let source: String
    let baseUrl: String?
    let models: [String]
}

struct WorkspaceApprovalsResponse: Codable {
    let approvals: [WorkspaceApproval]
}

struct WorkspaceApproval: Codable, Identifiable, Hashable {
    let id: String
    let type: String?
    let status: String?
    let category: String?
    let createdAt: String?
    let updatedAt: String?
    let respondedAt: String?
    let taskId: String?
    let proposalId: String?
    let scopePath: String?
    let summary: String?
    let diffRef: String?
    let commands: [String]?
    let reason: String?
    let hasPendingState: Bool?
}

struct WorkspaceApprovalRespondResponse: Codable {
    let ok: Bool?
    let engine: String?
    let runtime: String?
    let status: String?
    let approval: WorkspaceApproval?
    let result: AgentTaskActionResponse?
}

struct HermesSessionSummary: Identifiable, Hashable {
    let id: String
    let title: String
    let updatedAt: String?
    let projectId: String?
    let projectTitle: String?
}

struct HermesSessionProject: Identifiable, Hashable {
    let id: String
    let title: String
    let sessionCount: Int
}

struct MarkdownTable: Identifiable {
    let id = UUID()
    let rows: [[String]]
}

enum MarkdownBlock: Identifiable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bullet(String)
    case ordered(index: Int, text: String)
    case task(checked: Bool, text: String)
    case quote(String)
    case horizontalRule
    case code(language: String?, text: String)
    case table(MarkdownTable)

    var id: UUID { UUID() }
}

struct HermesSessionMessagesResponse: Codable {
    let sessionId: String?
    let messages: [HermesSessionMessage]
}

struct HermesSessionMessage: Codable, Identifiable, Hashable {
    let id: String
    let role: String
    let content: String
    let timestamp: String?
    let toolName: String?
    let finishReason: String?
    let reasoning: String?
}

enum WorkspaceSection: String, CaseIterable, Identifiable {
    case chat = "Chat"
    case notes = "Notes"
    case code = "Code"
    case search = "Search"
    case approvals = "Approvals"

    var id: String { rawValue }

    var runtimeSurfaceId: String {
        switch self {
        case .chat: "chat"
        case .notes: "notes"
        case .code: "code"
        case .search, .approvals: "chat"
        }
    }

    var systemImage: String {
        switch self {
        case .chat: "message"
        case .notes: "doc.text"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .search: "magnifyingglass"
        case .approvals: "checkmark.seal"
        }
    }
}

struct ChatLine: Identifiable, Equatable {
    let id: UUID
    let role: String
    var text: String
    var approvalState: ApprovalState?
    var activityItems: [ChatActivity]
    var isStreamingActivity: Bool

    init(id: UUID = UUID(), role: String, text: String, approvalState: ApprovalState? = nil, activityItems: [ChatActivity] = [], isStreamingActivity: Bool = false) {
        self.id = id
        self.role = role
        self.text = text
        self.approvalState = approvalState
        self.activityItems = activityItems
        self.isStreamingActivity = isStreamingActivity
    }

    static func == (lhs: ChatLine, rhs: ChatLine) -> Bool {
        lhs.id == rhs.id &&
        lhs.role == rhs.role &&
        lhs.text == rhs.text &&
        lhs.approvalState == rhs.approvalState &&
        lhs.activityItems == rhs.activityItems &&
        lhs.isStreamingActivity == rhs.isStreamingActivity
    }
}

struct ChatActivity: Identifiable, Equatable {
    let id: UUID
    let type: String
    var text: String

    init(id: UUID = UUID(), type: String, text: String) {
        self.id = id
        self.type = type
        self.text = text
    }

    static func == (lhs: ChatActivity, rhs: ChatActivity) -> Bool {
        lhs.id == rhs.id &&
        lhs.type == rhs.type &&
        lhs.text == rhs.text
    }
}

enum ApprovalState: String {
    case pending
    case approved
    case denied
}

enum ChatAccessMode: String, CaseIterable, Identifiable {
    case confirm
    case full

    var id: String { rawValue }

    var label: String {
        switch self {
        case .confirm: "Safe"
        case .full: "Full"
        }
    }
}

enum ChatReasoningMode: String, CaseIterable, Identifiable {
    case swift
    case balanced
    case deep

    var id: String { rawValue }

    var label: String {
        switch self {
        case .swift: "Fast"
        case .balanced: "Med"
        case .deep: "Deep"
        }
    }

    var effort: String {
        switch self {
        case .swift: "low"
        case .balanced: "medium"
        case .deep: "high"
        }
    }
}

enum ChatContextScope: String, CaseIterable, Identifiable {
    case none = "none"
    case currentFile = "current-file"
    case currentFolder = "current-folder"
    case workspace = "workspace"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .none: "No context"
        case .currentFile: "Current file"
        case .currentFolder: "Current folder"
        case .workspace: "Workspace"
        }
    }

    var systemImage: String {
        switch self {
        case .none: "slash.circle"
        case .currentFile: "doc.text"
        case .currentFolder: "folder"
        case .workspace: "externaldrive"
        }
    }
}
