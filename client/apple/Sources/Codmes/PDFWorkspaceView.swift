import SwiftUI
import PDFKit
import UniformTypeIdentifiers

#if os(iOS)
import PencilKit
import UIKit
#endif

#if os(macOS)
import AppKit
#endif

#if os(iOS)
fileprivate enum PDFMarkupTool: String, CaseIterable, Identifiable {
    case pen
    case eraser
    case lasso

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .pen: "pencil.tip"
        case .eraser: "eraser"
        case .lasso: "lasso"
        }
    }

    var label: String {
        switch self {
        case .pen: "Pen"
        case .eraser: "Erase"
        case .lasso: "Lasso"
        }
    }
}

fileprivate enum PDFLayerAction {
    case backward
    case forward
    case back
    case front
}

fileprivate struct PDFLassoSelectionSummary: Equatable {
    var pageIndex: Int
    var strokeIds: Set<String>
    var objectIds: Set<String>
    var optionAnchor: CGPoint?
    var isMoving: Bool
}

fileprivate struct PDFExportShare: Identifiable {
    let id = UUID()
    let urls: [URL]
}
#endif

#if os(macOS)
fileprivate enum MacPDFMarkupTool: String, CaseIterable, Identifiable {
    case pen
    case eraser
    case select

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .pen: "pencil.tip"
        case .eraser: "eraser"
        case .select: "hand.draw"
        }
    }

    var label: String {
        switch self {
        case .pen: "Pen"
        case .eraser: "Erase"
        case .select: "Move"
        }
    }
}

fileprivate enum MacPDFObjectInteraction {
    case move
    case resize
}
#endif

struct PDFWorkspaceView: View {
    @EnvironmentObject private var store: WorkspaceStore
    let rawFile: RawFilePreview
    @State private var annotations: PDFAnnotationDocument?
    @State private var statusText = ""
    @State private var saveTask: Task<Void, Never>?

    #if os(iOS)
    @State private var markupTool: PDFMarkupTool = .pen
    @State private var isWritingMode = false
    @State private var toolOptions: PDFMarkupTool?
    @State private var didConfirmCurrentTool = false
    @State private var penColorHex = "#111111"
    @State private var penWidth = 2.5
    @State private var eraserWidth = 18.0
    @State private var currentPageIndex = 0
    @State private var isAddingText = false
    @State private var newTextValue = ""
    @State private var isImportingImage = false
    @State private var selectedObjectId: String?
    @State private var lassoSelection: PDFLassoSelectionSummary?
    @State private var isInspectorPresented = false
    @State private var isExportOptionsPresented = false
    @State private var exportIncludesAnnotations = true
    @State private var exportPageRange = ""
    @State private var isExportingPDF = false
    @State private var exportedPDFShare: PDFExportShare?
    @State private var isImportingPDFPages = false
    #endif

    #if os(macOS)
    @State private var macMarkupTool: MacPDFMarkupTool = .select
    @State private var isMacWritingMode = false
    @State private var macSelectedObjectId: String?
    @State private var isMacInspectorPresented = false
    #endif

    var body: some View {
        VStack(spacing: 0) {
            header

            #if os(iOS)
            AnnotatedPDFKitView(
                url: rawFile.url,
                annotations: annotations,
                focus: store.selectedPDFFocus?.path == rawFile.path ? store.selectedPDFFocus : nil,
                tool: markupTool,
                isWritingMode: isWritingMode,
                penColorHex: penColorHex,
                penWidth: penWidth,
                eraserWidth: eraserWidth,
                selectedObjectId: selectedObjectId,
                lassoSelection: lassoSelection,
                onCurrentPageChanged: { currentPageIndex = $0 },
                onStrokeFinished: appendInkStroke(pageIndex:stroke:),
                onStrokesChanged: replaceInkStrokes(pageIndex:strokes:),
                onObjectSelected: { selectedObjectId = $0.id },
                onObjectChanged: updateAnnotationObject(_:),
                onObjectDeleted: deleteAnnotationObject(_:),
                onLassoSelectionChanged: { lassoSelection = $0 }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay {
                GeometryReader { proxy in
                    if let selection = lassoSelection,
                       !selection.isMoving,
                       let anchor = selection.optionAnchor,
                       isWritingMode,
                       markupTool == .lasso {
                        PDFLassoOptionsBar(
                            selection: selection,
                            hasTextSelection: hasTextObject(in: selection),
                            onDelete: { deleteLassoSelection(selection) },
                            onColor: { recolorLassoSelection(selection, colorHex: $0) },
                            onFontSize: { adjustLassoTextSize(selection, delta: $0) }
                        )
                        .position(
                            x: min(max(anchor.x, 92), proxy.size.width - 92),
                            y: min(max(anchor.y, 28), proxy.size.height - 28)
                        )
                    }
                }
            }
            #else
            MacAnnotatedPDFKitView(
                url: rawFile.url,
                focus: store.selectedPDFFocus?.path == rawFile.path ? store.selectedPDFFocus : nil,
                annotations: annotations,
                tool: macMarkupTool,
                isWritingMode: isMacWritingMode,
                selectedObjectId: macSelectedObjectId,
                onStrokeFinished: appendMacInkStroke(pageIndex:stroke:),
                onStrokesChanged: replaceMacInkStrokes(pageIndex:strokes:),
                onObjectSelected: { macSelectedObjectId = $0.id },
                onObjectChanged: updateMacAnnotationObject(_:),
                onObjectDeleted: deleteMacAnnotationObject(_:)
            )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            #endif
        }
        .task(id: rawFile.path) {
            await loadAnnotations()
        }
        .onDisappear {
            saveTask?.cancel()
        }
        #if os(iOS)
        .alert("Add text box", isPresented: $isAddingText) {
            TextField("Text", text: $newTextValue)
            Button("Add") {
                addTextBox(newTextValue)
                newTextValue = ""
            }
            Button("Cancel", role: .cancel) {
                newTextValue = ""
            }
        } message: {
            Text("The text box is saved as searchable PDF annotation text.")
        }
        .fileImporter(isPresented: $isImportingImage, allowedContentTypes: [.image], allowsMultipleSelection: false) { result in
            switch result {
            case let .success(urls):
                guard let url = urls.first else { return }
                importAnnotationImage(from: url)
            case .failure:
                statusText = "Image import failed"
            }
        }
        .sheet(isPresented: $isInspectorPresented) {
            if let object = selectedAnnotationObject {
                PDFAnnotationInspectorView(
                    object: object,
                    onChange: updateAnnotationObject(_:),
                    onDuplicate: duplicateAnnotationObject(_:),
                    onDelete: deleteAnnotationObject(_:),
                    onLayerAction: moveAnnotationObject(_:action:)
                )
                .presentationDetents([.medium, .large])
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "hand.tap")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Select a text box or image first.")
                        .font(.headline)
                    Text("Use Move mode, then tap an object on the PDF.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
        }
        .sheet(item: $exportedPDFShare) { item in
            PDFShareSheet(urls: item.urls)
        }
        .sheet(isPresented: $isExportOptionsPresented) {
            PDFExportOptionsView(
                includeAnnotations: $exportIncludesAnnotations,
                pageRange: $exportPageRange,
                isExporting: isExportingPDF,
                onExportPDF: {
                    isExportOptionsPresented = false
                    exportPDF(includeAnnotations: exportIncludesAnnotations)
                },
                onExportCodmesState: {
                    isExportOptionsPresented = false
                    exportPDFWithCodmesState()
                }
            )
            .presentationDetents([.height(330), .medium])
        }
        .fileImporter(isPresented: $isImportingPDFPages, allowedContentTypes: [.pdf, .json], allowsMultipleSelection: true) { result in
            switch result {
            case let .success(urls):
                importPDFPages(from: urls)
            case .failure:
                statusText = "PDF import failed"
            }
        }
        #elseif os(macOS)
        .sheet(isPresented: $isMacInspectorPresented) {
            if let object = selectedMacAnnotationObject {
                MacPDFAnnotationInspectorView(
                    object: object,
                    onChange: updateMacAnnotationObject(_:),
                    onDelete: deleteMacAnnotationObject(_:)
                )
                .frame(minWidth: 360, minHeight: 320)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "hand.tap")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Select a text box or image first.")
                        .font(.headline)
                    Text("Use Move mode, then click an object on the PDF.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(28)
                .frame(minWidth: 320, minHeight: 220)
            }
        }
        #endif
    }

    private var header: some View {
        HStack(spacing: 10) {
            Label("PDF", systemImage: "doc.richtext")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            if !statusText.isEmpty {
                Text(statusText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            #if os(iOS)
            Picker("PDF mode", selection: $isWritingMode) {
                Image(systemName: "hand.draw").tag(false)
                Image(systemName: "pencil.tip").tag(true)
            }
            .pickerStyle(.segmented)
            .frame(width: 92)
            .accessibilityLabel("PDF mode")

            HStack(spacing: 4) {
                pdfToolButton(.pen)
                pdfToolButton(.eraser)
                pdfToolButton(.lasso)
            }
            .popover(item: $toolOptions) { selectedTool in
                PDFToolOptionsPopover(
                    tool: selectedTool,
                    penColorHex: $penColorHex,
                    penWidth: $penWidth,
                    eraserWidth: $eraserWidth
                )
                .frame(width: 260)
                .padding(14)
            }

            Divider()
                .frame(height: 18)

            Button {
                isWritingMode = true
                markupTool = .lasso
                isAddingText = true
            } label: {
                Image(systemName: "textformat")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add text box")

            Button {
                isWritingMode = true
                markupTool = .lasso
                isImportingImage = true
            } label: {
                Image(systemName: "photo.badge.plus")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Attach image")

            Button {
                isWritingMode = true
                markupTool = .lasso
                isInspectorPresented = true
            } label: {
                Image(systemName: "slider.horizontal.3")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Annotation inspector")

            Button {
                isExportOptionsPresented = true
            } label: {
                Image(systemName: isExportingPDF ? "hourglass" : "square.and.arrow.up")
            }
            .buttonStyle(.plain)
            .disabled(isExportingPDF)
            .accessibilityLabel("Export PDF")

            Button {
                isWritingMode = true
                markupTool = .lasso
                isImportingPDFPages = true
            } label: {
                Image(systemName: "doc.badge.plus")
            }
            .buttonStyle(.plain)
            .disabled(isExportingPDF)
            .accessibilityLabel("Insert PDF pages after current page")
            #elseif os(macOS)
            Picker("PDF mode", selection: $isMacWritingMode) {
                Image(systemName: "hand.draw").tag(false)
                Image(systemName: "pencil.tip").tag(true)
            }
            .pickerStyle(.segmented)
            .frame(width: 92)
            .onChange(of: isMacWritingMode) { _, writing in
                if writing, macMarkupTool == .select {
                    macMarkupTool = .pen
                }
            }
            .accessibilityLabel("PDF mode")

            macPDFToolButton(.pen)
            macPDFToolButton(.eraser)
            macPDFToolButton(.select)
            Button {
                isMacWritingMode = true
                macMarkupTool = .select
                isMacInspectorPresented = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.secondary)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Annotation inspector")
            #endif
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 7)
        .background(.quaternary.opacity(0.08))
    }

    #if os(iOS)
    private func pdfToolButton(_ tool: PDFMarkupTool) -> some View {
        Button {
            isWritingMode = true
            if (tool == .pen || tool == .eraser), markupTool == tool, didConfirmCurrentTool {
                toolOptions = tool
                didConfirmCurrentTool = false
            } else {
                markupTool = tool
                toolOptions = nil
                didConfirmCurrentTool = tool == .pen || tool == .eraser
            }
        } label: {
            Image(systemName: tool.systemImage)
                .font(.system(size: 15, weight: markupTool == tool ? .semibold : .regular))
                .foregroundStyle(markupTool == tool ? Color.accentColor : Color.secondary)
                .frame(width: 28, height: 28)
                .background(markupTool == tool ? Color.accentColor.opacity(0.14) : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tool.label)
    }

    private struct PDFToolOptionsPopover: View {
        let tool: PDFMarkupTool
        @Binding var penColorHex: String
        @Binding var penWidth: Double
        @Binding var eraserWidth: Double

        private let colorChoices = ["#111111", "#E03131", "#1971C2", "#2F9E44", "#F08C00", "#7048E8"]

        var body: some View {
            VStack(alignment: .leading, spacing: 14) {
                Label(tool.label, systemImage: tool.systemImage)
                    .font(.headline)

                if tool == .pen {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Color")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        HStack(spacing: 10) {
                            ForEach(colorChoices, id: \.self) { hex in
                                Button {
                                    penColorHex = hex
                                } label: {
                                    Circle()
                                        .fill(Color(UIColor(hexString: hex)))
                                        .frame(width: 24, height: 24)
                                        .overlay {
                                            Circle()
                                                .stroke(penColorHex == hex ? Color.accentColor : Color.secondary.opacity(0.25), lineWidth: penColorHex == hex ? 3 : 1)
                                        }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Pen color \(hex)")
                            }
                        }
                    }

                    ToolWidthSlider(label: "Width", value: $penWidth, range: 1...12)
                } else {
                    ToolWidthSlider(label: "Width", value: $eraserWidth, range: 6...44)
                }
            }
        }
    }

    private struct PDFLassoOptionsBar: View {
        let selection: PDFLassoSelectionSummary
        let hasTextSelection: Bool
        var onDelete: () -> Void
        var onColor: (String) -> Void
        var onFontSize: (Double) -> Void

        private let colorChoices = [
            ("Black", "#111111"),
            ("Red", "#E03131"),
            ("Blue", "#1971C2"),
            ("Green", "#2F9E44"),
            ("Orange", "#F08C00"),
            ("Purple", "#7048E8")
        ]

        var body: some View {
            HStack(spacing: 8) {
                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Delete selection")

                Menu {
                    ForEach(colorChoices, id: \.1) { name, hex in
                        Button {
                            onColor(hex)
                        } label: {
                            Label(name, systemImage: "circle.fill")
                                .foregroundStyle(Color(UIColor(hexString: hex)))
                        }
                    }
                } label: {
                    Image(systemName: "paintpalette")
                        .frame(width: 30, height: 30)
                }
                .accessibilityLabel("Selection color")

                if hasTextSelection {
                    Button {
                        onFontSize(-1)
                    } label: {
                        Image(systemName: "textformat.size.smaller")
                            .frame(width: 30, height: 30)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Smaller text")

                    Button {
                        onFontSize(1)
                    } label: {
                        Image(systemName: "textformat.size.larger")
                            .frame(width: 30, height: 30)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Larger text")
                }
            }
            .padding(6)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .shadow(radius: 8, y: 2)
        }
    }

    private struct ToolWidthSlider: View {
        let label: String
        @Binding var value: Double
        let range: ClosedRange<Double>

        var body: some View {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(Int(value.rounded())) pt")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Slider(value: $value, in: range)
            }
        }
    }
    #endif

    #if os(macOS)
    private func macPDFToolButton(_ tool: MacPDFMarkupTool) -> some View {
        Button {
            isMacWritingMode = true
            macMarkupTool = tool
        } label: {
            Image(systemName: tool.systemImage)
                .font(.system(size: 15, weight: macMarkupTool == tool ? .semibold : .regular))
                .foregroundStyle(macMarkupTool == tool ? Color.accentColor : Color.secondary)
                .frame(width: 28, height: 28)
                .background(macMarkupTool == tool ? Color.accentColor.opacity(0.14) : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tool.label)
    }

    private func appendMacInkStroke(pageIndex: Int, stroke: CodmesInkStroke) {
        var next = annotations ?? emptyAnnotationDocument()
        if let index = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            var strokes = next.pages[index].inkStrokes ?? []
            strokes.append(stroke)
            next.pages[index].inkStrokes = strokes
        } else {
            next.pages.append(PDFAnnotationPage(pageIndex: pageIndex, inkDataBase64: nil, inkStrokes: [stroke], objects: []))
            next.pages.sort { $0.pageIndex < $1.pageIndex }
        }
        annotations = next
        scheduleSave(next)
    }

    private func replaceMacInkStrokes(pageIndex: Int, strokes: [CodmesInkStroke]) {
        var next = annotations ?? emptyAnnotationDocument()
        if let index = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            next.pages[index].inkStrokes = strokes
        } else {
            next.pages.append(PDFAnnotationPage(pageIndex: pageIndex, inkDataBase64: nil, inkStrokes: strokes, objects: []))
            next.pages.sort { $0.pageIndex < $1.pageIndex }
        }
        annotations = next
        scheduleSave(next)
    }

    private func updateMacAnnotationObject(_ object: PDFAnnotationObject) {
        guard let pageIndex = object.pageIndex else { return }
        var next = annotations ?? emptyAnnotationDocument()
        if let pageOffset = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            var objects = next.pages[pageOffset].objects ?? []
            if let objectOffset = objects.firstIndex(where: { $0.id == object.id }) {
                objects[objectOffset] = object
            } else {
                objects.append(object)
            }
            next.pages[pageOffset].objects = objects
        } else {
            next.pages.append(PDFAnnotationPage(pageIndex: pageIndex, inkDataBase64: nil, inkStrokes: nil, objects: [object]))
            next.pages.sort { $0.pageIndex < $1.pageIndex }
        }
        macSelectedObjectId = object.id
        annotations = next
        scheduleSave(next)
    }

    private func deleteMacAnnotationObject(_ object: PDFAnnotationObject) {
        guard let pageIndex = object.pageIndex else { return }
        var next = annotations ?? emptyAnnotationDocument()
        if let pageOffset = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            var objects = next.pages[pageOffset].objects ?? []
            objects.removeAll { $0.id == object.id }
            next.pages[pageOffset].objects = objects
        }
        next.objects.removeAll { $0.id == object.id }
        if macSelectedObjectId == object.id {
            macSelectedObjectId = nil
        }
        annotations = next
        scheduleSave(next)
    }

    private var selectedMacAnnotationObject: PDFAnnotationObject? {
        guard let macSelectedObjectId else { return nil }
        for page in annotations?.pages ?? [] {
            if let object = page.objects?.first(where: { $0.id == macSelectedObjectId }) {
                return object
            }
        }
        return annotations?.objects.first(where: { $0.id == macSelectedObjectId })
    }
    #endif

    private func loadAnnotations() async {
        guard let api = store.api else { return }
        do {
            annotations = try await api.fileAnnotations(path: rawFile.path)
            statusText = annotations?.pages.isEmpty == false ? "Annotations loaded" : "Ready"
        } catch {
            annotations = PDFAnnotationDocument(
                schemaVersion: 1,
                documentPath: rawFile.path,
                updatedAt: nil,
                pages: [],
                objects: []
            )
            statusText = "Annotation sync unavailable"
        }
    }

    #if os(iOS)
    private func updatePageInk(pageIndex: Int, data: Data, drawing: PKDrawing, canvasSize: CGSize) {
        var next = annotations ?? emptyAnnotationDocument()
        let encoded = data.base64EncodedString()
        let strokes = codmesStrokes(from: drawing, canvasSize: canvasSize)
        if let index = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            next.pages[index].inkDataBase64 = encoded
            next.pages[index].inkStrokes = strokes
        } else {
            next.pages.append(PDFAnnotationPage(pageIndex: pageIndex, inkDataBase64: encoded, inkStrokes: strokes, objects: []))
            next.pages.sort { $0.pageIndex < $1.pageIndex }
        }
        annotations = next
        scheduleSave(next)
    }

    private func appendInkStroke(pageIndex: Int, stroke: CodmesInkStroke) {
        var next = annotations ?? emptyAnnotationDocument()
        if let index = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            var strokes = next.pages[index].inkStrokes ?? []
            strokes.append(stroke)
            next.pages[index].inkStrokes = strokes
        } else {
            next.pages.append(PDFAnnotationPage(pageIndex: pageIndex, inkDataBase64: nil, inkStrokes: [stroke], objects: []))
            next.pages.sort { $0.pageIndex < $1.pageIndex }
        }
        annotations = next
        scheduleSave(next)
    }

    private func replaceInkStrokes(pageIndex: Int, strokes: [CodmesInkStroke]) {
        var next = annotations ?? emptyAnnotationDocument()
        if let index = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            next.pages[index].inkStrokes = strokes
        } else {
            next.pages.append(PDFAnnotationPage(pageIndex: pageIndex, inkDataBase64: nil, inkStrokes: strokes, objects: []))
            next.pages.sort { $0.pageIndex < $1.pageIndex }
        }
        annotations = next
        scheduleSave(next)
    }

    private func hasTextObject(in selection: PDFLassoSelectionSummary) -> Bool {
        for page in annotations?.pages ?? [] {
            if page.pageIndex == selection.pageIndex,
               page.objects?.contains(where: { selection.objectIds.contains($0.id) && $0.type.lowercased().contains("text") }) == true {
                return true
            }
        }
        return annotations?.objects.contains(where: { selection.objectIds.contains($0.id) && $0.type.lowercased().contains("text") }) == true
    }

    private func deleteLassoSelection(_ selection: PDFLassoSelectionSummary) {
        var next = annotations ?? emptyAnnotationDocument()
        if let pageOffset = next.pages.firstIndex(where: { $0.pageIndex == selection.pageIndex }) {
            if var strokes = next.pages[pageOffset].inkStrokes {
                strokes.removeAll { selection.strokeIds.contains($0.id) }
                next.pages[pageOffset].inkStrokes = strokes
            }
            if var objects = next.pages[pageOffset].objects {
                objects.removeAll { selection.objectIds.contains($0.id) }
                next.pages[pageOffset].objects = objects
            }
        }
        next.objects.removeAll { selection.objectIds.contains($0.id) }
        if let selectedObjectId, selection.objectIds.contains(selectedObjectId) {
            self.selectedObjectId = nil
        }
        lassoSelection = nil
        annotations = next
        scheduleSave(next)
    }

    private func recolorLassoSelection(_ selection: PDFLassoSelectionSummary, colorHex: String) {
        var next = annotations ?? emptyAnnotationDocument()
        if let pageOffset = next.pages.firstIndex(where: { $0.pageIndex == selection.pageIndex }) {
            if var strokes = next.pages[pageOffset].inkStrokes {
                for index in strokes.indices where selection.strokeIds.contains(strokes[index].id) {
                    strokes[index].color = colorHex
                }
                next.pages[pageOffset].inkStrokes = strokes
            }
            if var objects = next.pages[pageOffset].objects {
                for index in objects.indices where selection.objectIds.contains(objects[index].id) {
                    var metadata = objects[index].metadata ?? [:]
                    metadata["color"] = colorHex
                    objects[index].metadata = metadata
                }
                next.pages[pageOffset].objects = objects
            }
        }
        for index in next.objects.indices where selection.objectIds.contains(next.objects[index].id) {
            var metadata = next.objects[index].metadata ?? [:]
            metadata["color"] = colorHex
            next.objects[index].metadata = metadata
        }
        annotations = next
        scheduleSave(next)
    }

    private func adjustLassoTextSize(_ selection: PDFLassoSelectionSummary, delta: Double) {
        var next = annotations ?? emptyAnnotationDocument()
        func adjust(_ object: inout PDFAnnotationObject) {
            guard selection.objectIds.contains(object.id), object.type.lowercased().contains("text") else { return }
            var metadata = object.metadata ?? [:]
            let current = Double(metadata["fontSize"] ?? "16") ?? 16
            metadata["fontSize"] = String(Int(max(8, min(72, current + delta))))
            object.metadata = metadata
        }
        for pageOffset in next.pages.indices where next.pages[pageOffset].pageIndex == selection.pageIndex {
            if var objects = next.pages[pageOffset].objects {
                for index in objects.indices {
                    adjust(&objects[index])
                }
                next.pages[pageOffset].objects = objects
            }
        }
        for index in next.objects.indices {
            adjust(&next.objects[index])
        }
        annotations = next
        scheduleSave(next)
    }

    private func addTextBox(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let object = PDFAnnotationObject(
            id: UUID().uuidString,
            type: "text",
            pageIndex: currentPageIndex,
            bbox: AnnotationBoundingBox(x: 0.18, y: 0.18, width: 0.46, height: 0.08, normalized: nil),
            text: trimmed,
            dataBase64: nil,
            metadata: ["fontSize": "16", "color": "label"]
        )
        updateAnnotationObject(object)
        selectedObjectId = object.id
        markupTool = .lasso
        isWritingMode = true
    }

    private func importAnnotationImage(from url: URL) {
        Task {
            let scoped = url.startAccessingSecurityScopedResource()
            defer {
                if scoped { url.stopAccessingSecurityScopedResource() }
            }
            do {
                let data = try Data(contentsOf: url)
                let mime = imageMime(for: url)
                let object = PDFAnnotationObject(
                    id: UUID().uuidString,
                    type: "image",
                    pageIndex: currentPageIndex,
                    bbox: AnnotationBoundingBox(x: 0.2, y: 0.2, width: 0.42, height: 0.24, normalized: nil),
                    text: nil,
                    dataBase64: data.base64EncodedString(),
                    metadata: ["mime": mime, "fileName": url.lastPathComponent]
                )
                await MainActor.run {
                    updateAnnotationObject(object)
                    selectedObjectId = object.id
                    markupTool = .lasso
                    isWritingMode = true
                    statusText = "Image attached"
                }
            } catch {
                await MainActor.run { statusText = "Image import failed" }
            }
        }
    }

    private func imageMime(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "jpg", "jpeg": "image/jpeg"
        case "webp": "image/webp"
        case "gif": "image/gif"
        case "bmp": "image/bmp"
        case "tif", "tiff": "image/tiff"
        default: "image/png"
        }
    }

    private func updateAnnotationObject(_ object: PDFAnnotationObject) {
        guard let pageIndex = object.pageIndex else { return }
        var next = annotations ?? emptyAnnotationDocument()
        if let pageOffset = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            var objects = next.pages[pageOffset].objects ?? []
            if let objectOffset = objects.firstIndex(where: { $0.id == object.id }) {
                objects[objectOffset] = object
            } else {
                objects.append(object)
            }
            next.pages[pageOffset].objects = objects
        } else {
            next.pages.append(PDFAnnotationPage(pageIndex: pageIndex, inkDataBase64: nil, inkStrokes: nil, objects: [object]))
            next.pages.sort { $0.pageIndex < $1.pageIndex }
        }
        annotations = next
        scheduleSave(next)
    }

