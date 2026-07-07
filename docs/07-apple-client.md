# Apple Client

The first Apple client is a macOS SwiftUI shell in:

```text
client/apple
```

It is intentionally a Swift Package first, not a full Xcode project. This keeps
the scaffold buildable on machines that only have Command Line Tools installed.

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
- text/markdown file preview
- workspace search UI
- Hermes live chat connection through the Workspace Server
- live session creation
- message submit
- basic live event rendering for assistant, thinking, tool, approval, and system events

Not yet implemented:

- recursive folder navigation
- markdown editing and save
- PDF rendering
- model/session picker UI
- approval action buttons
- rich thinking/tool grouping
- iOS target packaging

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
  -> prompt.submit
  -> render hermes.event messages
```

The first implementation intentionally keeps the UI plain. It renders live
events as chat rows so the transport can be tested before adding richer Codex-
style grouped thinking and tool panels.
