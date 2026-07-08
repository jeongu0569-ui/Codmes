import SwiftUI
#if os(macOS)
import AppKit
#endif

@main
struct AIWorkspaceApp: App {
    @StateObject private var store = WorkspaceStore()

    var body: some Scene {
        #if os(macOS)
        WindowGroup {
            rootView
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1120, height: 740)
        #else
        WindowGroup {
            rootView
        }
        #endif
    }

    private var rootView: some View {
        RootView()
            .environmentObject(store)
            .tint(.secondary)
            #if os(macOS)
            .onAppear {
                activateMacAppWindow()
            }
            #endif
            .task {
                await store.refreshWorkspace()
            }
    }
}

#if os(macOS)
@MainActor
private func activateMacAppWindow() {
    NSApp.setActivationPolicy(.regular)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
        if let window = NSApp.windows.first {
            window.styleMask.insert(.resizable)
            window.minSize = NSSize(width: 640, height: 420)
            window.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
            fitWindowToVisibleScreen(window)
            window.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
    }
}

@MainActor
private func fitWindowToVisibleScreen(_ window: NSWindow) {
    guard let visibleFrame = window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame else { return }
    var frame = window.frame
    let maxWidth = visibleFrame.width * 0.92
    let maxHeight = visibleFrame.height * 0.90
    var changed = false

    if frame.width > maxWidth {
        frame.size.width = maxWidth
        changed = true
    }
    if frame.height > maxHeight {
        frame.size.height = maxHeight
        changed = true
    }
    if frame.minX < visibleFrame.minX || frame.maxX > visibleFrame.maxX
        || frame.minY < visibleFrame.minY || frame.maxY > visibleFrame.maxY {
        frame.origin.x = visibleFrame.midX - frame.width / 2
        frame.origin.y = visibleFrame.midY - frame.height / 2
        changed = true
    }
    if changed {
        window.setFrame(frame, display: true)
    }
}
#endif