    private var selectedAnnotationObject: PDFAnnotationObject? {
        guard let selectedObjectId else { return nil }
        return annotationObject(with: selectedObjectId)
    }

    private func annotationObject(with id: String) -> PDFAnnotationObject? {
        for page in annotations?.pages ?? [] {
            if let object = page.objects?.first(where: { $0.id == id }) {
                return object
            }
        }
        return annotations?.objects.first(where: { $0.id == id })
    }

    private func duplicateAnnotationObject(_ object: PDFAnnotationObject) {
        var copy = object
        copy.id = UUID().uuidString
        if let box = object.bbox?.normalizedOrSelf {
            copy.bbox = AnnotationBoundingBox(
                x: min(0.92, box.x + 0.035),
                y: min(0.92, box.y + 0.035),
                width: box.width,
                height: box.height,
                normalized: nil
            )
        }
        updateAnnotationObject(copy)
        selectedObjectId = copy.id
    }

    private func moveAnnotationObject(_ object: PDFAnnotationObject, action: PDFLayerAction) {
        guard let pageIndex = object.pageIndex else { return }
        var next = annotations ?? emptyAnnotationDocument()
        guard let pageOffset = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) else { return }
        var objects = next.pages[pageOffset].objects ?? []
        guard let index = objects.firstIndex(where: { $0.id == object.id }) else { return }
        let item = objects.remove(at: index)
        switch action {
        case .back:
            objects.insert(item, at: 0)
        case .front:
            objects.append(item)
        case .backward:
            objects.insert(item, at: max(0, index - 1))
        case .forward:
            objects.insert(item, at: min(objects.count, index + 1))
        }
        next.pages[pageOffset].objects = objects
        annotations = next
        selectedObjectId = object.id
        scheduleSave(next)
    }

    private func deleteAnnotationObject(_ object: PDFAnnotationObject) {
        guard let pageIndex = object.pageIndex else { return }
        var next = annotations ?? emptyAnnotationDocument()
        if let pageOffset = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
            var objects = next.pages[pageOffset].objects ?? []
            objects.removeAll { $0.id == object.id }
            next.pages[pageOffset].objects = objects
        }
        next.objects.removeAll { $0.id == object.id }
        if selectedObjectId == object.id {
            selectedObjectId = nil
        }
        annotations = next
        scheduleSave(next)
    }

    private func exportPDF(includeAnnotations: Bool) {
        isExportingPDF = true
        statusText = "Exporting..."
        let annotations = annotations ?? emptyAnnotationDocument()
        let sourceURL = rawFile.url
        let outputURL = exportDirectory()
            .appendingPathComponent(exportFileName(includeAnnotations: includeAnnotations))
        let requestedPages = selectedPageIndexes()

        Task.detached {
            do {
                try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                guard let sourceDocument = PDFDocument(url: sourceURL) else { throw CocoaError(.fileNoSuchFile) }
                let pages = normalizedPageIndexes(requestedPages, pageCount: sourceDocument.pageCount)
                if includeAnnotations {
                    let exportDocument = try copyPDFDocument(sourceDocument, pageIndexes: pages)
                    let exportAnnotations = annotations.sliced(to: pages, documentPath: outputURL.lastPathComponent)
                    try renderFlattenedPDF(document: exportDocument, annotations: exportAnnotations, to: outputURL)
                } else if requestedPages.isEmpty {
                    try replaceFileCopy(from: sourceURL, to: outputURL)
                } else {
                    let exportDocument = try copyPDFDocument(sourceDocument, pageIndexes: pages)
                    guard exportDocument.write(to: outputURL) else { throw CocoaError(.fileWriteUnknown) }
                }
                await MainActor.run {
                    isExportingPDF = false
                    statusText = "Export ready"
                    exportedPDFShare = PDFExportShare(urls: [outputURL])
                }
            } catch {
                await MainActor.run {
                    isExportingPDF = false
                    statusText = "Export failed"
                }
            }
        }
    }

    private func exportPDFWithCodmesState() {
        isExportingPDF = true
        statusText = "Exporting..."
        let annotations = annotations ?? emptyAnnotationDocument()
        let sourceURL = rawFile.url
        let outputDirectory = exportDirectory()
            .appendingPathComponent("\(basePDFName())-codmes", isDirectory: true)
        let pdfDirectory = outputDirectory.appendingPathComponent("PDF", isDirectory: true)
        let codmesDirectory = outputDirectory.appendingPathComponent("Codmes", isDirectory: true)
        let pdfURL = pdfDirectory.appendingPathComponent(rawFile.name)
        let stateURL = codmesDirectory.appendingPathComponent("\(basePDFName()).codmes.json")
        let requestedPages = selectedPageIndexes()

        Task.detached {
            do {
                try FileManager.default.createDirectory(at: pdfDirectory, withIntermediateDirectories: true)
                try FileManager.default.createDirectory(at: codmesDirectory, withIntermediateDirectories: true)
                guard let sourceDocument = PDFDocument(url: sourceURL) else { throw CocoaError(.fileNoSuchFile) }
                let pages = normalizedPageIndexes(requestedPages, pageCount: sourceDocument.pageCount)
                let exportDocument = try copyPDFDocument(sourceDocument, pageIndexes: pages)
                guard exportDocument.write(to: pdfURL) else { throw CocoaError(.fileWriteUnknown) }
                let exportAnnotations = annotations.sliced(to: pages, documentPath: pdfURL.lastPathComponent)
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                let data = try encoder.encode(exportAnnotations)
                try data.write(to: stateURL, options: .atomic)
                await MainActor.run {
                    isExportingPDF = false
                    statusText = "Codmes export ready"
                    exportedPDFShare = PDFExportShare(urls: [pdfURL, stateURL])
                }
            } catch {
                await MainActor.run {
                    isExportingPDF = false
                    statusText = "Export failed"
                }
            }
        }
    }

    private func exportDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("CodmesExports", isDirectory: true)
    }

    private func basePDFName() -> String {
        let name = (rawFile.name as NSString).deletingPathExtension
        return name.isEmpty
            ? rawFile.name.replacingOccurrences(of: ".pdf", with: "", options: [.caseInsensitive])
            : name
    }

    private func exportFileName(includeAnnotations: Bool) -> String {
        let hasRange = !selectedPageIndexes().isEmpty
        if includeAnnotations {
            return "\(basePDFName())\(hasRange ? "-pages" : "")-annotated.pdf"
        }
        return hasRange ? "\(basePDFName())-pages.pdf" : rawFile.name
    }

    private func selectedPageIndexes() -> [Int] {
        parsePDFPageRange(exportPageRange)
    }

    private func importPDFPages(from urls: [URL]) {
        guard let api = store.api else { return }
        let scoped = urls.map { ($0, $0.startAccessingSecurityScopedResource()) }
        defer {
            for (url, didAccess) in scoped where didAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }
        guard let pdfURL = urls.first(where: { $0.pathExtension.lowercased() == "pdf" }) else {
            statusText = "Select a PDF file."
            return
        }
        let stateURL = urls.first(where: { $0.lastPathComponent.lowercased().hasSuffix(".codmes.json") })
        isExportingPDF = true
        statusText = "Inserting PDF..."
        let existingAnnotations = annotations ?? emptyAnnotationDocument()
        let targetPath = rawFile.path
        let sourceURL = rawFile.url
        let insertAfter = currentPageIndex
        Task.detached {
            do {
                guard let baseDocument = PDFDocument(url: sourceURL),
                      let incomingDocument = PDFDocument(url: pdfURL) else {
                    throw CocoaError(.fileNoSuchFile)
                }
                let insertAt = min(max(insertAfter + 1, 0), baseDocument.pageCount)
                for offset in 0..<incomingDocument.pageCount {
                    guard let page = incomingDocument.page(at: offset)?.copy() as? PDFPage else { continue }
                    baseDocument.insert(page, at: insertAt + offset)
                }
                let outputURL = FileManager.default.temporaryDirectory
                    .appendingPathComponent("CodmesPDFMerge-\(UUID().uuidString).pdf")
                guard baseDocument.write(to: outputURL) else { throw CocoaError(.fileWriteUnknown) }
                let mergedData = try Data(contentsOf: outputURL)
                let importedAnnotations = try stateURL.map { url -> PDFAnnotationDocument in
                    let data = try Data(contentsOf: url)
                    return try JSONDecoder().decode(PDFAnnotationDocument.self, from: data)
                }
                let mergedAnnotations = existingAnnotations.inserting(
                    importedAnnotations,
                    at: insertAt,
                    insertedPageCount: incomingDocument.pageCount,
                    documentPath: targetPath
                )
                try? FileManager.default.removeItem(at: outputURL)
                try await api.replaceBinaryFile(path: targetPath, data: mergedData)
                let saved = try await api.saveFileAnnotations(path: targetPath, annotations: mergedAnnotations)
                await MainActor.run {
                    annotations = saved
                    isExportingPDF = false
                    statusText = importedAnnotations == nil ? "PDF inserted and reindexed" : "PDF + Codmes state inserted"
                }
            } catch {
                await MainActor.run {
                    isExportingPDF = false
                    statusText = "PDF insert failed"
                }
            }
        }
    }
    #endif

    private func emptyAnnotationDocument() -> PDFAnnotationDocument {
        PDFAnnotationDocument(
            schemaVersion: 1,
            documentPath: rawFile.path,
            updatedAt: nil,
            pages: [],
            objects: []
        )
    }

    private func scheduleSave(_ document: PDFAnnotationDocument) {
        statusText = "Saving..."
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 650_000_000)
            guard !Task.isCancelled else { return }
            await saveAnnotations(document)
        }
    }

    private func saveAnnotations(_ document: PDFAnnotationDocument) async {
        guard let api = store.api else { return }
        do {
            let saved = try await api.saveFileAnnotations(path: rawFile.path, annotations: document)
            guard !Task.isCancelled else { return }
            annotations = saved
            statusText = "Saved"
        } catch {
            guard !Task.isCancelled else { return }
            statusText = "Save failed"
        }
    }
}

