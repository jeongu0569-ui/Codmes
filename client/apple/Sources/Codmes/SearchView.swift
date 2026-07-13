import SwiftUI

struct SearchView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var query = ""
    @State private var scopePath = "Notes"

    var body: some View {
        VStack(spacing: 0) {
            HeaderView(title: "Search", subtitle: store.workspace?.search?.description ?? "Workspace search")
            HStack(spacing: 10) {
                TextField("Search query", text: $query)
                    .textFieldStyle(.roundedBorder)
                TextField("Scope", text: $scopePath)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 220)
                Button("Search") {
                    Task { await store.runSearch(query: query, scopePath: scopePath) }
                }
                .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(16)
            .background(.quaternary.opacity(0.10))
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(.quaternary.opacity(0.35))
                    .frame(height: 1)
            }
            List(store.searchResponse?.results ?? []) { result in
                Button {
                    Task { await store.openSearchResult(result) }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(result.path)
                                .font(.headline)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer()
                            HStack(spacing: 6) {
                                if let page = result.page {
                                    Text("p. \(page)")
                                }
                                Text(result.kind)
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        Text(result.snippet)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                        if result.bbox != nil || result.source != nil {
                            HStack(spacing: 8) {
                                if let source = result.source {
                                    Label(source, systemImage: "scope")
                                }
                                if result.bbox != nil {
                                    Label("position", systemImage: "viewfinder")
                                }
                            }
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                        }
                    }
                    .contentShape(Rectangle())
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
