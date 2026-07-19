# 아키텍처

## 실행 구조

```text
Apple App
  | HTTP + WebSocket
  v
Codmes Server
  |- Workspace file APIs
  |- Search and document ingest
  |- Session and agent runtime
  |- Provider, auth, tools and approvals
  v
Workspace + .codmes state
```

`server/index.mjs`가 HTTP/WebSocket 진입점이다. 기능 로직은 `server/lib`에,
문서 추출 worker는 `server/workers/document-ingest`에 있다. Apple 앱은
`client/apple/Sources/Codmes`의 SwiftUI, PDFKit, AppKit/UIKit 코드로 구성된다.

## 주요 서버 모듈

| 영역 | 기준 구현 |
| --- | --- |
| 파일과 라우팅 | `server/index.mjs`, `server/lib/path-utils.mjs` |
| 검색 | `server/lib/search-service.mjs` |
| 문서 추출 | `server/lib/document-ingest.mjs` |
| 대화/세션 | `server/lib/session-runtime.mjs`, `server/lib/runtime/conversation-index.mjs` |
| 모델 실행 | `server/lib/runtime/openai-compatible-runtime.mjs` |
| 작업과 패치 | `server/lib/agent-engine.mjs`, `server/lib/code-agent-runtime.mjs` |
| 설정과 인증 | `server/lib/runtime/config-store.mjs` |
| MCP/skills/security | `server/lib/runtime/mcp-client.mjs`, `skill-registry.mjs`, `security-policy.mjs` |

## 경계 규칙

- 모든 파일 API는 Workspace-relative POSIX 경로를 받는다.
- 절대 경로와 `..` traversal은 서버에서 거부한다.
- Apple 앱은 파일, annotation, 검색 상태를 `WorkspaceAPI`를 통해 요청한다.
- PDF 바이너리는 원본 파일이고, 편집 가능한 필기는 문서별 `annotations.json`이다.
- 검색 인덱스와 문서 추출 결과는 파생 상태이며 다시 만들 수 있다.
- 세션, 승인, 메모리, 사용자 설정은 파생물이 아니므로 Workspace 백업에 포함한다.

## 실시간 흐름

`/api/live` WebSocket은 사용자 명령, model stream, tool event, approval 및 완료
이벤트를 전달한다. 화면에 보이는 assistant 응답과 저장되는 세션 응답은 같은
stream event에서 만들어진다.