#if os(macOS)
private struct MacAnnotatedPDFKitView: NSViewRepresentable {
    let url: URL
    var focus: PDFDocumentFocus?
    var annotations: PDFAnnotationDocument?
    var tool: MacPDFMarkupTool
    var isWritingMode: Bool
    var selectedObjectId: String?
    var onStrokeFinished: (Int, CodmesInkStroke) -> Void
    var onStrokesChanged: (Int, [CodmesInkStroke]) -> Void
    var onObjectSelected: (PDFAnnotationObject) -> Void
    var onObjectChanged: (PDFAnnotationObject) -> Void
    var onObjectDeleted: (PDFAnnotationObject) -> Void

    func makeNSView(context: Context) -> CodmesMacPDFView {
        let view = CodmesMacPDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .clear
        return view
    }

    func updateNSView(_ view: CodmesMacPDFView, context: Context) {
        view.tool = tool
        view.isWritingMode = isWritingMode
        view.annotations = annotations
        view.selectedObjectId = selectedObjectId
        view.onStrokeFinished = onStrokeFinished
        view.onStrokesChanged = onStrokesChanged
        view.onObjectSelected = onObjectSelected
        view.onObjectChanged = onObjectChanged
        view.onObjectDeleted = onObjectDeleted
        if view.document?.documentURL != url {
            view.document = PDFDocument(url: url)
        }
        view.applyCodmesInkAnnotations(annotations)
        if let pageNumber = focus?.page,
           let page = view.document?.page(at: max(0, pageNumber - 1)) {
            view.go(to: page)
        }
    }
}

private final class CodmesMacPDFView: PDFView {
    var tool: MacPDFMarkupTool = .select
    var isWritingMode = false
    var annotations: PDFAnnotationDocument?
    var selectedObjectId: String?
    var onStrokeFinished: ((Int, CodmesInkStroke) -> Void)?
    var onStrokesChanged: ((Int, [CodmesInkStroke]) -> Void)?
    var onObjectSelected: ((PDFAnnotationObject) -> Void)?
    var onObjectChanged: ((PDFAnnotationObject) -> Void)?
    var onObjectDeleted: ((PDFAnnotationObject) -> Void)?
    private var activePage: PDFPage?
    private var activePoints: [CodmesInkPoint] = []
    private var activeStartTime: TimeInterval = 0
    private var activeObject: PDFAnnotationObject?
    private var activeObjectStartBox: NormalizedBoundingBox?
    private var activeObjectStartPoint: CodmesInkPoint?
    private var activeObjectInteraction: MacPDFObjectInteraction = .move

    override var acceptsFirstResponder: Bool { true }

    override func mouseDown(with event: NSEvent) {
        guard isWritingMode else {
            super.mouseDown(with: event)
            return
        }
        window?.makeFirstResponder(self)
        let point = convert(event.locationInWindow, from: nil)
        guard let page = page(for: point, nearest: true), let document else {
            super.mouseDown(with: event)
            return
        }

        switch tool {
        case .pen:
            activePage = page
            activeStartTime = event.timestamp
            activePoints = [normalizedPoint(from: point, event: event, page: page, startTime: activeStartTime)]
            if document.index(for: page) < 0 {
                activePage = nil
                activePoints = []
            }
        case .eraser:
            eraseStroke(at: point, page: page)
        case .select:
            let normalized = normalizedPoint(from: point, event: event, page: page, startTime: event.timestamp)
            if let object = object(at: normalized, pageIndex: document.index(for: page)) {
                activeObject = object
                activeObjectStartBox = object.bbox?.normalizedOrSelf
                activeObjectStartPoint = normalized
                activeObjectInteraction = isResizeHandleHit(point: normalized, object: object) ? .resize : .move
                selectedObjectId = object.id
                onObjectSelected?(object)
                applyCodmesInkAnnotations(annotations)
            } else {
                activeObject = nil
                activeObjectStartBox = nil
                activeObjectStartPoint = nil
                activeObjectInteraction = .move
            }
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard isWritingMode else {
            super.mouseDragged(with: event)
            return
        }
        let point = convert(event.locationInWindow, from: nil)
        guard let page = activePage ?? page(for: point, nearest: true) else {
            super.mouseDragged(with: event)
            return
        }

        switch tool {
        case .pen:
            guard activePage != nil else {
                super.mouseDragged(with: event)
                return
            }
            activePoints.append(normalizedPoint(from: point, event: event, page: page, startTime: activeStartTime))
        case .eraser:
            eraseStroke(at: point, page: page)
        case .select:
            updateActiveObjectDrag(with: point, event: event, page: page, commit: false)
        }
    }

    override func mouseUp(with event: NSEvent) {
        guard isWritingMode else {
            super.mouseUp(with: event)
            return
        }
        let point = convert(event.locationInWindow, from: nil)
        switch tool {
        case .pen:
            guard let page = activePage, let document else {
                super.mouseUp(with: event)
                return
            }
            activePoints.append(normalizedPoint(from: point, event: event, page: page, startTime: activeStartTime))
            let pageIndex = document.index(for: page)
            if pageIndex >= 0, activePoints.count > 1 {
                let stroke = CodmesInkStroke(
                    id: UUID().uuidString,
                    tool: "pen",
                    color: "#111111",
                    width: 2.5,
                    opacity: nil,
                    points: activePoints
                )
                onStrokeFinished?(pageIndex, stroke)
            }
            activePage = nil
            activePoints = []
        case .eraser:
            if let page = page(for: point, nearest: true) {
                eraseStroke(at: point, page: page)
            }
        case .select:
            if let page = activePage ?? page(for: point, nearest: true) {
                updateActiveObjectDrag(with: point, event: event, page: page, commit: true)
            }
            activeObject = nil
            activeObjectStartBox = nil
            activeObjectStartPoint = nil
            activeObjectInteraction = .move
        }
    }

    override func keyDown(with event: NSEvent) {
        guard event.keyCode == 51 || event.keyCode == 117,
              let selectedObjectId,
              let object = allObjects().first(where: { $0.id == selectedObjectId }) else {
            super.keyDown(with: event)
            return
        }
        onObjectDeleted?(object)
    }

    func applyCodmesInkAnnotations(_ annotations: PDFAnnotationDocument?) {
        guard let document else { return }
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { continue }
            for annotation in page.annotations where annotation.contents?.hasPrefix("codmes-") == true {
                page.removeAnnotation(annotation)
            }
        }
        guard let annotations else { return }
        for annotationPage in annotations.pages {
            guard let page = document.page(at: annotationPage.pageIndex) else { continue }
            let pageBounds = page.bounds(for: .mediaBox)
            if let strokes = annotationPage.inkStrokes, !strokes.isEmpty {
                let ink = PDFAnnotation(bounds: pageBounds, forType: .ink, withProperties: nil)
                ink.contents = "codmes-ink-preview"
                ink.color = .clear
                for stroke in strokes {
                    guard stroke.points.count > 1 else { continue }
                    let path = NSBezierPath()
                    let first = stroke.points[0]
                    path.move(to: pagePoint(first, pageBounds: pageBounds))
                    for point in stroke.points.dropFirst() {
                        path.line(to: pagePoint(point, pageBounds: pageBounds))
                    }
                    path.lineWidth = max(0.5, stroke.width)
                    ink.add(path)
                }
                page.addAnnotation(ink)
            }
            for object in annotationPage.objects ?? [] {
                addObjectPreview(object, to: page, pageBounds: pageBounds)
            }
        }
        for object in annotations.objects {
            guard let pageIndex = object.pageIndex,
                  let page = document.page(at: pageIndex) else { continue }
            addObjectPreview(object, to: page, pageBounds: page.bounds(for: .mediaBox))
        }
    }

    private func normalizedPoint(from viewPoint: NSPoint, event: NSEvent, page: PDFPage, startTime: TimeInterval) -> CodmesInkPoint {
        let pagePoint = convert(viewPoint, to: page)
        let bounds = page.bounds(for: .mediaBox)
        let x = min(max((pagePoint.x - bounds.minX) / max(bounds.width, 1), 0), 1)
        let y = min(max(1 - ((pagePoint.y - bounds.minY) / max(bounds.height, 1)), 0), 1)
        return CodmesInkPoint(
            x: x,
            y: y,
            pressure: Double(event.pressure),
            timeOffset: event.timestamp - startTime
        )
    }

    private func pagePoint(_ point: CodmesInkPoint, pageBounds: CGRect) -> NSPoint {
        NSPoint(
            x: pageBounds.minX + pageBounds.width * point.x,
            y: pageBounds.minY + pageBounds.height * (1 - point.y)
        )
    }

    private func addObjectPreview(_ object: PDFAnnotationObject, to page: PDFPage, pageBounds: CGRect) {
        guard let box = object.bbox?.normalizedOrSelf else { return }
        let rect = CGRect(
            x: pageBounds.minX + pageBounds.width * box.x,
            y: pageBounds.minY + pageBounds.height * (1 - box.y - box.height),
            width: pageBounds.width * box.width,
            height: pageBounds.height * box.height
        )
        let annotation: PDFAnnotation
        if object.type.lowercased().contains("text") {
            annotation = PDFAnnotation(bounds: rect, forType: .freeText, withProperties: nil)
            annotation.contents = "codmes-object-preview:\(object.id)"
            annotation.font = .systemFont(ofSize: CGFloat(Double(object.metadata?["fontSize"] ?? "16") ?? 16))
            annotation.fontColor = .labelColor
            annotation.color = object.id == selectedObjectId ? .systemOrange.withAlphaComponent(0.2) : .textBackgroundColor.withAlphaComponent(0.7)
        } else {
            annotation = PDFAnnotation(bounds: rect, forType: .square, withProperties: nil)
            annotation.contents = "codmes-object-preview:\(object.id)"
            annotation.color = object.id == selectedObjectId ? .systemOrange : .systemBlue.withAlphaComponent(0.65)
            annotation.interiorColor = .systemBlue.withAlphaComponent(0.08)
        }
        page.addAnnotation(annotation)
    }

    private func eraseStroke(at viewPoint: NSPoint, page: PDFPage) {
        guard let document, let annotations else { return }
        let pageIndex = document.index(for: page)
        guard pageIndex >= 0,
              let annotationPage = annotations.pages.first(where: { $0.pageIndex == pageIndex }),
              let strokes = annotationPage.inkStrokes,
              !strokes.isEmpty else { return }
        let normalized = normalizedPoint(from: viewPoint, page: page)
        let pageBounds = page.bounds(for: .mediaBox)
        let threshold = max(0.004, 18.0 / Double(max(min(pageBounds.width, pageBounds.height), 1)))
        let kept = splitStrokes(strokes, erasingAt: normalized, threshold: threshold)
        guard kept.map(\.id) != strokes.map(\.id) || kept.count != strokes.count else { return }
        onStrokesChanged?(pageIndex, kept)
    }

    private func normalizedPoint(from viewPoint: NSPoint, page: PDFPage) -> CodmesInkPoint {
        let pagePoint = convert(viewPoint, to: page)
        let bounds = page.bounds(for: .mediaBox)
        let x = min(max((pagePoint.x - bounds.minX) / max(bounds.width, 1), 0), 1)
        let y = min(max(1 - ((pagePoint.y - bounds.minY) / max(bounds.height, 1)), 0), 1)
        return CodmesInkPoint(x: x, y: y, pressure: nil, timeOffset: nil)
    }

    private func allObjects() -> [PDFAnnotationObject] {
        var result = annotations?.objects ?? []
        for page in annotations?.pages ?? [] {
            result.append(contentsOf: page.objects ?? [])
        }
        return result
    }

    private func object(at point: CodmesInkPoint, pageIndex: Int) -> PDFAnnotationObject? {
        allObjects().reversed().first { object in
            guard object.pageIndex == pageIndex, let box = object.bbox?.normalizedOrSelf else { return false }
            return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
        }
    }

    private func updateActiveObjectDrag(with viewPoint: NSPoint, event: NSEvent, page: PDFPage, commit: Bool) {
        guard var object = activeObject,
              let startBox = activeObjectStartBox,
              let startPoint = activeObjectStartPoint else { return }
        let current = normalizedPoint(from: viewPoint, event: event, page: page, startTime: event.timestamp)
        let dx = current.x - startPoint.x
        let dy = current.y - startPoint.y
        switch activeObjectInteraction {
        case .move:
            object.bbox = AnnotationBoundingBox(
                x: max(0, min(1 - startBox.width, startBox.x + dx)),
                y: max(0, min(1 - startBox.height, startBox.y + dy)),
                width: startBox.width,
                height: startBox.height,
                normalized: nil
            )
        case .resize:
            object.bbox = AnnotationBoundingBox(
                x: startBox.x,
                y: startBox.y,
                width: max(0.03, min(1 - startBox.x, startBox.width + dx)),
                height: max(0.025, min(1 - startBox.y, startBox.height + dy)),
                normalized: nil
            )
        }
        if commit {
            onObjectChanged?(object)
        }
    }

    private func isResizeHandleHit(point: CodmesInkPoint, object: PDFAnnotationObject) -> Bool {
        guard let box = object.bbox?.normalizedOrSelf else { return false }
        let handleWidth = min(max(box.width * 0.35, 0.025), 0.08)
        let handleHeight = min(max(box.height * 0.35, 0.025), 0.08)
        return point.x >= box.x + box.width - handleWidth &&
            point.x <= box.x + box.width &&
            point.y >= box.y + box.height - handleHeight &&
            point.y <= box.y + box.height
    }
}
#endif

#if os(macOS)
private struct MacPDFAnnotationInspectorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: PDFAnnotationObject
    var onChange: (PDFAnnotationObject) -> Void
    var onDelete: (PDFAnnotationObject) -> Void

    init(
        object: PDFAnnotationObject,
        onChange: @escaping (PDFAnnotationObject) -> Void,
        onDelete: @escaping (PDFAnnotationObject) -> Void
    ) {
        self._draft = State(initialValue: object)
        self.onChange = onChange
        self.onDelete = onDelete
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Annotation", systemImage: draft.type.lowercased().contains("image") ? "photo" : "textformat")
                    .font(.headline)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }

            Form {
                Section("Object") {
                    LabeledContent("Type", value: draft.type.capitalized)
                    LabeledContent("Page", value: String((draft.pageIndex ?? 0) + 1))
                }

                if draft.type.lowercased().contains("text") {
                    Section("Text") {
                        TextEditor(text: Binding(
                            get: { draft.text ?? "" },
                            set: {
                                draft.text = $0
                                commit()
                            }
                        ))
                        .font(.body)
                        .frame(minHeight: 90)

                        Stepper(value: fontSizeBinding, in: 8...72, step: 1) {
                            Text("Font size \(Int(fontSizeBinding.wrappedValue))")
                        }
                    }
                }

                Section("Frame") {
                    if draft.bbox?.normalizedOrSelf != nil {
                        SliderRow(label: "X", value: frameBinding(\.x), range: 0...1)
                        SliderRow(label: "Y", value: frameBinding(\.y), range: 0...1)
                        SliderRow(label: "Width", value: frameBinding(\.width), range: 0.03...1)
                        SliderRow(label: "Height", value: frameBinding(\.height), range: 0.025...1)
                    } else {
                        Text("No frame data")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Actions") {
                    Button(role: .destructive) {
                        onDelete(draft)
                        dismiss()
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .padding(18)
    }

    private var fontSizeBinding: Binding<Double> {
        Binding(
            get: { Double(draft.metadata?["fontSize"] ?? "16") ?? 16 },
            set: {
                var metadata = draft.metadata ?? [:]
                metadata["fontSize"] = String(Int($0))
                draft.metadata = metadata
                commit()
            }
        )
    }

    private func frameBinding(_ keyPath: WritableKeyPath<NormalizedBoundingBox, Double>) -> Binding<Double> {
        Binding(
            get: { draft.bbox?.normalizedOrSelf?[keyPath: keyPath] ?? 0 },
            set: { newValue in
                var box = draft.bbox?.normalizedOrSelf ?? NormalizedBoundingBox(x: 0.2, y: 0.2, width: 0.3, height: 0.12)
                box[keyPath: keyPath] = newValue
                box.width = min(max(box.width, 0.03), 1 - box.x)
                box.height = min(max(box.height, 0.025), 1 - box.y)
                box.x = min(max(box.x, 0), 1 - box.width)
                box.y = min(max(box.y, 0), 1 - box.height)
                draft.bbox = AnnotationBoundingBox(x: box.x, y: box.y, width: box.width, height: box.height, normalized: nil)
                commit()
            }
        )
    }

    private func commit() {
        onChange(draft)
    }
}

private struct SliderRow: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>

    var body: some View {
        HStack {
            Text(label)
                .frame(width: 52, alignment: .leading)
            Slider(value: $value, in: range)
            Text("\(Int((value * 100).rounded()))%")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 44, alignment: .trailing)
        }
    }
}
#endif

#if os(iOS)
fileprivate final class AnnotatedPDFView: PDFView {
    let drawingOverlay = PDFDrawingOverlayView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        drawingOverlay.isUserInteractionEnabled = false
        addSubview(drawingOverlay)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        drawingOverlay.frame = bounds
        bringSubviewToFront(drawingOverlay)
    }
}

