import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: WorkspaceStore
    @State private var selection: WorkspaceSection? = .chat

    var body: some View {
        NavigationSplitView {
            List(WorkspaceSection.allCases, selection: $selection) { section in
                Label(section.rawValue, systemImage: section.systemImage)
                    .tag(section)
            }
            .navigationTitle("Workspace")
            .safeAreaInset(edge: .bottom) {
                ServerStatusView()
                    .padding(12)
            }
        } detail: {
            switch selection ?? .chat {
            case .chat:
                ChatHomeView()
            case .notes:
                FileSectionView(title: "Notes", root: "notes")
            case .code:
                FileSectionView(title: "Code", root: "code")
            case .search:
                SearchView()
            }
        }
        .frame(minWidth: 980, minHeight: 640)
    }
}

struct ServerStatusView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Workspace Server", text: $store.serverURLText)
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    store.saveServerURL()
                    Task { await store.refreshWorkspace() }
                }
            HStack {
                Circle()
                    .fill(store.statusMessage == "Connected" ? .green : .orange)
                    .frame(width: 8, height: 8)
                Text(store.statusMessage)
                    .font(.caption)
                    .lineLimit(2)
                Spacer()
                Button {
                    store.saveServerURL()
                    Task { await store.refreshWorkspace() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
            }
        }
    }
}
