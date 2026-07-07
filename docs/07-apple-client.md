# Apple Client

The first Apple client is a SwiftUI shell in:

```text
client/apple
```

It is intentionally a Swift Package first, not a full Xcode project. This keeps
the scaffold buildable on machines that only have Command Line Tools installed.
The package now declares both macOS and iOS platforms, with conditional SwiftUI
layout and PDF preview wrappers where the frameworks differ.

## Run

Start the Workspace Server first:

```bash
npm start
```

Then run the client:

```bash
cd client/apple
swift run AIWorkspace
```

## Current Views

```text
Chat
Notes
Code
Search
```

Implemented:

- server URL setting
- workspace status loading
- Notes root listing
- Code root listing
- recursive Notes and Code folder navigation
- text/markdown file preview
- markdown/text/code editing and save through `PUT /api/file`
- PDF rendering through `GET /api/raw` and PDFKit
- image preview through `GET /api/raw`
- workspace search UI
- Hermes live chat connection through the Workspace Server
- Hermes model picker backed by `GET /api/hermes/models`
- Hermes session resume menu backed by `GET /api/hermes/sessions`
- Hermes session history loading backed by `GET /api/hermes/sessions/:id/messages`
- live session creation
- message submit
- chat context scope picker
- `contextRequest` forwarding for current file, current folder, and workspace scopes
- basic live event rendering for assistant, thinking, tool, approval, and system events
- grouped, collapsible thinking/tool activity rows, one activity group per user turn
- streaming thinking/reasoning deltas coalesced into smooth activity blocks instead of one row per token
- approval and denial buttons for `approval.request` events
- normalized Hermes session menu titles instead of raw generated session ids
- macOS activation fix for `swift run AIWorkspace`, so the launched window becomes the key app for keyboard input
- compact Notes/Code split view sizing for smaller macOS windows
- explicit sidebar toggle button in the sidebar toolbar
- iOS-ready source split for file navigation and PDF preview

Not yet implemented:

- full Xcode iOS app target, signing, and device packaging

## Client API Boundary

The app talks only to the Workspace Server:

```text
GET  /api/workspace
GET  /api/tree
GET  /api/file
POST /api/search
WS   /api/live
```

It should not directly access filesystem paths or Hermes dashboard cookies.

## Live Chat Flow

The SwiftUI client does not connect to Hermes directly. It opens:

```text
WS /api/live
```

on the Workspace Server. The server is responsible for Hermes dashboard login,
WebSocket ticket creation, Hermes live session routing, and approval forwarding.

The current client flow is:

```text
Connect button or first message
  -> WS /api/live
  -> connect
  -> session.create
  -> prompt.submit with optional contextRequest
  -> render hermes.event messages
  -> approval.respond when the user approves or denies a request
```

When the user chooses an existing Hermes session, the client first loads saved
messages from:

```text
GET /api/hermes/sessions/:id/messages
```

Then it resumes the live WebSocket session. This keeps the visible chat history
aligned with the Hermes session instead of showing only local system messages
such as "Live bridge ready".

The client now treats assistant text and activity as separate streams.
`message.delta` appends to the assistant bubble. Thinking, reasoning, and tool
events are grouped into a single collapsible activity row for the current user
turn. `message.complete`, `turn.complete`, and related completion events close
the current activity group so late events do not create extra rows after the
answer.

User messages are right-aligned and assistant messages remain left-aligned, so
chat turns are visually easier to scan.

## Chat Context Scopes

The chat input can now choose the workspace context sent with each prompt:

```text
No context
Current file
Current folder
Workspace
```

The client only sends a compact `contextRequest`. The Workspace Server resolves
the path, decides inline versus RAG/search metadata, and forwards the rendered
context to Hermes. This keeps filesystem and indexing policy centralized on the
server instead of duplicating it in each Apple client.

## iOS Groundwork

The current package is still primarily run as a macOS executable:

```bash
swift run AIWorkspace
```

The source is now prepared for an iOS app target:

- `Package.swift` declares `.iOS(.v17)`.
- File navigation uses `HSplitView` on macOS and a stacked layout elsewhere.
- PDF rendering uses `NSViewRepresentable` on macOS and `UIViewRepresentable` on iOS.

The remaining packaging work is to create a proper Xcode app target, bundle ID,
signing setup, and iPhone/iPad runtime verification.