fileprivate final class PDFDrawingOverlayView: UIView {
    var strokeColor = UIColor.black
    var lineWidth: CGFloat = 2.5
    var isDashed = false
    private var path: UIBezierPath?
    private(set) var points: [CGPoint] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func begin(at point: CGPoint) {
        let nextPath = UIBezierPath()
        nextPath.lineCapStyle = .round
        nextPath.lineJoinStyle = .round
        nextPath.lineWidth = lineWidth
        nextPath.move(to: point)
        path = nextPath
        points = [point]
        setNeedsDisplay()
    }

    func move(to point: CGPoint) {
        guard let path else { return }
        path.addLine(to: point)
        points.append(point)
        setNeedsDisplay()
    }

    func replace(with nextPoints: [CGPoint]) {
        guard let first = nextPoints.first else {
            cancel()
            return
        }
        let nextPath = UIBezierPath()
        nextPath.lineCapStyle = .round
        nextPath.lineJoinStyle = .round
        nextPath.lineWidth = lineWidth
        nextPath.move(to: first)
        for point in nextPoints.dropFirst() {
            nextPath.addLine(to: point)
        }
        path = nextPath
        points = nextPoints
        setNeedsDisplay()
    }

    func finish() -> [CGPoint] {
        let result = points
        path = nil
        points = []
        setNeedsDisplay()
        return result
    }

    func cancel() {
        path = nil
        points = []
        setNeedsDisplay()
    }

    override func draw(_ rect: CGRect) {
        guard let path else { return }
        strokeColor.setStroke()
        path.lineWidth = lineWidth
        if isDashed {
            path.setLineDash([7, 5], count: 2, phase: 0)
        } else {
            path.setLineDash([], count: 0, phase: 0)
        }
        path.stroke()
    }
}

private extension UIView {
    var isInShapeHandleHierarchy: Bool {
        if self is PDFShapeHandleView {
            return true
        }
        return superview?.isInShapeHandleHierarchy == true
    }

    var descendantScrollViews: [UIScrollView] {
        var result: [UIScrollView] = []
        if let scrollView = self as? UIScrollView {
            result.append(scrollView)
        }
        for subview in subviews {
            result.append(contentsOf: subview.descendantScrollViews)
        }
        return result
    }
}

fileprivate final class PDFPageAnnotationOverlay: UIView {
    let canvas = PKCanvasView()
    let shapePreviewLayer = CAShapeLayer()
    var objectViews: [String: UIView] = [:]
    var shapeHandleViews: [UIView] = []

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = true
        backgroundColor = .clear
        isOpaque = false
        canvas.isUserInteractionEnabled = true
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.alwaysBounceVertical = false
        canvas.alwaysBounceHorizontal = false
        canvas.isScrollEnabled = false
        canvas.delaysContentTouches = false
        canvas.minimumZoomScale = 1
        canvas.maximumZoomScale = 1
        addSubview(canvas)
        shapePreviewLayer.fillColor = UIColor.clear.cgColor
        shapePreviewLayer.lineCap = .round
        shapePreviewLayer.lineJoin = .round
        layer.addSublayer(shapePreviewLayer)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        canvas.frame = bounds
        canvas.contentSize = bounds.size
        shapePreviewLayer.frame = bounds
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard isUserInteractionEnabled, !isHidden, alpha > 0.01 else { return nil }
        return super.hitTest(point, with: event)
    }
}

