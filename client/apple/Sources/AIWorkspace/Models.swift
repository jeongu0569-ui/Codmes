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

struct HermesModelOption: Identifiable, Hashable {
    var id: String { provider.map { "\($0):\(model)" } ?? model }
    let label: String
    let provider: String?
    let model: String
}

struct HermesSessionSummary: Identifiable, Hashable {
    let id: String
    let title: String
    let updatedAt: String?
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
