import SwiftUI
#if os(macOS)
import AppKit
#endif

@main
struct AIWorkspaceApp: App {
    @StateObject private var store = WorkspaceStore()

    var body: some Scene {
        #if os(macOS)
        WindowGroup(id: "ai-workspace-main-window-v2") {
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
        let window = NSApp.windows
            .filter({ $0.isVisible && $0.styleMask.contains(.titled) })
            .max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
        if let window {
            window.styleMask.insert(.resizable)
            window.minSize = NSSize(width: 640, height: 420)
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
#endif