fileprivate final class PDFShapeHandleView: UIView {
    let strokeId: String
    let kind: String
    let handleIndex: Int

    init(strokeId: String, kind: String, handleIndex: Int) {
        self.strokeId = strokeId
        self.kind = kind
        self.handleIndex = handleIndex
        super.init(frame: CGRect(x: 0, y: 0, width: 22, height: 22))
        backgroundColor = .systemBackground
        layer.borderColor = UIColor.systemOrange.cgColor
        layer.borderWidth = 2
        layer.cornerRadius = 11
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.18
        layer.shadowRadius = 3
        layer.shadowOffset = CGSize(width: 0, height: 1)
        isUserInteractionEnabled = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private struct AnnotatedPDFKitView: UIViewRepresentable {
    let url: URL
    var annotations: PDFAnnotationDocument?
    var focus: PDFDocumentFocus?
    var tool: PDFMarkupTool
    var isWritingMode: Bool
    var penColorHex: String
    var penWidth: Double
    var eraserWidth: Double
    var selectedObjectId: String?
    var lassoSelection: PDFLassoSelectionSummary?
    var onCurrentPageChanged: (Int) -> Void
    var onStrokeFinished: (Int, CodmesInkStroke) -> Void
    var onStrokesChanged: (Int, [CodmesInkStroke]) -> Void
    var onObjectSelected: (PDFAnnotationObject) -> Void
    var onObjectChanged: (PDFAnnotationObject) -> Void
    var onObjectDeleted: (PDFAnnotationObject) -> Void
    var onLassoSelectionChanged: (PDFLassoSelectionSummary?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            onCurrentPageChanged: onCurrentPageChanged,
            onStrokeFinished: onStrokeFinished,
            onStrokesChanged: onStrokesChanged,
            onObjectSelected: onObjectSelected,
            onObjectChanged: onObjectChanged,
            onObjectDeleted: onObjectDeleted,
            onLassoSelectionChanged: onLassoSelectionChanged
        )
    }

    func makeUIView(context: Context) -> AnnotatedPDFView {
        let view = AnnotatedPDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        view.backgroundColor = .clear
        view.pageOverlayViewProvider = context.coordinator
        let drawGesture = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleDrawingPan(_:)))
        drawGesture.maximumNumberOfTouches = 1
        drawGesture.cancelsTouchesInView = true
        drawGesture.delegate = context.coordinator
        view.addGestureRecognizer(drawGesture)
        let clearSelectionTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handlePDFTap(_:)))
        clearSelectionTap.cancelsTouchesInView = false
        clearSelectionTap.delegate = context.coordinator
        view.addGestureRecognizer(clearSelectionTap)
        context.coordinator.drawingGesture = drawGesture
        context.coordinator.clearSelectionTapGesture = clearSelectionTap
        context.coordinator.pdfView = view
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.visiblePageChanged(_:)),
            name: Notification.Name.PDFViewPageChanged,
            object: view
        )
        return view
    }

    func updateUIView(_ view: AnnotatedPDFView, context: Context) {
        context.coordinator.onCurrentPageChanged = onCurrentPageChanged
        context.coordinator.onStrokeFinished = onStrokeFinished
        context.coordinator.onStrokesChanged = onStrokesChanged
        context.coordinator.onObjectSelected = onObjectSelected
        context.coordinator.onObjectChanged = onObjectChanged
        context.coordinator.onObjectDeleted = onObjectDeleted
        context.coordinator.onLassoSelectionChanged = onLassoSelectionChanged
        context.coordinator.annotations = annotations
        context.coordinator.focus = focus
        context.coordinator.tool = tool
        context.coordinator.isWritingMode = isWritingMode
        context.coordinator.penColorHex = penColorHex
        context.coordinator.penWidth = penWidth
        context.coordinator.eraserWidth = eraserWidth
        context.coordinator.selectedObjectId = selectedObjectId
        context.coordinator.syncExternalLassoSelection(lassoSelection)
        if context.coordinator.currentURL != url {
            context.coordinator.currentURL = url
            context.coordinator.overlays.removeAll()
            view.document = PDFDocument(url: url)
        } else if view.document == nil {
            view.document = PDFDocument(url: url)
        }
        context.coordinator.applyToolToVisibleOverlays()
        context.coordinator.applyPDFNavigationMode()
        context.coordinator.applyCodmesInkAnnotations()
        context.coordinator.applyAnnotationsToVisibleOverlays()
        context.coordinator.applyFocus()
        if let current = view.currentPage, let index = view.document?.index(for: current), index >= 0 {
            onCurrentPageChanged(index)
        }
    }

    final class Coordinator: NSObject, @preconcurrency PDFPageOverlayViewProvider, UIGestureRecognizerDelegate {
        private struct LassoSelection {
            var pageIndex: Int
            var strokeIds: Set<String>
            var objectIds: Set<String>
            var bounds: AnnotationBoundingBox
        }

        private enum LassoInteraction {
            case drawing
            case moving
        }

        private struct ShapeFit {
            var kind: String
            var points: [CGPoint]
        }

        weak var pdfView: AnnotatedPDFView?
        weak var drawingGesture: UIPanGestureRecognizer?
        weak var clearSelectionTapGesture: UITapGestureRecognizer?
        var currentURL: URL?
        var annotations: PDFAnnotationDocument?
        var focus: PDFDocumentFocus?
        var tool: PDFMarkupTool = .pen
        var isWritingMode = false
        var penColorHex = "#111111"
        var penWidth = 2.5
        var eraserWidth = 18.0
        var selectedObjectId: String?
        var onCurrentPageChanged: (Int) -> Void
        var onStrokeFinished: (Int, CodmesInkStroke) -> Void
        var onStrokesChanged: (Int, [CodmesInkStroke]) -> Void
        var onObjectSelected: (PDFAnnotationObject) -> Void
        var onObjectChanged: (PDFAnnotationObject) -> Void
        var onObjectDeleted: (PDFAnnotationObject) -> Void
        var onLassoSelectionChanged: (PDFLassoSelectionSummary?) -> Void
        var overlays: [Int: PDFPageAnnotationOverlay] = [:]
        private var highlightViews: [Int: UIView] = [:]
        private var lastFocusKey = ""
        private var applyingProgrammaticDrawing = false
        private var activePage: PDFPage?
        private var activePageIndex: Int?
        private var activeStartTime: TimeInterval = 0
        private var didLockScrollForDrawing = false
        private var shapeHoldWorkItem: DispatchWorkItem?
        private var activeShapeFit: ShapeFit?
        private var lastPenPointTime: TimeInterval = 0
        private var lassoInteraction: LassoInteraction?
        private var lassoSelection: LassoSelection?
        private var lassoMoveStartPoint: CodmesInkPoint?
        private var lassoMoveStartStrokes: [CodmesInkStroke] = []
        private var lassoMoveStartObjects: [PDFAnnotationObject] = []

        init(
            onCurrentPageChanged: @escaping (Int) -> Void,
            onStrokeFinished: @escaping (Int, CodmesInkStroke) -> Void,
            onStrokesChanged: @escaping (Int, [CodmesInkStroke]) -> Void,
            onObjectSelected: @escaping (PDFAnnotationObject) -> Void,
            onObjectChanged: @escaping (PDFAnnotationObject) -> Void,
            onObjectDeleted: @escaping (PDFAnnotationObject) -> Void,
            onLassoSelectionChanged: @escaping (PDFLassoSelectionSummary?) -> Void
        ) {
            self.onCurrentPageChanged = onCurrentPageChanged
            self.onStrokeFinished = onStrokeFinished
            self.onStrokesChanged = onStrokesChanged
            self.onObjectSelected = onObjectSelected
            self.onObjectChanged = onObjectChanged
            self.onObjectDeleted = onObjectDeleted
            self.onLassoSelectionChanged = onLassoSelectionChanged
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }

        @objc func visiblePageChanged(_ notification: Notification) {
            guard let pdfView, let page = pdfView.currentPage, let index = pdfView.document?.index(for: page), index >= 0 else { return }
            onCurrentPageChanged(index)
        }

        func syncExternalLassoSelection(_ external: PDFLassoSelectionSummary?) {
            if external == nil, lassoSelection != nil {
                clearLassoSelection(notify: false)
            }
        }

        func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
            guard let document = view.document else { return nil }
            let pageIndex = document.index(for: page)
            if let existing = overlays[pageIndex] {
                return existing
            }

            let overlay = PDFPageAnnotationOverlay()
            overlay.canvas.drawingPolicy = .anyInput
            overlay.canvas.isUserInteractionEnabled = false
            overlays[pageIndex] = overlay
            applyTool(to: overlay)
            applyAnnotation(to: overlay.canvas, pageIndex: pageIndex)
            applyObjects(to: overlay, pageIndex: pageIndex)
            applyHighlight(to: overlay, pageIndex: pageIndex)
            applyShapeHandles(to: overlay, pageIndex: pageIndex)
            return overlay
        }

        func pdfView(_ pdfView: PDFView, willDisplayOverlayView overlayView: UIView, for page: PDFPage) {
            guard let overlay = overlayView as? PDFPageAnnotationOverlay,
                  let pageIndex = pdfView.document?.index(for: page) else { return }
            applyTool(to: overlay)
            applyAnnotation(to: overlay.canvas, pageIndex: pageIndex)
            applyObjects(to: overlay, pageIndex: pageIndex)
            applyHighlight(to: overlay, pageIndex: pageIndex)
            applyShapeHandles(to: overlay, pageIndex: pageIndex)
        }

        func applyToolToVisibleOverlays() {
            for overlay in overlays.values {
                applyTool(to: overlay)
            }
        }

        func applyPDFNavigationMode() {
            guard let pdfView else { return }
            let navigationEnabled = !isWritingMode
            pdfView.isInMarkupMode = false
            pdfView.drawingOverlay.isHidden = navigationEnabled
            pdfView.drawingOverlay.strokeColor = tool == .lasso ? .systemOrange : UIColor(hexString: penColorHex)
            pdfView.drawingOverlay.lineWidth = CGFloat(tool == .lasso ? 1.5 : (tool == .eraser ? eraserWidth : penWidth))
            pdfView.drawingOverlay.isDashed = tool == .lasso
            drawingGesture?.isEnabled = !navigationEnabled
            applyPDFScrollTouchPolicy()
        }

        private func applyPDFScrollTouchPolicy() {
            guard let pdfView else { return }
            let directTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            let readingTouchTypes = [
                NSNumber(value: UITouch.TouchType.direct.rawValue),
                NSNumber(value: UITouch.TouchType.pencil.rawValue)
            ]
            let shouldReservePencilForDrawing = UIDevice.current.userInterfaceIdiom == .pad
                && isWritingMode
                && (tool == .pen || tool == .eraser || tool == .lasso)
            let shouldReserveSingleTouchForDrawing = UIDevice.current.userInterfaceIdiom != .pad
                && isWritingMode
                && (tool == .pen || tool == .eraser || tool == .lasso)
            if shouldReservePencilForDrawing {
                drawingGesture?.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
                for scrollView in pdfView.descendantScrollViews {
                    scrollView.isScrollEnabled = true
                    scrollView.panGestureRecognizer.minimumNumberOfTouches = 1
                    scrollView.panGestureRecognizer.allowedTouchTypes = directTouchTypes
                    scrollView.pinchGestureRecognizer?.allowedTouchTypes = directTouchTypes
                }
            } else if shouldReserveSingleTouchForDrawing {
                drawingGesture?.allowedTouchTypes = directTouchTypes
                for scrollView in pdfView.descendantScrollViews {
                    scrollView.isScrollEnabled = true
                    scrollView.panGestureRecognizer.minimumNumberOfTouches = 2
                    scrollView.panGestureRecognizer.allowedTouchTypes = directTouchTypes
                    scrollView.pinchGestureRecognizer?.allowedTouchTypes = directTouchTypes
                }
            } else {
                drawingGesture?.allowedTouchTypes = readingTouchTypes
                for scrollView in pdfView.descendantScrollViews {
                    scrollView.isScrollEnabled = true
                    scrollView.panGestureRecognizer.minimumNumberOfTouches = 1
                    scrollView.panGestureRecognizer.allowedTouchTypes = readingTouchTypes
                    scrollView.pinchGestureRecognizer?.allowedTouchTypes = readingTouchTypes
                }
            }
        }

        func applyAnnotationsToVisibleOverlays() {
            for (pageIndex, overlay) in overlays {
                applyAnnotation(to: overlay.canvas, pageIndex: pageIndex)
                applyObjects(to: overlay, pageIndex: pageIndex)
                applyHighlight(to: overlay, pageIndex: pageIndex)
                applyShapeHandles(to: overlay, pageIndex: pageIndex)
            }
        }

        func applyFocus() {
            guard let pdfView, let document = pdfView.document, let focus else { return }
            let key = "\(focus.path):\(focus.page ?? -1):\(focus.bbox?.x ?? -1):\(focus.bbox?.y ?? -1)"
            if key != lastFocusKey, let page = focus.page, page > 0, page <= document.pageCount, let pdfPage = document.page(at: page - 1) {
                pdfView.go(to: pdfPage)
                lastFocusKey = key
            }
            for (pageIndex, overlay) in overlays {
                applyHighlight(to: overlay, pageIndex: pageIndex)
            }
        }

        private func applyTool(to overlay: PDFPageAnnotationOverlay) {
            let canAdjustShape = selectedShapeStroke(pageIndex: overlayPageIndex(for: overlay)) != nil
            overlay.isUserInteractionEnabled = isWritingMode && (tool == .lasso || canAdjustShape)
            overlay.canvas.isUserInteractionEnabled = false
            for view in overlay.objectViews.values {
                view.isUserInteractionEnabled = isWritingMode && tool == .lasso
            }
            for handle in overlay.shapeHandleViews {
                handle.isUserInteractionEnabled = isWritingMode
            }
            applyTool(to: overlay.canvas)
        }

        private func applyTool(to canvas: PKCanvasView) {
            canvas.isUserInteractionEnabled = false
            switch tool {
            case .pen:
                canvas.tool = PKInkingTool(.pen, color: UIColor(hexString: penColorHex), width: CGFloat(penWidth))
                canvas.becomeFirstResponder()
            case .eraser:
                canvas.tool = PKEraserTool(.vector, width: CGFloat(eraserWidth))
                canvas.becomeFirstResponder()
            case .lasso:
                canvas.tool = PKLassoTool()
            }
        }

        private func overlayPageIndex(for overlay: PDFPageAnnotationOverlay) -> Int? {
            overlays.first(where: { $0.value === overlay })?.key
        }

        private func currentPageIndex() -> Int? {
            guard let pdfView, let page = pdfView.currentPage, let index = pdfView.document?.index(for: page), index >= 0 else { return nil }
            return index
        }

        func applyCodmesInkAnnotations() {
            guard let document = pdfView?.document else { return }
            for index in 0..<document.pageCount {
                guard let page = document.page(at: index) else { continue }
                for annotation in page.annotations where annotation.contents?.hasPrefix("codmes-ink-") == true {
                    page.removeAnnotation(annotation)
                }
            }
            guard let annotations else { return }
            for annotationPage in annotations.pages {
                guard let page = document.page(at: annotationPage.pageIndex),
                      let strokes = annotationPage.inkStrokes else { continue }
                for stroke in strokes {
                    let selected = lassoSelection?.pageIndex == annotationPage.pageIndex && lassoSelection?.strokeIds.contains(stroke.id) == true
                    addInkPreview(stroke, to: page, contentsPrefix: "codmes-ink-preview", selected: selected)
                }
            }
        }

        private func removeCodmesInkAnnotation(id: String, from page: PDFPage) {
            for annotation in page.annotations where annotation.contents?.hasSuffix(":\(id)") == true {
                page.removeAnnotation(annotation)
            }
        }

        @objc func handleDrawingPan(_ gesture: UIPanGestureRecognizer) {
            guard let pdfView else { return }
            let viewPoint = gesture.location(in: pdfView)
            let overlayPoint = gesture.location(in: pdfView.drawingOverlay)

            switch gesture.state {
            case .began:
                guard tool == .pen || tool == .eraser || tool == .lasso,
                      let page = pdfView.page(for: viewPoint, nearest: true),
                      let document = pdfView.document else { return }
                let pageIndex = document.index(for: page)
                guard pageIndex >= 0 else { return }
                activePage = page
                activePageIndex = pageIndex
                activeStartTime = ProcessInfo.processInfo.systemUptime
                lockPDFScrollingForActiveDrawing()
                if tool == .pen {
                    pdfView.drawingOverlay.strokeColor = UIColor(hexString: penColorHex)
                    pdfView.drawingOverlay.lineWidth = CGFloat(penWidth)
                    pdfView.drawingOverlay.isDashed = false
                    activeShapeFit = nil
                    lastPenPointTime = ProcessInfo.processInfo.systemUptime
                    pdfView.drawingOverlay.begin(at: overlayPoint)
                    scheduleShapeHoldFit(page: page)
                } else if tool == .eraser {
                    pdfView.drawingOverlay.cancel()
                    eraseStroke(at: viewPoint, page: page)
                } else {
                    let normalized = normalizedPoint(from: viewPoint, page: page)
                    if let lassoSelection,
                       lassoSelection.pageIndex == pageIndex,
                       contains(normalized, in: lassoSelection.bounds) {
                        lassoInteraction = .moving
                        lassoMoveStartPoint = normalized
                        lassoMoveStartStrokes = strokes(for: pageIndex).filter { lassoSelection.strokeIds.contains($0.id) }
                        lassoMoveStartObjects = objects(for: pageIndex).filter { lassoSelection.objectIds.contains($0.id) }
                        pdfView.drawingOverlay.cancel()
                    } else {
                        lassoInteraction = .drawing
                        pdfView.drawingOverlay.strokeColor = .systemOrange
                        pdfView.drawingOverlay.lineWidth = 1.5
                        pdfView.drawingOverlay.isDashed = true
                        pdfView.drawingOverlay.begin(at: overlayPoint)
                    }
                }
            case .changed:
                guard let page = activePage else { return }
                if tool == .pen {
                    pdfView.drawingOverlay.move(to: overlayPoint)
                    lastPenPointTime = ProcessInfo.processInfo.systemUptime
                    activeShapeFit = nil
                } else if tool == .eraser {
                    eraseStroke(at: viewPoint, page: page)
                } else if tool == .lasso {
                    switch lassoInteraction {
                    case .drawing:
                        pdfView.drawingOverlay.move(to: overlayPoint)
                    case .moving:
                        updateLassoMove(to: viewPoint, page: page, commit: false)
                    case nil:
                        break
                    }
                }
            case .ended:
                defer {
                    activePage = nil
                    activePageIndex = nil
                    shapeHoldWorkItem?.cancel()
                    shapeHoldWorkItem = nil
                    activeShapeFit = nil
                    lassoInteraction = nil
                    lassoMoveStartPoint = nil
                    lassoMoveStartStrokes = []
                    lassoMoveStartObjects = []
                    unlockPDFScrollingAfterActiveDrawing()
                }
                if tool == .lasso {
                    guard let page = activePage, let pageIndex = activePageIndex else {
                        pdfView.drawingOverlay.cancel()
                        return
                    }
                    switch lassoInteraction {
                    case .drawing:
                        pdfView.drawingOverlay.move(to: overlayPoint)
                        let overlayPoints = pdfView.drawingOverlay.finish()
                        let viewPoints = overlayPoints.map { pdfView.convert($0, from: pdfView.drawingOverlay) }
                        selectLassoContent(from: viewPoints, page: page, pageIndex: pageIndex)
                    case .moving:
                        updateLassoMove(to: viewPoint, page: page, commit: true)
                    case nil:
                        pdfView.drawingOverlay.cancel()
                    }
                    return
                }
                guard tool == .pen,
                      let page = activePage,
                      let pageIndex = activePageIndex else {
                    pdfView.drawingOverlay.cancel()
                    return
                }
                if activeShapeFit == nil {
                    pdfView.drawingOverlay.move(to: overlayPoint)
                }
                let overlayPoints = activeShapeFit?.points ?? pdfView.drawingOverlay.finish()
                if activeShapeFit != nil {
                    _ = pdfView.drawingOverlay.finish()
                }
                guard overlayPoints.count > 1 else { return }
                let viewPoints = overlayPoints.map { pdfView.convert($0, from: pdfView.drawingOverlay) }
                let stroke = makeStroke(from: viewPoints, page: page, tool: activeShapeFit.map { "shape:\($0.kind)" } ?? "pen")
                addInkPreview(stroke, to: page)
                if shapeKind(for: stroke) != nil {
                    appendLocalStroke(pageIndex: pageIndex, stroke: stroke)
                    selectShapeStroke(stroke, pageIndex: pageIndex)
                    applyCodmesInkAnnotations()
                    applyAnnotationsToVisibleOverlays()
                }
                onStrokeFinished(pageIndex, stroke)
            case .cancelled, .failed:
                pdfView.drawingOverlay.cancel()
                activePage = nil
                activePageIndex = nil
                shapeHoldWorkItem?.cancel()
                shapeHoldWorkItem = nil
                activeShapeFit = nil
                lassoInteraction = nil
                lassoMoveStartPoint = nil
                lassoMoveStartStrokes = []
                lassoMoveStartObjects = []
                unlockPDFScrollingAfterActiveDrawing()
            default:
                break
            }
        }

        @objc func handlePDFTap(_ gesture: UITapGestureRecognizer) {
            guard gesture.state == .ended,
                  isWritingMode,
                  tool == .lasso,
                  let selection = lassoSelection,
                  let pdfView else { return }
            let viewPoint = gesture.location(in: pdfView)
            guard let page = pdfView.page(for: viewPoint, nearest: true),
                  let document = pdfView.document else {
                clearLassoSelection()
                return
            }
            let pageIndex = document.index(for: page)
            guard pageIndex == selection.pageIndex else {
                clearLassoSelection()
                return
            }
            let normalized = normalizedPoint(from: viewPoint, page: page)
            if !contains(normalized, in: selection.bounds) {
                clearLassoSelection()
            }
        }

        private func lockPDFScrollingForActiveDrawing() {
            guard isWritingMode,
                  tool == .pen || tool == .eraser || tool == .lasso,
                  let pdfView else { return }
            didLockScrollForDrawing = true
            for scrollView in pdfView.descendantScrollViews {
                scrollView.isScrollEnabled = false
            }
        }

        private func unlockPDFScrollingAfterActiveDrawing() {
            guard didLockScrollForDrawing else { return }
            didLockScrollForDrawing = false
            pdfView?.descendantScrollViews.forEach { $0.isScrollEnabled = true }
            applyPDFScrollTouchPolicy()
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            if gestureRecognizer === clearSelectionTapGesture {
                return isWritingMode && tool == .lasso && lassoSelection != nil
            }
            if touch.view?.isInShapeHandleHierarchy == true {
                return false
            }
            guard isWritingMode, tool == .pen || tool == .eraser || tool == .lasso else { return false }
            if UIDevice.current.userInterfaceIdiom == .pad {
                return touch.type == .pencil
            }
            return true
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            false
        }

        private func scheduleShapeHoldFit(page: PDFPage) {
            guard tool == .pen, let pdfView else { return }
            let workItem = DispatchWorkItem { [weak self, weak pdfView, weak page] in
                guard let self,
                      let pdfView,
                      let page,
                      self.tool == .pen,
                      self.activePage === page else { return }
                let now = ProcessInfo.processInfo.systemUptime
                if now - self.lastPenPointTime < 0.5 {
                    self.scheduleShapeHoldFit(page: page)
                    return
                }
                let overlayPoints = pdfView.drawingOverlay.points
                guard let fit = self.fitShape(from: overlayPoints) else { return }
                self.activeShapeFit = fit
                pdfView.drawingOverlay.replace(with: fit.points)
            }
            shapeHoldWorkItem?.cancel()
            shapeHoldWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: workItem)
        }

        private func fitShape(from points: [CGPoint]) -> ShapeFit? {
            let points = resampled(points, spacing: 4)
            guard points.count > 8, let bounds = pointBounds(points) else { return nil }
            let diagonal = max(hypot(bounds.width, bounds.height), 1)
            guard diagonal > 20 else { return nil }

            let lineScore = lineError(points, from: points[0], to: points[points.count - 1]) / diagonal
            if lineScore < 0.055 {
                return ShapeFit(kind: "line", points: [points[0], points[points.count - 1]])
            }

            let closedDistance = distance(points[0], points[points.count - 1])
            guard closedDistance / diagonal < 0.34 else { return nil }

            var candidates: [(fit: ShapeFit, score: CGFloat)] = []
            let vertices = polygonVertices(from: points, epsilon: diagonal * 0.075)
            if vertices.count == 3 {
                let triangle = vertices + [vertices[0]]
                candidates.append((ShapeFit(kind: "triangle", points: triangle), polylineError(points, candidate: triangle) / diagonal))
            }

            let rectPoints = [
                CGPoint(x: bounds.minX, y: bounds.minY),
                CGPoint(x: bounds.maxX, y: bounds.minY),
                CGPoint(x: bounds.maxX, y: bounds.maxY),
                CGPoint(x: bounds.minX, y: bounds.maxY),
                CGPoint(x: bounds.minX, y: bounds.minY)
            ]
            let rectangleScore = min(polylineError(points, candidate: rectPoints) / diagonal, 1 - edgeFitRatio(points, bounds: bounds))
            if rectangleScore < 0.32 {
                candidates.append((ShapeFit(kind: "rectangle", points: rectPoints), rectangleScore))
            }

            let ellipse = ellipsePoints(in: bounds, count: 48)
            let ellipseScore = ellipseFitError(points, bounds: bounds)
            if ellipseScore < 0.20 {
                candidates.append((ShapeFit(kind: "ellipse", points: ellipse), ellipseScore))
            }

            return candidates.min { $0.score < $1.score }?.fit
        }

        private func pointBounds(_ points: [CGPoint]) -> CGRect? {
            guard let first = points.first else { return nil }
            var minX = first.x
            var maxX = first.x
            var minY = first.y
            var maxY = first.y
            for point in points.dropFirst() {
                minX = min(minX, point.x)
                maxX = max(maxX, point.x)
                minY = min(minY, point.y)
                maxY = max(maxY, point.y)
            }
            return CGRect(x: minX, y: minY, width: max(1, maxX - minX), height: max(1, maxY - minY))
        }

        private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
            hypot(a.x - b.x, a.y - b.y)
        }

        private func lineError(_ points: [CGPoint], from start: CGPoint, to end: CGPoint) -> CGFloat {
            let denominator = max(distance(start, end), 1)
            return points.map { point in
                abs((end.x - start.x) * (start.y - point.y) - (start.x - point.x) * (end.y - start.y)) / denominator
            }.max() ?? .greatestFiniteMagnitude
        }

        private func edgeFitRatio(_ points: [CGPoint], bounds: CGRect) -> CGFloat {
            let tolerance = max(hypot(bounds.width, bounds.height) * 0.08, 4)
            let hits = points.filter { point in
                min(
                    abs(point.x - bounds.minX),
                    abs(point.x - bounds.maxX),
                    abs(point.y - bounds.minY),
                    abs(point.y - bounds.maxY)
                ) <= tolerance
            }
            return CGFloat(hits.count) / CGFloat(max(points.count, 1))
        }

        private func ellipseFitError(_ points: [CGPoint], bounds: CGRect) -> CGFloat {
            let rx = max(bounds.width / 2, 1)
            let ry = max(bounds.height / 2, 1)
            let center = CGPoint(x: bounds.midX, y: bounds.midY)
            let errors = points.map { point in
                abs(pow((point.x - center.x) / rx, 2) + pow((point.y - center.y) / ry, 2) - 1)
            }
            return errors.reduce(0, +) / CGFloat(max(errors.count, 1))
        }

        private func ellipsePoints(in bounds: CGRect, count: Int) -> [CGPoint] {
            let center = CGPoint(x: bounds.midX, y: bounds.midY)
            let rx = bounds.width / 2
            let ry = bounds.height / 2
            return (0...count).map { index in
                let angle = CGFloat(index) / CGFloat(count) * .pi * 2
                return CGPoint(x: center.x + cos(angle) * rx, y: center.y + sin(angle) * ry)
            }
        }

        private func resampled(_ points: [CGPoint], spacing: CGFloat) -> [CGPoint] {
            guard points.count > 2 else { return points }
            var result = [points[0]]
            var previous = points[0]
            var carry: CGFloat = 0
            for current in points.dropFirst() {
                let segment = distance(previous, current)
                guard segment > 0.001 else { continue }
                var traveled = spacing - carry
                while traveled <= segment {
                    let t = traveled / segment
                    result.append(CGPoint(
                        x: previous.x + (current.x - previous.x) * t,
                        y: previous.y + (current.y - previous.y) * t
                    ))
                    traveled += spacing
                }
                carry = max(0, segment - (traveled - spacing))
                previous = current
            }
            if result.last.map({ distance($0, points[points.count - 1]) > spacing * 0.5 }) != false {
                result.append(points[points.count - 1])
            }
            return result
        }

        private func polygonVertices(from points: [CGPoint], epsilon: CGFloat) -> [CGPoint] {
            guard points.count > 4 else { return points }
            var open = points
            if distance(open[0], open[open.count - 1]) < epsilon * 2 {
                open.removeLast()
            }
            guard open.count > 4 else { return open }
            let anchorIndex = open.indices.max { a, b in
                distance(open[a], open[0]) < distance(open[b], open[0])
            } ?? 0
            let rotated = Array(open[anchorIndex...]) + Array(open[..<anchorIndex]) + [open[anchorIndex]]
            return Array(simplify(rotated, epsilon: epsilon).dropLast())
        }

        private func polylineError(_ points: [CGPoint], candidate: [CGPoint]) -> CGFloat {
            guard candidate.count > 1 else { return .greatestFiniteMagnitude }
            let total = points.reduce(CGFloat(0)) { sum, point in
                sum + distanceToPolyline(point, candidate: candidate)
            }
            return total / CGFloat(max(points.count, 1))
        }

        private func distanceToPolyline(_ point: CGPoint, candidate: [CGPoint]) -> CGFloat {
            var best = CGFloat.greatestFiniteMagnitude
            for index in 0..<(candidate.count - 1) {
                best = min(best, distance(point, toSegmentStart: candidate[index], end: candidate[index + 1]))
            }
            return best
        }

        private func distance(_ point: CGPoint, toSegmentStart start: CGPoint, end: CGPoint) -> CGFloat {
            let dx = end.x - start.x
            let dy = end.y - start.y
            let lengthSquared = dx * dx + dy * dy
            guard lengthSquared > 0.001 else { return distance(point, start) }
            let t = max(0, min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
            return distance(point, CGPoint(x: start.x + dx * t, y: start.y + dy * t))
        }

        private func simplify(_ points: [CGPoint], epsilon: CGFloat) -> [CGPoint] {
            guard points.count > 2 else { return points }
            var maxDistance: CGFloat = 0
            var index = 0
            for offset in 1..<(points.count - 1) {
                let candidate = lineError([points[offset]], from: points[0], to: points[points.count - 1])
                if candidate > maxDistance {
                    maxDistance = candidate
                    index = offset
                }
            }
            if maxDistance > epsilon {
                let left = simplify(Array(points[0...index]), epsilon: epsilon)
                let right = simplify(Array(points[index..<points.count]), epsilon: epsilon)
                return Array(left.dropLast()) + right
            }
            return [points[0], points[points.count - 1]]
        }

        private func makeStroke(from points: [CGPoint], page: PDFPage, tool: String = "pen") -> CodmesInkStroke {
            let bounds = page.bounds(for: .mediaBox)
            let normalizedPoints = points.enumerated().map { offset, point in
                normalizedPoint(from: point, page: page, timeOffset: Double(offset) * 0.008, pageBounds: bounds)
            }
            return CodmesInkStroke(
                id: UUID().uuidString,
                tool: tool,
                color: penColorHex,
                width: penWidth / max(Double(pdfView?.scaleFactor ?? 1), 0.001),
                opacity: nil,
                points: normalizedPoints
            )
        }

        private func normalizedPoint(from viewPoint: CGPoint, page: PDFPage, timeOffset: Double? = nil, pageBounds: CGRect? = nil) -> CodmesInkPoint {
            guard let pdfView else { return CodmesInkPoint(x: 0, y: 0, pressure: nil, timeOffset: timeOffset) }
            let pagePoint = pdfView.convert(viewPoint, to: page)
            let bounds = pageBounds ?? page.bounds(for: .mediaBox)
            let x = min(max((pagePoint.x - bounds.minX) / max(bounds.width, 1), 0), 1)
            let y = min(max(1 - ((pagePoint.y - bounds.minY) / max(bounds.height, 1)), 0), 1)
            return CodmesInkPoint(x: x, y: y, pressure: nil, timeOffset: timeOffset)
        }

        private func pagePoint(_ point: CodmesInkPoint, pageBounds: CGRect) -> CGPoint {
            CGPoint(
                x: pageBounds.minX + pageBounds.width * point.x,
                y: pageBounds.minY + pageBounds.height * (1 - point.y)
            )
        }

        private func addInkPreview(_ stroke: CodmesInkStroke, to page: PDFPage, contentsPrefix: String = "codmes-ink-live", selected: Bool = false) {
            guard stroke.points.count > 1 else { return }
            let bounds = page.bounds(for: .mediaBox)
            let annotation = PDFAnnotation(bounds: bounds, forType: .ink, withProperties: nil)
            annotation.contents = "\(contentsPrefix):\(stroke.id)"
            annotation.color = selected ? .systemOrange : UIColor(hexString: stroke.color)
            let border = PDFBorder()
            border.lineWidth = CGFloat(max(0.5, stroke.width + (selected ? 1.5 : 0)))
            annotation.border = border
            let path = UIBezierPath()
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            path.lineWidth = CGFloat(max(0.5, stroke.width + (selected ? 1.5 : 0)))
            path.move(to: pagePoint(stroke.points[0], pageBounds: bounds))
            for point in stroke.points.dropFirst() {
                path.addLine(to: pagePoint(point, pageBounds: bounds))
            }
            annotation.add(path)
            page.addAnnotation(annotation)
        }

        private func eraseStroke(at viewPoint: CGPoint, page: PDFPage) {
            guard let pdfView, let document = pdfView.document, let annotations else { return }
            let pageIndex = document.index(for: page)
            guard pageIndex >= 0,
                  let annotationPage = annotations.pages.first(where: { $0.pageIndex == pageIndex }),
                  let strokes = annotationPage.inkStrokes,
                  !strokes.isEmpty else { return }
            let normalized = normalizedPoint(from: viewPoint, page: page)
            let pageBounds = page.bounds(for: .mediaBox)
            let threshold = max(0.004, eraserWidth / Double(max(min(pageBounds.width, pageBounds.height), 1)))
            let kept = splitStrokes(strokes, erasingAt: normalized, threshold: threshold)
            guard kept.map(\.id) != strokes.map(\.id) || kept.count != strokes.count else { return }
            onStrokesChanged(pageIndex, kept)
        }

        private func strokes(for pageIndex: Int) -> [CodmesInkStroke] {
            annotations?.pages.first(where: { $0.pageIndex == pageIndex })?.inkStrokes ?? []
        }

        private func selectLassoContent(from viewPoints: [CGPoint], page: PDFPage, pageIndex: Int) {
            guard viewPoints.count > 2 else {
                clearLassoSelection()
                return
            }
            let polygon = viewPoints.map { normalizedPoint(from: $0, page: page) }
            guard let bounds = bounds(for: polygon) else {
                clearLassoSelection()
                return
            }
            let selectedStrokeIds = Set(strokes(for: pageIndex).filter { stroke in
                stroke.points.contains { contains($0, in: polygon) }
            }.map(\.id))
            let selectedObjects = objects(for: pageIndex).filter { object in
                guard let box = object.bbox?.normalizedOrSelf else { return false }
                return objectIntersectsLasso(box: box, polygon: polygon, lassoBounds: bounds)
            }
            let selectedObjectIds = Set(selectedObjects.map(\.id))

            guard !selectedStrokeIds.isEmpty || !selectedObjectIds.isEmpty else {
                clearLassoSelection()
                return
            }

            lassoSelection = LassoSelection(
                pageIndex: pageIndex,
                strokeIds: selectedStrokeIds,
                objectIds: selectedObjectIds,
                bounds: bounds
            )
            notifyLassoSelectionChanged()
            if let firstObject = selectedObjects.first {
                selectedObjectId = firstObject.id
                onObjectSelected(firstObject)
            }
            applyCodmesInkAnnotations()
            applyAnnotationsToVisibleOverlays()
        }

        private func updateLassoMove(to viewPoint: CGPoint, page: PDFPage, commit: Bool) {
            guard let selection = lassoSelection,
                  selection.pageIndex == activePageIndex,
                  let start = lassoMoveStartPoint else { return }
            let current = normalizedPoint(from: viewPoint, page: page)
            let dx = current.x - start.x
            let dy = current.y - start.y
            let movedStrokes = lassoMoveStartStrokes.map { offset(stroke: $0, dx: dx, dy: dy) }
            let movedObjects = lassoMoveStartObjects.map { offset(object: $0, dx: dx, dy: dy) }
            guard let selectionBounds = selection.bounds.normalizedOrSelf else { return }
            let nextBounds = offset(box: selectionBounds, dx: dx, dy: dy)

            replaceLocalStrokes(pageIndex: selection.pageIndex, movedStrokes: movedStrokes, selectedIds: selection.strokeIds)
            replaceLocalObjects(movedObjects)
            lassoSelection = LassoSelection(
                pageIndex: selection.pageIndex,
                strokeIds: selection.strokeIds,
                objectIds: selection.objectIds,
                bounds: AnnotationBoundingBox(x: nextBounds.x, y: nextBounds.y, width: nextBounds.width, height: nextBounds.height, normalized: nil)
            )
            notifyLassoSelectionChanged(isMoving: !commit)
            applyCodmesInkAnnotations()
            applyAnnotationsToVisibleOverlays()

            if commit {
                notifyLassoSelectionChanged(isMoving: false)
                onStrokesChanged(selection.pageIndex, strokes(for: selection.pageIndex))
                for object in movedObjects {
                    onObjectChanged(object)
                }
            }
        }

        private func clearLassoSelection(notify: Bool = true) {
            lassoSelection = nil
            selectedObjectId = nil
            if notify {
                onLassoSelectionChanged(nil)
            }
            applyCodmesInkAnnotations()
            applyAnnotationsToVisibleOverlays()
        }

        private func notifyLassoSelectionChanged(isMoving: Bool = false) {
            guard let lassoSelection else {
                onLassoSelectionChanged(nil)
                return
            }
            onLassoSelectionChanged(PDFLassoSelectionSummary(
                pageIndex: lassoSelection.pageIndex,
                strokeIds: lassoSelection.strokeIds,
                objectIds: lassoSelection.objectIds,
                optionAnchor: optionAnchor(for: lassoSelection),
                isMoving: isMoving
            ))
        }

        private func optionAnchor(for selection: LassoSelection) -> CGPoint? {
            guard let pdfView,
                  let page = pdfView.document?.page(at: selection.pageIndex),
                  let box = selection.bounds.normalizedOrSelf else { return nil }
            let pageBounds = page.bounds(for: .mediaBox)
            let topLeft = CGPoint(
                x: pageBounds.minX + pageBounds.width * box.x,
                y: pageBounds.minY + pageBounds.height * (1 - box.y)
            )
            let bottomRight = CGPoint(
                x: pageBounds.minX + pageBounds.width * (box.x + box.width),
                y: pageBounds.minY + pageBounds.height * (1 - box.y - box.height)
            )
            let viewTopLeft = pdfView.convert(topLeft, from: page)
            let viewBottomRight = pdfView.convert(bottomRight, from: page)
            let rect = CGRect(
                x: min(viewTopLeft.x, viewBottomRight.x),
                y: min(viewTopLeft.y, viewBottomRight.y),
                width: abs(viewBottomRight.x - viewTopLeft.x),
                height: abs(viewBottomRight.y - viewTopLeft.y)
            )
            return CGPoint(x: rect.midX, y: rect.minY - 22)
        }

        private func applyShapeHandles(to overlay: PDFPageAnnotationOverlay, pageIndex: Int) {
            for handle in overlay.shapeHandleViews {
                handle.removeFromSuperview()
            }
            overlay.shapeHandleViews.removeAll()
            overlay.shapePreviewLayer.path = nil

            guard isWritingMode,
                  let selected = selectedShapeStroke(pageIndex: pageIndex) else { return }
            let stroke = selected.stroke
            let kind = selected.kind

            for (handleIndex, point) in shapeHandlePoints(for: stroke, kind: kind, in: overlay.bounds) {
                let handle = PDFShapeHandleView(strokeId: stroke.id, kind: kind, handleIndex: handleIndex)
                handle.center = point
                handle.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(handleShapeHandlePan(_:))))
                overlay.addSubview(handle)
                overlay.bringSubviewToFront(handle)
                overlay.shapeHandleViews.append(handle)
            }
        }

        private func updateShapeLayerPreview(_ stroke: CodmesInkStroke, in overlay: PDFPageAnnotationOverlay) {
            guard stroke.points.count > 1 else {
                overlay.shapePreviewLayer.path = nil
                return
            }
            let path = UIBezierPath()
            path.move(to: overlayPoint(stroke.points[0], in: overlay.bounds))
            for point in stroke.points.dropFirst() {
                path.addLine(to: overlayPoint(point, in: overlay.bounds))
            }
            overlay.shapePreviewLayer.path = path.cgPath
            overlay.shapePreviewLayer.strokeColor = UIColor(hexString: stroke.color).cgColor
            overlay.shapePreviewLayer.lineWidth = CGFloat(max(0.5, stroke.width + 1.5))
            overlay.shapePreviewLayer.opacity = 1
        }

        private func overlayPoint(_ point: CodmesInkPoint, in bounds: CGRect) -> CGPoint {
            CGPoint(x: bounds.width * point.x, y: bounds.height * point.y)
        }

        private func selectedShapeStroke(pageIndex: Int?) -> (stroke: CodmesInkStroke, kind: String)? {
            guard let pageIndex,
                  let selection = lassoSelection,
                  selection.pageIndex == pageIndex,
                  selection.strokeIds.count == 1,
                  let strokeId = selection.strokeIds.first,
                  let stroke = strokes(for: pageIndex).first(where: { $0.id == strokeId }),
                  let kind = shapeKind(for: stroke) else { return nil }
            return (stroke, kind)
        }

        private func shapeKind(for stroke: CodmesInkStroke) -> String? {
            guard stroke.tool.hasPrefix("shape:") else { return nil }
            return String(stroke.tool.dropFirst("shape:".count))
        }

        private func shapeHandlePoints(for stroke: CodmesInkStroke, kind: String, in bounds: CGRect) -> [(Int, CGPoint)] {
            func viewPoint(_ point: CodmesInkPoint) -> CGPoint {
                CGPoint(x: bounds.width * point.x, y: bounds.height * point.y)
            }

            switch kind {
            case "line":
                guard let first = stroke.points.first, let last = stroke.points.last else { return [] }
                return [(0, viewPoint(first)), (1, viewPoint(last))]
            case "rectangle":
                return stroke.points.prefix(4).enumerated().map { ($0.offset, viewPoint($0.element)) }
            case "triangle":
                return stroke.points.prefix(3).enumerated().map { ($0.offset, viewPoint($0.element)) }
            case "ellipse":
                guard let box = normalizedBounds(for: stroke.points) else { return [] }
                return [
                    (0, CGPoint(x: bounds.width * (box.x + box.width / 2), y: bounds.height * box.y)),
                    (1, CGPoint(x: bounds.width * (box.x + box.width), y: bounds.height * (box.y + box.height / 2))),
                    (2, CGPoint(x: bounds.width * (box.x + box.width / 2), y: bounds.height * (box.y + box.height))),
                    (3, CGPoint(x: bounds.width * box.x, y: bounds.height * (box.y + box.height / 2)))
                ]
            default:
                return []
            }
        }

        @objc private func handleShapeHandlePan(_ gesture: UIPanGestureRecognizer) {
            guard let handle = gesture.view as? PDFShapeHandleView,
                  let overlay = handle.superview as? PDFPageAnnotationOverlay,
                  let selection = lassoSelection,
                  selection.strokeIds.contains(handle.strokeId),
                  var stroke = strokes(for: selection.pageIndex).first(where: { $0.id == handle.strokeId }) else { return }

            let location = gesture.location(in: overlay)
            let normalized = CodmesInkPoint(
                x: Double(max(0, min(overlay.bounds.width, location.x)) / max(overlay.bounds.width, 1)),
                y: Double(max(0, min(overlay.bounds.height, location.y)) / max(overlay.bounds.height, 1)),
                pressure: nil,
                timeOffset: nil
            )
            stroke = updateShapeStroke(stroke, kind: handle.kind, handleIndex: handle.handleIndex, to: normalized)
            replaceLocalStrokes(pageIndex: selection.pageIndex, movedStrokes: [stroke], selectedIds: [stroke.id])
            if gesture.state == .began,
               let pdfView,
               let page = pdfView.document?.page(at: selection.pageIndex) {
                removeCodmesInkAnnotation(id: stroke.id, from: page)
            }
            if let nextBounds = bounds(for: stroke.points) {
                lassoSelection = LassoSelection(
                    pageIndex: selection.pageIndex,
                    strokeIds: selection.strokeIds,
                    objectIds: selection.objectIds,
                    bounds: nextBounds
                )
            }
            handle.center = location
            updateShapeLayerPreview(stroke, in: overlay)

            if gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed {
                overlay.shapePreviewLayer.path = nil
                notifyLassoSelectionChanged()
                onStrokesChanged(selection.pageIndex, strokes(for: selection.pageIndex))
                applyCodmesInkAnnotations()
                applyAnnotationsToVisibleOverlays()
            }
        }

        private func updateShapeStroke(_ stroke: CodmesInkStroke, kind: String, handleIndex: Int, to point: CodmesInkPoint) -> CodmesInkStroke {
            var next = stroke
            switch kind {
            case "line":
                guard next.points.count >= 2 else { return next }
                if handleIndex == 0 {
                    next.points[0] = point
                } else {
                    next.points[next.points.count - 1] = point
                }
            case "triangle":
                guard next.points.count >= 4, handleIndex < 3 else { return next }
                next.points[handleIndex] = point
                if handleIndex == 0 {
                    next.points[next.points.count - 1] = point
                }
            case "rectangle":
                guard let box = normalizedBounds(for: next.points) else { return next }
                let opposite: CodmesInkPoint
                switch handleIndex {
                case 0:
                    opposite = CodmesInkPoint(x: box.x + box.width, y: box.y + box.height, pressure: nil, timeOffset: nil)
                case 1:
                    opposite = CodmesInkPoint(x: box.x, y: box.y + box.height, pressure: nil, timeOffset: nil)
                case 2:
                    opposite = CodmesInkPoint(x: box.x, y: box.y, pressure: nil, timeOffset: nil)
                default:
                    opposite = CodmesInkPoint(x: box.x + box.width, y: box.y, pressure: nil, timeOffset: nil)
                }
                next.points = rectanglePoints(from: point, to: opposite)
            case "ellipse":
                guard let box = normalizedBounds(for: next.points) else { return next }
                var minX = box.x
                var maxX = box.x + box.width
                var minY = box.y
                var maxY = box.y + box.height
                switch handleIndex {
                case 0:
                    minY = point.y
                case 1:
                    maxX = point.x
                case 2:
                    maxY = point.y
                default:
                    minX = point.x
                }
                next.points = ellipsePoints(in: normalizedBox(minX: minX, minY: minY, maxX: maxX, maxY: maxY), count: 48)
            default:
                break
            }
            return next
        }

        private func normalizedBounds(for points: [CodmesInkPoint]) -> NormalizedBoundingBox? {
            guard let first = points.first else { return nil }
            var minX = first.x
            var maxX = first.x
            var minY = first.y
            var maxY = first.y
            for point in points.dropFirst() {
                minX = min(minX, point.x)
                maxX = max(maxX, point.x)
                minY = min(minY, point.y)
                maxY = max(maxY, point.y)
            }
            return normalizedBox(minX: minX, minY: minY, maxX: maxX, maxY: maxY)
        }

        private func normalizedBox(minX: Double, minY: Double, maxX: Double, maxY: Double) -> NormalizedBoundingBox {
            let left = max(0, min(1, min(minX, maxX)))
            let right = max(0, min(1, max(minX, maxX)))
            let top = max(0, min(1, min(minY, maxY)))
            let bottom = max(0, min(1, max(minY, maxY)))
            return NormalizedBoundingBox(
                x: left,
                y: top,
                width: max(0.01, right - left),
                height: max(0.01, bottom - top)
            )
        }

        private func rectanglePoints(from point: CodmesInkPoint, to opposite: CodmesInkPoint) -> [CodmesInkPoint] {
            let box = normalizedBox(minX: point.x, minY: point.y, maxX: opposite.x, maxY: opposite.y)
            let topLeft = CodmesInkPoint(x: box.x, y: box.y, pressure: nil, timeOffset: nil)
            let topRight = CodmesInkPoint(x: box.x + box.width, y: box.y, pressure: nil, timeOffset: nil)
            let bottomRight = CodmesInkPoint(x: box.x + box.width, y: box.y + box.height, pressure: nil, timeOffset: nil)
            let bottomLeft = CodmesInkPoint(x: box.x, y: box.y + box.height, pressure: nil, timeOffset: nil)
            return [topLeft, topRight, bottomRight, bottomLeft, topLeft]
        }

        private func ellipsePoints(in box: NormalizedBoundingBox, count: Int) -> [CodmesInkPoint] {
            let centerX = box.x + box.width / 2
            let centerY = box.y + box.height / 2
            let rx = box.width / 2
            let ry = box.height / 2
            return (0...count).map { index in
                let angle = Double(index) / Double(count) * Double.pi * 2
                return CodmesInkPoint(
                    x: centerX + cos(angle) * rx,
                    y: centerY + sin(angle) * ry,
                    pressure: nil,
                    timeOffset: nil
                )
            }
        }

        private func appendLocalStroke(pageIndex: Int, stroke: CodmesInkStroke) {
            var next = annotations ?? PDFAnnotationDocument(schemaVersion: 1, documentPath: "", updatedAt: nil, pages: [], objects: [])
            if let index = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
                var strokes = next.pages[index].inkStrokes ?? []
                if !strokes.contains(where: { $0.id == stroke.id }) {
                    strokes.append(stroke)
                }
                next.pages[index].inkStrokes = strokes
            } else {
                next.pages.append(PDFAnnotationPage(pageIndex: pageIndex, inkDataBase64: nil, inkStrokes: [stroke], objects: []))
                next.pages.sort { $0.pageIndex < $1.pageIndex }
            }
            annotations = next
        }

        private func selectShapeStroke(_ stroke: CodmesInkStroke, pageIndex: Int) {
            guard shapeKind(for: stroke) != nil,
                  let strokeBounds = bounds(for: stroke.points) else { return }
            lassoSelection = LassoSelection(
                pageIndex: pageIndex,
                strokeIds: [stroke.id],
                objectIds: [],
                bounds: strokeBounds
            )
            notifyLassoSelectionChanged()
            applyToolToVisibleOverlays()
        }

        private func replaceLocalStrokes(pageIndex: Int, movedStrokes: [CodmesInkStroke], selectedIds: Set<String>) {
            var next = annotations ?? PDFAnnotationDocument(schemaVersion: 1, documentPath: "", updatedAt: nil, pages: [], objects: [])
            let movedById = Dictionary(uniqueKeysWithValues: movedStrokes.map { ($0.id, $0) })
            if let index = next.pages.firstIndex(where: { $0.pageIndex == pageIndex }) {
                let current = next.pages[index].inkStrokes ?? []
                next.pages[index].inkStrokes = current.map { selectedIds.contains($0.id) ? (movedById[$0.id] ?? $0) : $0 }
            }
            annotations = next
        }

        private func replaceLocalObjects(_ movedObjects: [PDFAnnotationObject]) {
            guard !movedObjects.isEmpty else { return }
            var next = annotations ?? PDFAnnotationDocument(schemaVersion: 1, documentPath: "", updatedAt: nil, pages: [], objects: [])
            let movedById = Dictionary(uniqueKeysWithValues: movedObjects.map { ($0.id, $0) })
            for pageIndex in next.pages.indices {
                guard var objects = next.pages[pageIndex].objects else { continue }
                objects = objects.map { movedById[$0.id] ?? $0 }
                next.pages[pageIndex].objects = objects
            }
            next.objects = next.objects.map { movedById[$0.id] ?? $0 }
            annotations = next
        }

        private func bounds(for points: [CodmesInkPoint]) -> AnnotationBoundingBox? {
            guard let first = points.first else { return nil }
            var minX = first.x
            var maxX = first.x
            var minY = first.y
            var maxY = first.y
            for point in points.dropFirst() {
                minX = min(minX, point.x)
                maxX = max(maxX, point.x)
                minY = min(minY, point.y)
                maxY = max(maxY, point.y)
            }
            return AnnotationBoundingBox(
                x: minX,
                y: minY,
                width: max(0.01, maxX - minX),
                height: max(0.01, maxY - minY),
                normalized: nil
            )
        }

        private func contains(_ point: CodmesInkPoint, in box: AnnotationBoundingBox) -> Bool {
            guard let normalized = box.normalizedOrSelf else { return false }
            return point.x >= normalized.x &&
                point.x <= normalized.x + normalized.width &&
                point.y >= normalized.y &&
                point.y <= normalized.y + normalized.height
        }

        private func contains(_ point: CodmesInkPoint, in polygon: [CodmesInkPoint]) -> Bool {
            guard polygon.count > 2 else { return false }
            var inside = false
            var previous = polygon[polygon.count - 1]
            for current in polygon {
                let crosses = (current.y > point.y) != (previous.y > point.y)
                if crosses {
                    let denominator = previous.y - current.y
                    guard abs(denominator) > 0.000001 else {
                        previous = current
                        continue
                    }
                    let x = (previous.x - current.x) * (point.y - current.y) / denominator + current.x
                    if point.x < x {
                        inside.toggle()
                    }
                }
                previous = current
            }
            return inside
        }

        private func objectIntersectsLasso(box: NormalizedBoundingBox, polygon: [CodmesInkPoint], lassoBounds: AnnotationBoundingBox) -> Bool {
            let center = CodmesInkPoint(x: box.x + box.width / 2, y: box.y + box.height / 2, pressure: nil, timeOffset: nil)
            let corners = [
                CodmesInkPoint(x: box.x, y: box.y, pressure: nil, timeOffset: nil),
                CodmesInkPoint(x: box.x + box.width, y: box.y, pressure: nil, timeOffset: nil),
                CodmesInkPoint(x: box.x, y: box.y + box.height, pressure: nil, timeOffset: nil),
                CodmesInkPoint(x: box.x + box.width, y: box.y + box.height, pressure: nil, timeOffset: nil)
            ]
            return contains(center, in: polygon)
                || corners.contains { contains($0, in: polygon) }
                || (lassoBounds.normalizedOrSelf.map { boxesIntersect(box, $0) } ?? false)
        }

        private func boxesIntersect(_ a: NormalizedBoundingBox, _ b: NormalizedBoundingBox) -> Bool {
            a.x < b.x + b.width &&
                a.x + a.width > b.x &&
                a.y < b.y + b.height &&
                a.y + a.height > b.y
        }

        private func offset(stroke: CodmesInkStroke, dx: Double, dy: Double) -> CodmesInkStroke {
            var next = stroke
            next.points = stroke.points.map {
                CodmesInkPoint(
                    x: max(0, min(1, $0.x + dx)),
                    y: max(0, min(1, $0.y + dy)),
                    pressure: $0.pressure,
                    timeOffset: $0.timeOffset
                )
            }
            return next
        }

        private func offset(object: PDFAnnotationObject, dx: Double, dy: Double) -> PDFAnnotationObject {
            var next = object
            if let box = object.bbox?.normalizedOrSelf {
                let moved = offset(box: box, dx: dx, dy: dy)
                next.bbox = AnnotationBoundingBox(x: moved.x, y: moved.y, width: moved.width, height: moved.height, normalized: nil)
            }
            return next
        }

        private func offset(box: NormalizedBoundingBox, dx: Double, dy: Double) -> NormalizedBoundingBox {
            NormalizedBoundingBox(
                x: max(0, min(1 - box.width, box.x + dx)),
                y: max(0, min(1 - box.height, box.y + dy)),
                width: box.width,
                height: box.height
            )
        }

        private func applyAnnotation(to canvas: PKCanvasView, pageIndex: Int) {
            guard let drawing = annotationDrawing(pageIndex: pageIndex) else { return }
            let data = drawing.dataRepresentation()
            if canvas.drawing.dataRepresentation() == data { return }
            setDrawing(drawing, on: canvas)
        }

        private func annotationDrawing(pageIndex: Int) -> PKDrawing? {
            guard let encoded = annotations?.pages.first(where: { $0.pageIndex == pageIndex })?.inkDataBase64,
                  let data = Data(base64Encoded: encoded) else { return nil }
            return try? PKDrawing(data: data)
        }

        private func setDrawing(_ drawing: PKDrawing, on canvas: PKCanvasView) {
            applyingProgrammaticDrawing = true
            canvas.drawing = drawing
            applyingProgrammaticDrawing = false
        }

        private func objects(for pageIndex: Int) -> [PDFAnnotationObject] {
            var result = annotations?.objects.filter { $0.pageIndex == pageIndex } ?? []
            if let pageObjects = annotations?.pages.first(where: { $0.pageIndex == pageIndex })?.objects {
                result.append(contentsOf: pageObjects)
            }
            return result
        }

        private func applyObjects(to overlay: PDFPageAnnotationOverlay, pageIndex: Int) {
            let objects = objects(for: pageIndex)
            let liveIds = Set(objects.map(\.id))
            for (id, view) in overlay.objectViews where !liveIds.contains(id) {
                view.removeFromSuperview()
                overlay.objectViews[id] = nil
            }

            for object in objects {
                let view = overlay.objectViews[object.id] ?? makeObjectView(object: object, pageIndex: pageIndex)
                if overlay.objectViews[object.id] == nil {
                    overlay.objectViews[object.id] = view
                    overlay.addSubview(view)
                }
                configureObjectView(view, object: object)
                view.frame = frame(for: object.bbox, in: overlay.bounds)
                view.isUserInteractionEnabled = isWritingMode && tool == .lasso
                overlay.bringSubviewToFront(view)
            }
            if let selectedObjectId, let selected = overlay.objectViews[selectedObjectId] {
                overlay.bringSubviewToFront(selected)
            }
        }

        private func makeObjectView(object: PDFAnnotationObject, pageIndex: Int) -> UIView {
            let view: UIView
            if object.type.lowercased().contains("image"), let dataString = object.dataBase64,
               let data = Data(base64Encoded: dataString.replacingOccurrences(of: "^data:[^,]+,", with: "", options: .regularExpression)),
               let image = UIImage(data: data) {
                let imageView = UIImageView(image: image)
                imageView.contentMode = .scaleAspectFit
                imageView.backgroundColor = UIColor.secondarySystemBackground.withAlphaComponent(0.35)
                view = imageView
            } else {
                let label = UILabel()
                label.numberOfLines = 0
                label.textAlignment = .left
                label.font = .systemFont(ofSize: CGFloat(Double(object.metadata?["fontSize"] ?? "16") ?? 16), weight: .regular)
                label.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.78)
                label.textColor = .label
                label.layer.borderColor = UIColor.systemBlue.withAlphaComponent(0.45).cgColor
                label.layer.borderWidth = 1
                label.layer.cornerRadius = 6
                label.clipsToBounds = true
                view = label
            }
            view.layer.borderColor = UIColor.systemBlue.withAlphaComponent(0.45).cgColor
            view.layer.borderWidth = 1
            view.layer.cornerRadius = 6
            view.clipsToBounds = true
            view.accessibilityIdentifier = object.id
            addGestures(to: view, object: object, pageIndex: pageIndex)
            return view
        }

        private func configureObjectView(_ view: UIView, object: PDFAnnotationObject) {
            if let label = view as? UILabel {
                label.text = object.text ?? "Text"
                label.font = .systemFont(ofSize: CGFloat(Double(object.metadata?["fontSize"] ?? "16") ?? 16), weight: .regular)
                if let color = object.metadata?["color"] {
                    label.textColor = UIColor(hexString: color)
                } else {
                    label.textColor = .label
                }
            }
            let selected = object.id == selectedObjectId || lassoSelection?.objectIds.contains(object.id) == true
            view.layer.borderColor = selected ? UIColor.systemOrange.cgColor : UIColor.systemBlue.withAlphaComponent(0.45).cgColor
            view.layer.borderWidth = selected ? 2 : 1
            view.layer.shadowColor = selected ? UIColor.systemOrange.cgColor : UIColor.clear.cgColor
            view.layer.shadowOpacity = selected ? 0.25 : 0
            view.layer.shadowRadius = selected ? 8 : 0
        }

        private func addGestures(to view: UIView, object: PDFAnnotationObject, pageIndex: Int) {
            let pan = UIPanGestureRecognizer(target: self, action: #selector(handleObjectPan(_:)))
            let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handleObjectPinch(_:)))
            let tap = UITapGestureRecognizer(target: self, action: #selector(handleObjectTap(_:)))
            let selectTap = UITapGestureRecognizer(target: self, action: #selector(handleObjectSelect(_:)))
            let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleObjectLongPress(_:)))
            tap.numberOfTapsRequired = 2
            selectTap.numberOfTapsRequired = 1
            selectTap.require(toFail: tap)
            view.addGestureRecognizer(pan)
            view.addGestureRecognizer(pinch)
            view.addGestureRecognizer(tap)
            view.addGestureRecognizer(selectTap)
            view.addGestureRecognizer(longPress)
        }

        @objc private func handleObjectSelect(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view,
                  let id = view.accessibilityIdentifier,
                  let object = object(with: id) else { return }
            selectedObjectId = object.id
            if let pageIndex = object.pageIndex, let box = object.bbox {
                lassoSelection = LassoSelection(
                    pageIndex: pageIndex,
                    strokeIds: [],
                    objectIds: [object.id],
                    bounds: box
                )
                notifyLassoSelectionChanged()
            }
            onObjectSelected(object)
            applyAnnotationsToVisibleOverlays()
        }

        @objc private func handleObjectPan(_ gesture: UIPanGestureRecognizer) {
            guard let view = gesture.view, let overlay = view.superview as? PDFPageAnnotationOverlay,
                  let id = view.accessibilityIdentifier,
                  var object = object(with: id) else { return }
            selectedObjectId = object.id
            if let pageIndex = object.pageIndex, let box = object.bbox {
                lassoSelection = LassoSelection(
                    pageIndex: pageIndex,
                    strokeIds: [],
                    objectIds: [object.id],
                    bounds: box
                )
                notifyLassoSelectionChanged()
            }
            onObjectSelected(object)
            let translation = gesture.translation(in: overlay)
            view.center = CGPoint(x: view.center.x + translation.x, y: view.center.y + translation.y)
            gesture.setTranslation(.zero, in: overlay)
            if gesture.state == .ended || gesture.state == .cancelled {
                object.bbox = bbox(for: view.frame, in: overlay.bounds)
                if let pageIndex = object.pageIndex, let box = object.bbox {
                    lassoSelection = LassoSelection(
                        pageIndex: pageIndex,
                        strokeIds: [],
                        objectIds: [object.id],
                        bounds: box
                    )
                    notifyLassoSelectionChanged()
                }
                onObjectChanged(object)
            }
        }

        @objc private func handleObjectPinch(_ gesture: UIPinchGestureRecognizer) {
            guard let view = gesture.view, let overlay = view.superview as? PDFPageAnnotationOverlay,
                  let id = view.accessibilityIdentifier,
                  var object = object(with: id) else { return }
            selectedObjectId = object.id
            if let pageIndex = object.pageIndex, let box = object.bbox {
                lassoSelection = LassoSelection(
                    pageIndex: pageIndex,
                    strokeIds: [],
                    objectIds: [object.id],
                    bounds: box
                )
                notifyLassoSelectionChanged()
            }
            onObjectSelected(object)
            let scale = gesture.scale
            let center = view.center
            var frame = view.frame
            frame.size.width = max(34, min(overlay.bounds.width, frame.size.width * scale))
            frame.size.height = max(24, min(overlay.bounds.height, frame.size.height * scale))
            frame.origin.x = center.x - frame.size.width / 2
            frame.origin.y = center.y - frame.size.height / 2
            view.frame = frame
            gesture.scale = 1
            if gesture.state == .ended || gesture.state == .cancelled {
                object.bbox = bbox(for: view.frame, in: overlay.bounds)
                if let pageIndex = object.pageIndex, let box = object.bbox {
                    lassoSelection = LassoSelection(
                        pageIndex: pageIndex,
                        strokeIds: [],
                        objectIds: [object.id],
                        bounds: box
                    )
                    notifyLassoSelectionChanged()
                }
                onObjectChanged(object)
            }
        }

        @objc private func handleObjectTap(_ gesture: UITapGestureRecognizer) {
            guard let view = gesture.view, let id = view.accessibilityIdentifier,
                  var object = object(with: id), object.type.lowercased().contains("text") else { return }
            selectedObjectId = object.id
            if let pageIndex = object.pageIndex, let box = object.bbox {
                lassoSelection = LassoSelection(
                    pageIndex: pageIndex,
                    strokeIds: [],
                    objectIds: [object.id],
                    bounds: box
                )
                notifyLassoSelectionChanged()
            }
            onObjectSelected(object)
            let alert = UIAlertController(title: "Edit text", message: nil, preferredStyle: .alert)
            alert.addTextField { field in
                field.text = object.text
            }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
            alert.addAction(UIAlertAction(title: "Save", style: .default) { [weak self] _ in
                object.text = alert.textFields?.first?.text ?? object.text
                self?.onObjectChanged(object)
            })
            pdfView?.window?.rootViewController?.present(alert, animated: true)
        }

        @objc private func handleObjectLongPress(_ gesture: UILongPressGestureRecognizer) {
            guard gesture.state == .began,
                  let view = gesture.view,
                  let id = view.accessibilityIdentifier,
                  let object = object(with: id) else { return }
            let alert = UIAlertController(title: "Delete annotation?", message: nil, preferredStyle: .actionSheet)
            alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
                self?.onObjectDeleted(object)
            })
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
            if let popover = alert.popoverPresentationController {
                popover.sourceView = view
                popover.sourceRect = view.bounds
            }
            pdfView?.window?.rootViewController?.present(alert, animated: true)
        }

        private func object(with id: String) -> PDFAnnotationObject? {
            for page in annotations?.pages ?? [] {
                if let object = page.objects?.first(where: { $0.id == id }) {
                    return object
                }
            }
            return annotations?.objects.first(where: { $0.id == id })
        }

        private func frame(for bbox: AnnotationBoundingBox?, in bounds: CGRect) -> CGRect {
            guard let box = bbox?.normalizedOrSelf else {
                return CGRect(x: bounds.width * 0.2, y: bounds.height * 0.2, width: bounds.width * 0.36, height: bounds.height * 0.12)
            }
            return CGRect(
                x: bounds.width * box.x,
                y: bounds.height * box.y,
                width: max(28, bounds.width * box.width),
                height: max(22, bounds.height * box.height)
            )
        }

        private func bbox(for frame: CGRect, in bounds: CGRect) -> AnnotationBoundingBox {
            guard bounds.width > 0, bounds.height > 0 else {
                return AnnotationBoundingBox(x: 0, y: 0, width: 0, height: 0, normalized: nil)
            }
            return AnnotationBoundingBox(
                x: max(0, min(1, frame.minX / bounds.width)),
                y: max(0, min(1, frame.minY / bounds.height)),
                width: max(0.01, min(1, frame.width / bounds.width)),
                height: max(0.01, min(1, frame.height / bounds.height)),
                normalized: nil
            )
        }

        private func applyHighlight(to overlay: PDFPageAnnotationOverlay, pageIndex: Int) {
            highlightViews[pageIndex]?.removeFromSuperview()
            highlightViews[pageIndex] = nil
            guard let focus,
                  let page = focus.page,
                  page - 1 == pageIndex,
                  let box = focus.bbox?.normalizedOrSelf else { return }

            let highlight = UIView()
            highlight.isUserInteractionEnabled = false
            highlight.layer.borderColor = UIColor.systemYellow.withAlphaComponent(0.95).cgColor
            highlight.layer.borderWidth = 2
            highlight.backgroundColor = UIColor.systemYellow.withAlphaComponent(0.18)
            highlight.layer.cornerRadius = 3
            let bounds = overlay.bounds
            let frame = CGRect(
                x: bounds.width * box.x,
                y: bounds.height * box.y,
                width: max(12, bounds.width * box.width),
                height: max(10, bounds.height * box.height)
            )
            highlight.frame = frame
            overlay.addSubview(highlight)
            highlightViews[pageIndex] = highlight
        }
    }
}

