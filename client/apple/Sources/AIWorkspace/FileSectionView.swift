import SwiftUI

struct FileSectionView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let title: String
    let root: String

    var body: some View {
        HSplitView {
            VStack(spacing: 0) {
                HeaderView(title: title, subtitle: store.sectionSubtitle(root: root))
                HStack(spacing: 12) {
                    Button {
                        Task { await store.goToParent(root: root) }
                    } label: {
                        Image(systemName: "chevron.up")
                    }
                    .buttonStyle(.borderless)
                    .disabled(store.currentPath(for: root).isEmpty)
                    .help("Go to parent folder")

                    Button {
                        Task { await store.goToRoot(root: root) }
                    } label: {
                        Image(systemName: "house")
                    }
                    .buttonStyle(.borderless)
                    .disabled(store.currentPath(for: root).isEmpty)
                    .help("Go to root folder")

                    Text(store.currentPath(for: root).isEmpty ? "/" : store.currentPath(for: root))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)

                List(store.items(for: root)) { item in
                    Button {
                        Task {
                            if item.isDirectory {
                                await store.openFolder(root: root, item: item)
                            } else {
                                await store.loadFile(item)
                            }
                        }
                    } label: {
                        HStack {
                            Image(systemName: icon(for: item))
                                .foregroundStyle(item.isDirectory ? .blue : .secondary)
                            VStack(alignment: .leading) {
                                Text(item.name)
                                Text(item.path)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if item.isDirectory {
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(minWidth: 280, idealWidth: 340)

            FilePreviewView()
                .frame(minWidth: 480)
        }
    }

    private func icon(for item: WorkspaceItem) -> String {
        if item.isDirectory { return "folder" }
        switch item.kind {
        case "markdown": return "doc.text"
        case "pdf": return "doc.richtext"
        case "image": return "photo"
        case "code": return "curlybraces"
        default: return "doc"
        }
    }
}

struct FilePreviewView: View {
    @EnvironmentObject private var store: WorkspaceStore

    var body: some View {
        VStack(spacing: 0) {
            if let file = store.selectedFile {
                HeaderView(title: file.name, subtitle: file.path)
                ScrollView {
                    Text(file.content)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(20)
                }
            } else {
                ContentUnavailableView("Select a file", systemImage: "doc.text.magnifyingglass", description: Text("Open a markdown or text file from the tree."))
            }
        }
    }
}
