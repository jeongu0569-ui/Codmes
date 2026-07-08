import SwiftUI
import PDFKit

struct FileSectionView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let title: String
    let root: String

    var body: some View {
        #if os(macOS)
        HSplitView {
            FileBrowserPane(title: title, root: root)
                .frame(minWidth: 0, idealWidth: 280)

            FilePreviewView()
                .frame(minWidth: 0)
        }
        #else
        VStack(spacing: 0) {
            FileBrowserPane(title: title, root: root)
                .frame(maxHeight: 320)
            Divider()
            FilePreviewView()
        }
        #endif
    }
}

struct FileBrowserPane: View {
    @EnvironmentObject private var store: WorkspaceStore
    let title: String
    let root: String

    var body: some View {
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
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Text(item.path)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
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
            if let rawFile = store.selectedRawFile {
                HeaderView(title: rawFile.name, subtitle: rawFile.path)
                if rawFile.kind == "pdf" {
                    PDFPreviewView(url: rawFile.url)
                } else if rawFile.kind == "image" {
                    AsyncImage(url: rawFile.url) { phase in
                        switch phase {
                        case let .success(image):
                            image
                                .resizable()
                                .scaledToFit()
                                .padding(20)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        case let .failure(error):
                            ContentUnavailableView("Could not load image", systemImage: "photo", description: Text(error.localizedDescription))
                        case .empty:
                            ProgressView()
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        @unknown default:
                            EmptyView()
                        }
                    }
                } else {
                    ContentUnavailableView("Raw preview unavailable", systemImage: "doc", description: Text(rawFile.path))
                }
            } else if let file = store.selectedFile {
                HeaderView(title: file.name, subtitle: file.path)
                HStack(spacing: 12) {
                    if store.isEditingFile {
                        Button {
                            Task { await store.saveSelectedFile() }
                        } label: {
                            Label("Save", systemImage: "square.and.arrow.down")
                        }
                        .buttonStyle(.borderless)
                        .disabled(!store.selectedFileIsDirty)

                        Button {
                            store.cancelEditingSelectedFile()
                        } label: {
                            Label("Cancel", systemImage: "xmark.circle")
                        }
                        .buttonStyle(.borderless)
                    } else {
                        Button {
                            store.startEditingSelectedFile()
                        } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                        .buttonStyle(.borderless)
                        .disabled(!store.selectedFileCanEdit)
                    }

                    if store.selectedFileIsDirty {
                        Label("Unsaved changes", systemImage: "circle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }

                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)

                if store.isEditingFile {
                    TextEditor(text: $store.editorText)
                        .font(.system(.body, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .padding(16)
                } else {
                    ScrollView {
                        if file.kind == "markdown" {
                            RichMarkdownView(markdown: file.content)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(20)
                        } else if file.kind == "code" {
                            CodeBlockView(language: languageForPath(file.path), code: file.content)
                                .padding(20)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            Text(file.content)
                                .font(.system(.body, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(20)
                        }
                    }
                }
            } else {
                ContentUnavailableView("Select a file", systemImage: "doc.text.magnifyingglass", description: Text("Open a markdown or text file from the tree."))
            }
        }
    }
}

private func languageForPath(_ path: String) -> String? {
    let lower = path.lowercased()
    let name = URL(fileURLWithPath: lower).lastPathComponent
    if name == "dockerfile" { return "dockerfile" }
    if name == "makefile" { return "makefile" }

    switch URL(fileURLWithPath: lower).pathExtension {
    case "py", "pyw": return "python"
    case "js", "mjs", "cjs": return "javascript"
    case "ts", "tsx": return "typescript"
    case "jsx": return "jsx"
    case "swift": return "swift"
    case "java": return "java"
    case "c", "h": return "c"
    case "cc", "cpp", "cxx", "hpp", "hh", "hxx": return "cpp"
    case "cs": return "csharp"
    case "kt", "kts": return "kotlin"
    case "rs": return "rust"
    case "go": return "go"
    case "rb": return "ruby"
    case "php": return "php"
    case "sh", "bash", "zsh": return "bash"
    case "sql": return "sql"
    case "json": return "json"
    case "yml", "yaml": return "yaml"
    case "html", "htm": return "html"
    case "css": return "css"
    case "md", "markdown": return "markdown"
    case "xml": return "xml"
    default: return nil
    }
}

#if os(macOS)
struct PDFPreviewView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .clear
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        view.document = PDFDocument(url: url)
    }
}
#endif

#if os(iOS)
struct PDFPreviewView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {
        view.document = PDFDocument(url: url)
    }
}
#endif
