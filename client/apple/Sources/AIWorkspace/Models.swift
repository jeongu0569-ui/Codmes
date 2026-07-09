import Foundation

struct WorkspaceInfo: Codable {
    struct Root: Codable, Identifiable {
        let id: String
        let name: String
        let path: String
    }

    struct HermesInfo: Codable {
        let serverUrl: String
        let dashboardLoginConfigured: Bool
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
    let hermes: HermesInfo
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

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .chat: "message"
        case .notes: "doc.text"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .search: "magnifyingglass"
        }
    }
}

struct ChatLine: Identifiable {
    let id = UUID()
    let role: String
    var text: String
    var approvalState: ApprovalState?
    var activityItems: [ChatActivity] = []
    var isStreamingActivity = false
}

struct ChatActivity: Identifiable {
    let id = UUID()
    let type: String
    var text: String
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