private struct PDFAnnotationInspectorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var draft: PDFAnnotationObject
    var onChange: (PDFAnnotationObject) -> Void
    var onDuplicate: (PDFAnnotationObject) -> Void
    var onDelete: (PDFAnnotationObject) -> Void
    var onLayerAction: (PDFAnnotationObject, PDFLayerAction) -> Void

    init(
        object: PDFAnnotationObject,
        onChange: @escaping (PDFAnnotationObject) -> Void,
        onDuplicate: @escaping (PDFAnnotationObject) -> Void,
        onDelete: @escaping (PDFAnnotationObject) -> Void,
        onLayerAction: @escaping (PDFAnnotationObject, PDFLayerAction) -> Void
    ) {
        self._draft = State(initialValue: object)
        self.onChange = onChange
        self.onDuplicate = onDuplicate
        self.onDelete = onDelete
        self.onLayerAction = onLayerAction
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Object") {
                    LabeledContent("Type", value: draft.type.capitalized)
                    LabeledContent("Page", value: String((draft.pageIndex ?? 0) + 1))
                    if let box = draft.bbox?.normalizedOrSelf {
                        LabeledContent("Position", value: "x \(percent(box.x)), y \(percent(box.y))")
                        LabeledContent("Size", value: "\(percent(box.width)) x \(percent(box.height))")
                    }
                }

                if draft.type.lowercased().contains("text") {
                    Section("Text") {
                        TextEditor(text: Binding(
                            get: { draft.text ?? "" },
                            set: {
                                draft.text = $0
                                commit()
                            }
                        ))
                        .frame(minHeight: 90)

                        Stepper(value: fontSizeBinding, in: 8...48, step: 1) {
                            Text("Font size \(Int(fontSizeBinding.wrappedValue))")
                        }
                    }
                }

                Section("Layer") {
                    HStack {
                        Button("Back") { onLayerAction(draft, .back) }
                        Button("Backward") { onLayerAction(draft, .backward) }
                        Button("Forward") { onLayerAction(draft, .forward) }
                        Button("Front") { onLayerAction(draft, .front) }
                    }
                    .buttonStyle(.borderless)
                }

                Section("Actions") {
                    Button {
                        onDuplicate(draft)
                    } label: {
                        Label("Duplicate", systemImage: "plus.square.on.square")
                    }

                    Button(role: .destructive) {
                        onDelete(draft)
                        dismiss()
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
            .navigationTitle("Annotation")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var fontSizeBinding: Binding<Double> {
        Binding(
            get: { Double(draft.metadata?["fontSize"] ?? "16") ?? 16 },
            set: {
                var metadata = draft.metadata ?? [:]
                metadata["fontSize"] = String(Int($0))
                draft.metadata = metadata
                commit()
            }
        )
    }

    private func commit() {
        onChange(draft)
    }

    private func percent(_ value: Double) -> String {
        "\(Int((value * 100).rounded()))%"
    }
}

private struct PDFExportOptionsView: View {
    @Binding var includeAnnotations: Bool
    @Binding var pageRange: String
    let isExporting: Bool
    let onExportPDF: () -> Void
    let onExportCodmesState: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Toggle("Include annotations", isOn: $includeAnnotations)
                    .font(.headline)

                TextField("Pages, for example 1-3, 5", text: $pageRange)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.numbersAndPunctuation)
                    .textFieldStyle(.roundedBorder)

                Button {
                    onExportPDF()
                } label: {
                    Label(includeAnnotations ? "Export annotated PDF" : "Export original PDF", systemImage: "doc.richtext")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isExporting)

                Button {
                    onExportCodmesState()
                } label: {
                    Label("Export PDF + Codmes state", systemImage: "shippingbox")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
                .disabled(isExporting)

                Text("Leave pages empty to export the full PDF. Codmes state exports a portable folder with separate PDF and Codmes state sections, so another Codmes workspace can restore editable handwriting, text boxes, and image objects.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Spacer(minLength: 0)
            }
            .padding()
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct PDFShareSheet: UIViewControllerRepresentable {
    let urls: [URL]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: urls, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private func replaceFileCopy(from sourceURL: URL, to targetURL: URL) throws {
    let manager = FileManager.default
    if manager.fileExists(atPath: targetURL.path) {
        try manager.removeItem(at: targetURL)
    }
    try manager.copyItem(at: sourceURL, to: targetURL)
}

private func parsePDFPageRange(_ value: String) -> [Int] {
    let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !cleaned.isEmpty else { return [] }
    var pages = Set<Int>()
    for token in cleaned.split(separator: ",") {
        let part = String(token).trimmingCharacters(in: .whitespacesAndNewlines)
        if part.contains("-") {
            let bounds = part.split(separator: "-", maxSplits: 1).compactMap {
                Int(String($0).trimmingCharacters(in: .whitespaces))
            }
            guard bounds.count == 2 else { continue }
            let lower = max(1, min(bounds[0], bounds[1]))
            let upper = max(bounds[0], bounds[1])
            for page in lower...upper {
                pages.insert(page - 1)
            }
        } else if let page = Int(part), page > 0 {
            pages.insert(page - 1)
        }
    }
    return pages.sorted()
}

private func normalizedPageIndexes(_ requested: [Int], pageCount: Int) -> [Int] {
    let valid = requested.filter { $0 >= 0 && $0 < pageCount }
    if valid.isEmpty {
        return Array(0..<max(0, pageCount))
    }
    return Array(NSOrderedSet(array: valid).array.compactMap { $0 as? Int })
}

private func copyPDFDocument(_ source: PDFDocument, pageIndexes: [Int]) throws -> PDFDocument {
    let output = PDFDocument()
    for (offset, index) in pageIndexes.enumerated() {
        guard index >= 0, index < source.pageCount,
              let page = source.page(at: index)?.copy() as? PDFPage else { continue }
        output.insert(page, at: offset)
    }
    if output.pageCount == 0 {
        throw CocoaError(.fileNoSuchFile)
    }
    return output
}

private func codmesStrokes(from drawing: PKDrawing, canvasSize: CGSize) -> [CodmesInkStroke] {
    let width = max(canvasSize.width, 1)
    let height = max(canvasSize.height, 1)
    return drawing.strokes.compactMap { stroke in
        let points = stroke.path.map { point in
            CodmesInkPoint(
                x: min(max(Double(point.location.x / width), 0), 1),
                y: min(max(Double(point.location.y / height), 0), 1),
                pressure: Double(point.force),
                timeOffset: point.timeOffset
            )
        }
        guard !points.isEmpty else { return nil }
        return CodmesInkStroke(
            id: UUID().uuidString,
            tool: stroke.ink.inkType.rawValue,
            color: hexColor(stroke.ink.color),
            width: Double(points.count > 1 ? stroke.renderBounds.width / CGFloat(points.count) : stroke.renderBounds.width),
            opacity: nil,
            points: points
        )
    }
}

private func hexColor(_ color: UIColor) -> String {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
        return "#000000"
    }
    return String(
        format: "#%02X%02X%02X",
        Int(red * 255),
        Int(green * 255),
        Int(blue * 255)
    )
}

private extension PDFAnnotationDocument {
    func sliced(to pageIndexes: [Int], documentPath: String) -> PDFAnnotationDocument {
        let mapping = Dictionary(uniqueKeysWithValues: pageIndexes.enumerated().map { ($0.element, $0.offset) })
        var nextPages: [PDFAnnotationPage] = []
        for page in pages {
            guard let mappedIndex = mapping[page.pageIndex] else { continue }
            var copy = page
            copy.pageIndex = mappedIndex
            copy.objects = copy.objects?.map { object in
                var nextObject = object
                nextObject.pageIndex = mappedIndex
                return nextObject
            }
            nextPages.append(copy)
        }
        var nextObjects: [PDFAnnotationObject] = []
        for object in objects {
            guard let pageIndex = object.pageIndex, let mappedIndex = mapping[pageIndex] else { continue }
            var copy = object
            copy.pageIndex = mappedIndex
            nextObjects.append(copy)
        }
        return PDFAnnotationDocument(
            schemaVersion: schemaVersion,
            documentPath: documentPath,
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            pages: nextPages.sorted { $0.pageIndex < $1.pageIndex },
            objects: nextObjects
        )
    }

    func inserting(_ imported: PDFAnnotationDocument?, at insertAt: Int, insertedPageCount: Int, documentPath: String) -> PDFAnnotationDocument {
        var nextPages = pages.map { page in
            var copy = page
            if copy.pageIndex >= insertAt {
                copy.pageIndex += insertedPageCount
            }
            copy.objects = copy.objects?.map { object in
                var nextObject = object
                if let pageIndex = nextObject.pageIndex, pageIndex >= insertAt {
                    nextObject.pageIndex = pageIndex + insertedPageCount
                }
                return nextObject
            }
            return copy
        }
        var nextObjects = objects.map { object in
            var copy = object
            if let pageIndex = copy.pageIndex, pageIndex >= insertAt {
                copy.pageIndex = pageIndex + insertedPageCount
            }
            return copy
        }

        if let imported {
            for page in imported.pages {
                var copy = page
                copy.pageIndex = insertAt + page.pageIndex
                copy.objects = copy.objects?.map { object in
                    var nextObject = object
                    nextObject.id = UUID().uuidString
                    nextObject.pageIndex = insertAt + (object.pageIndex ?? page.pageIndex)
                    return nextObject
                }
                nextPages.append(copy)
            }
            for object in imported.objects {
                var copy = object
                copy.id = UUID().uuidString
                copy.pageIndex = insertAt + (object.pageIndex ?? 0)
                nextObjects.append(copy)
            }
        }

        return PDFAnnotationDocument(
            schemaVersion: schemaVersion,
            documentPath: documentPath,
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            pages: nextPages.sorted { $0.pageIndex < $1.pageIndex },
            objects: nextObjects
        )
    }
}

private func renderFlattenedPDF(document: PDFDocument, annotations: PDFAnnotationDocument, to outputURL: URL) throws {
    guard let firstPage = document.page(at: 0) else { throw CocoaError(.fileNoSuchFile) }
    let firstBounds = firstPage.bounds(for: .mediaBox)
    let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: firstBounds.size))
    try renderer.writePDF(to: outputURL) { context in
        for pageIndex in 0..<document.pageCount {
            guard let page = document.page(at: pageIndex) else { continue }
            let pageBounds = page.bounds(for: .mediaBox)
            context.beginPage()
            UIColor.white.setFill()
            UIRectFill(CGRect(origin: .zero, size: pageBounds.size))
            context.cgContext.saveGState()
            context.cgContext.translateBy(x: 0, y: pageBounds.height)
            context.cgContext.scaleBy(x: 1, y: -1)
            page.draw(with: .mediaBox, to: context.cgContext)
            context.cgContext.restoreGState()

            if let annotationPage = annotations.pages.first(where: { $0.pageIndex == pageIndex }) {
                drawInk(annotationPage.inkDataBase64, pageBounds: pageBounds)
                if annotationPage.inkDataBase64 == nil {
                    drawCodmesInk(annotationPage.inkStrokes, pageBounds: pageBounds)
                }
                for object in annotationPage.objects ?? [] {
                    drawAnnotationObject(object, pageBounds: pageBounds)
                }
            }

            for object in annotations.objects where object.pageIndex == pageIndex {
                drawAnnotationObject(object, pageBounds: pageBounds)
            }
        }
    }
}

