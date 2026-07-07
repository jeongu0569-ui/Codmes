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
    let content: String
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
}