private func drawInk(_ encoded: String?, pageBounds: CGRect) {
    guard let encoded,
          let data = Data(base64Encoded: encoded),
          let drawing = try? PKDrawing(data: data) else { return }
    let image = drawing.image(from: CGRect(origin: .zero, size: pageBounds.size), scale: 2)
    image.draw(in: CGRect(origin: .zero, size: pageBounds.size))
}

private func drawCodmesInk(_ strokes: [CodmesInkStroke]?, pageBounds: CGRect) {
    guard let strokes else { return }
    for stroke in strokes {
        guard stroke.points.count > 1 else { continue }
        let path = UIBezierPath()
        let first = stroke.points[0]
        path.move(to: CGPoint(x: pageBounds.width * first.x, y: pageBounds.height * first.y))
        for point in stroke.points.dropFirst() {
            path.addLine(to: CGPoint(x: pageBounds.width * point.x, y: pageBounds.height * point.y))
        }
        UIColor(hexString: stroke.color).setStroke()
        path.lineWidth = max(0.5, stroke.width)
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.stroke()
    }
}

private func drawAnnotationObject(_ object: PDFAnnotationObject, pageBounds: CGRect) {
    guard let box = object.bbox?.normalizedOrSelf else { return }
    let rect = CGRect(
        x: pageBounds.width * box.x,
        y: pageBounds.height * box.y,
        width: pageBounds.width * box.width,
        height: pageBounds.height * box.height
    )

    if object.type.lowercased().contains("image"),
       let dataString = object.dataBase64,
       let data = Data(base64Encoded: stripDataURLPrefix(dataString)),
       let image = UIImage(data: data) {
        image.draw(in: rect)
        return
    }

    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .left
    paragraph.lineBreakMode = .byWordWrapping
    let fontSize = CGFloat(Double(object.metadata?["fontSize"] ?? "16") ?? 16)
    let attributes: [NSAttributedString.Key: Any] = [
        .font: UIFont.systemFont(ofSize: fontSize),
        .foregroundColor: UIColor.label,
        .paragraphStyle: paragraph
    ]
    UIColor.systemBackground.withAlphaComponent(0.65).setFill()
    UIBezierPath(roundedRect: rect, cornerRadius: 4).fill()
    (object.text ?? "").draw(in: rect.insetBy(dx: 5, dy: 4), withAttributes: attributes)
}

private func stripDataURLPrefix(_ value: String) -> String {
    value.replacingOccurrences(of: "^data:[^,]+,", with: "", options: .regularExpression)
}

private extension UIColor {
    convenience init(hexString: String) {
        let clean = hexString.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: clean).scanHexInt64(&value)
        let red = CGFloat((value >> 16) & 0xff) / 255
        let green = CGFloat((value >> 8) & 0xff) / 255
        let blue = CGFloat(value & 0xff) / 255
        self.init(red: red, green: green, blue: blue, alpha: 1)
    }
}
#endif

private func splitStrokes(_ strokes: [CodmesInkStroke], erasingAt point: CodmesInkPoint, threshold: Double) -> [CodmesInkStroke] {
    strokes.flatMap { splitStroke($0, erasingAt: point, threshold: threshold) }
}

private func splitStroke(_ stroke: CodmesInkStroke, erasingAt point: CodmesInkPoint, threshold: Double) -> [CodmesInkStroke] {
    guard stroke.points.count > 1 else { return [stroke] }
    var segments: [[CodmesInkPoint]] = []
    var current: [CodmesInkPoint] = []
    let points = stroke.points

    for index in points.indices {
        let candidate = points[index]
        let previous = index > points.startIndex ? points[points.index(before: index)] : nil
        let next = index < points.index(before: points.endIndex) ? points[points.index(after: index)] : nil
        let isHit = inkDistance(candidate, point) <= threshold
            || previous.map { inkDistanceToSegment(point, $0, candidate) <= threshold } == true
            || next.map { inkDistanceToSegment(point, candidate, $0) <= threshold } == true

        if isHit {
            if current.count > 1 {
                segments.append(current)
            }
            current = []
        } else {
            current.append(candidate)
        }
    }

    if current.count > 1 {
        segments.append(current)
    }

    guard !segments.isEmpty else { return [] }
    if segments.count == 1, segments[0].count == stroke.points.count {
        return [stroke]
    }
    return segments.map { segment in
        CodmesInkStroke(
            id: UUID().uuidString,
            tool: stroke.tool,
            color: stroke.color,
            width: stroke.width,
            opacity: stroke.opacity,
            points: segment
        )
    }
}

private func inkDistance(_ first: CodmesInkPoint, _ second: CodmesInkPoint) -> Double {
    let dx = first.x - second.x
    let dy = first.y - second.y
    return (dx * dx + dy * dy).squareRoot()
}

private func inkDistanceToSegment(_ point: CodmesInkPoint, _ start: CodmesInkPoint, _ end: CodmesInkPoint) -> Double {
    let vx = end.x - start.x
    let vy = end.y - start.y
    let wx = point.x - start.x
    let wy = point.y - start.y
    let lengthSquared = vx * vx + vy * vy
    guard lengthSquared > 0 else { return inkDistance(point, start) }
    let t = min(1, max(0, (wx * vx + wy * vy) / lengthSquared))
    let projection = CodmesInkPoint(
        x: start.x + t * vx,
        y: start.y + t * vy,
        pressure: nil,
        timeOffset: nil
    )
    return inkDistance(point, projection)
}

private extension AnnotationBoundingBox {
    var normalizedOrSelf: NormalizedBoundingBox? {
        if let normalized {
            return normalized
        }
        if x >= 0, y >= 0, width > 0, height > 0, x <= 1, y <= 1, width <= 1, height <= 1 {
            return NormalizedBoundingBox(x: x, y: y, width: width, height: height)
        }
        return nil
    }
}
