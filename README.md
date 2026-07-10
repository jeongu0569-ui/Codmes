# AI Workspace

![check](https://github.com/jeongu0569-ui/AI-Workspace-on-hermes/actions/workflows/check.yml/badge.svg)

AI Workspace는 채팅, 노트, PDF, 문서 검색, 코드 프로젝트 작업을 하나의 서버 중심 작업 공간으로 통합하려는 애플리케이션입니다.

현재 저장소는 완성된 상용 제품이 아니라 실제 사용 가능한 MVP를 계속 확장하는 단계입니다. 기능과 화면은 앞으로도 바뀔 수 있지만, 별도의 Hermes 서버가 있어야만 동작하는 단순 클라이언트가 아니라 AI Workspace가 자체 서버, 세션, 모델 설정, 도구 실행, 승인, 파일 관리 기능을 직접 소유하는 방향으로 개발하고 있습니다.

## 한눈에 이해하기

```text
Mac Studio, MacBook, Linux 서버
└── AI Workspace Server
    ├── Workspace 파일 관리
    ├── AI 모델 호출
    ├── 채팅 및 세션 저장
    ├── 검색과 문맥 구성
    ├── 도구 실행과 승인 처리
    └── 코드 작업 관리

Mac / iPhone / iPad
└── AI Workspace App
    ├── Chat
    ├── Notes
    ├── Code
    ├── Search
    └── Approvals
```

파일과 AI 실행은 서버가 담당하고 Apple 앱은 서버의 자료와 기능을 사용하는 원격 작업 화면입니다. 따라서 PDF와 코드 프로젝트 전체를 iPhone에 내려받지 않고도 서버에 보관한 상태로 열고 검색하는 구조를 목표로 합니다.

## 현재 구현된 기능

### 1. Workspace 서버

서버를 처음 실행하면 지정한 루트 아래에 다음 구조를 만듭니다.

```text
AIWorkspace/
├── Notes/          Markdown, 텍스트 노트
├── Code/           코드 프로젝트와 소스 파일
├── Documents/      PDF와 일반 문서
├── Attachments/    이미지와 첨부파일
└── .ai-workspace/  앱 설정, 세션, 인덱스, 작업 상태
```

클라이언트는 서버의 절대 경로를 직접 다루지 않고 Workspace 기준 상대 경로를 사용합니다. `..`를 이용한 상위 경로 이동과 Workspace 밖 절대 경로 접근은 서버에서 차단합니다.

서버가 현재 제공하는 주요 기능은 다음과 같습니다.

- 파일과 폴더 트리 조회
- 파일 읽기와 저장
- 파일 및 폴더 생성, 삭제, 이름 변경, 이동, 복사
- 작은 파일 업로드와 대용량 분할 업로드
- Markdown, 코드, PDF, 이미지 메타데이터 처리
- Markdown 및 코드의 서버 렌더링
- Workspace 검색과 파일 인덱스
- 채팅 세션과 메시지 영구 저장
- 실시간 WebSocket 이벤트 스트리밍
- 모델, 프로바이더, 인증 정보 설정
- AI 도구 실행과 승인 요청 저장
- 코드 작업, 패치 제안, 적용, 검사, Git 명령 관리
- 메모리와 과거 대화 검색
- MCP 및 docsearch 연동 경로

### 2. Chat

Chat은 AI Workspace 자체 런타임의 원격 채팅 화면입니다.

- 새 채팅 시작
- 기존 세션 목록 조회와 이어서 대화
- 프로젝트별 세션 분류
- 세션 검색, 선택, 삭제
- 모델 선택
- `Safe`와 `Full` 접근 모드
- `Fast`, `Med`, `Deep` 추론 옵션
- 현재 파일, 현재 폴더, Workspace 전체 문맥 선택
- 응답 실시간 스트리밍
- Thinking, Reasoning, Tool 실행 과정 표시
- 완료된 Activity 접기와 `Done` 표시
- 서버 승인 요청의 허용과 거절
- Markdown 답변, 표, 목록, 인용문, 코드 블록 렌더링
- 코드 언어에 따른 Shiki 문법 강조

일반 폴더나 프로젝트에 속하지 않은 `[Chat]` 세션은 최신 30개를 기본 목록에 유지하고, 오래된 세션은 자동 보관합니다. 프로젝트, 폴더, 고정 세션, 승인 대기 작업이 있는 세션은 이 자동 보관 대상에서 제외됩니다.

### 3. Notes

Notes는 서버의 `Notes/` 폴더를 Obsidian과 비슷한 파일 트리로 보여줍니다.

- 폴더 이동과 재귀 탐색
- Markdown 및 텍스트 파일 열기
- 읽기 화면과 편집 화면
- 수정 내용 서버 저장
- 새 노트와 새 폴더 생성
- 이름 변경, 이동, 복사, 삭제
- 로컬 파일 여러 개 첨부
- 업로드 진행 상태와 실패 표시
- Markdown 제목, 목록, 표, 코드 블록 렌더링
- 이미지와 PDF 미리보기

현재 Markdown 편집기는 기본적인 텍스트 편집 중심입니다. Obsidian 수준의 링크 그래프, 플러그인 생태계, 캔버스 기능은 아직 구현되지 않았습니다.

### 4. Code

Code는 서버의 `Code/` 폴더 안 프로젝트를 다루는 화면입니다.

- 프로젝트 파일 트리
- 여러 프로그래밍 언어의 구문 강조
- 소스 파일 읽기와 편집
- 파일 및 폴더 생성, 이동, 복사, 삭제
- Git 상태와 diff 조회를 위한 서버 도구
- Code Agent 작업 생성과 상태 조회
- 패치 제안 확인
- 승인된 패치 적용
- 승인된 검사 명령 실행
- 작업 취소와 재개

현재는 VS Code 전체를 대체하는 단계가 아닙니다. 완전한 언어 서버, 디버거, 확장 프로그램, 로컬 터미널 UI는 아직 미완성입니다. iOS에서 터미널이 필요할 경우 기기 내부 셸이 아니라 서버에서 실행되는 터미널 세션을 제어하는 방식으로 구현할 예정입니다.

### 5. Search와 RAG

기본 검색은 Workspace 파일을 직접 스캔하는 fallback 방식으로 동작합니다.

- 파일명과 본문 검색
- Notes, Code, Documents 범위 검색
- 파일 메타데이터 인덱스
- PDF 추출 텍스트 검색 경로
- 채팅 세션 제목, 요약, 메시지 검색
- 사용자, 프로젝트, 폴더, 세션 메모리 검색

docsearch MCP가 설정된 경우 문서와 PDF 질문에서 docsearch를 우선 사용하고, 사용할 수 없으면 기본 Workspace 검색으로 돌아갑니다. 네이티브 벡터 인덱스와 OCR은 계속 개발 중입니다.

### 6. Approvals와 Tasks

AI가 파일 변경이나 위험 가능성이 있는 도구를 실행하려 할 때 서버는 작업을 `approval_required` 상태로 저장할 수 있습니다.

Apple 앱의 Approvals 화면에서 다음 작업이 가능합니다.

- 승인 대기 항목 조회
- 승인 또는 거절
- 실행 중, 완료, 실패 작업 상태 확인
- 작업 취소
- 승인 후 작업 재개
- 실시간 이벤트로 상태 갱신

`Safe`는 승인 정책을 적용하는 모드이고 `Full`은 허용된 도구를 더 적극적으로 실행하는 모드입니다. 현재의 권한 체계는 계속 강화하는 단계이므로 중요한 Workspace에는 별도의 백업과 Git 사용을 권장합니다.

### 7. 대화 기억

AI Workspace는 모든 대화를 매번 통째로 프롬프트에 넣지 않고 필요한 기록을 검색하는 구조를 사용합니다.

- `conversation_search`: 과거 세션과 메시지 검색
- `conversation_read`: 선택한 세션의 실제 메시지 읽기
- `memory_search`: 사용자 선호, 프로젝트, 폴더, 세션 요약 검색
- `tool_discovery`: 현재 질문에 필요한 안전한 도구를 해당 턴에만 확장

프로젝트, 폴더, 세션 요약 메모리는 기본적으로 자동 저장할 수 있습니다. 사용자 전체에 적용되는 장기 메모리는 검토 후보로 저장한 뒤 승인하도록 설계되어 있습니다.

## 실행 준비

### 요구사항

- Node.js 22 이상
- npm
- 모델/provider 설정 TUI를 위한 Python 3.11~3.13
- macOS/iOS 앱 개발 시 Xcode
- 실제 사용할 AI 모델 또는 OpenAI 호환 API 서버

저장소를 받은 뒤 의존성을 설치하고 CLI를 연결합니다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
npm install
npm link
npm run runtime:bootstrap
```

`npm link` 이후 `aiw`와 긴 별칭인 `ai-workspace` 명령을 사용할 수 있습니다.

## 모델 설정

AI Workspace는 모델과 인증 정보를 자체 Workspace 설정에 저장합니다. 인자 없이
`aiw model`을 실행하면 AI Workspace 안에 포함된 Hermes Agent 0.18.0의 MIT
라이선스 모델 설정 코드를 사용해 provider, OAuth/API 인증, endpoint, 모델을
순서대로 고르는 원본 TUI가 열립니다. 별도로 설치된 `hermes` 명령이나 Hermes
서버를 실행하는 방식은 아닙니다.

```bash
aiw model
```

로컬 Ollama는 TUI의 `Ollama ▸`에서 `Ollama Local`을 선택합니다. 이 경로는
`Ollama Cloud`와 분리되어 있고 API key를 요구하지 않으며, 서버의 `/api/tags`에서
설치된 채팅 모델을 불러옵니다.

처음 실행하기 전 `npm run runtime:bootstrap`은 저장소의 `.aiw-runtime`에
프로젝트 전용 Python 환경을 만듭니다. 기존 Hermes 가상환경은 이전 설치에서
옮겨오는 사용자를 위한 fallback일 뿐이며, 정상 설치 후에는 사용하지 않습니다.

```bash
aiw provider list
aiw model list
aiw auth list
```

OpenAI API 예시:

```bash
aiw auth set openai-api OPENAI_API_KEY sk-...
aiw model set-default openai-api gpt-5.4-mini
```

LM Studio 예시:

```bash
aiw auth set lmstudio LM_BASE_URL http://127.0.0.1:1234/v1
aiw model set-default lmstudio local-model
```

로컬 Ollama는 실행 중인 서버에서 설치 모델을 조회해 바로 설정할 수 있습니다.

```bash
aiw ollama
aiw ollama --model gemma4:e2b-mlx
aiw ollama --model gemma4:e2b-mlx --serve
```

Ollama 0.31.2의 `ollama launch` 통합 목록은 Ollama 자체에 고정되어 있어 현재
`ollama launch aiw`는 인식되지 않습니다. 이를 문자 그대로 지원하려면 Ollama
프로젝트에 AI Workspace 통합이 추가되어야 합니다. `aiw ollama`는 같은 목적을
AI Workspace가 직접 제공하는 명령입니다.

설정은 기본적으로 `<Workspace>/.ai-workspace/config/` 아래에 저장됩니다.

Mac/iPhone/iPad 앱의 `Settings > Model & Provider`에서도 같은 서버 설정을
관리할 수 있습니다. API key provider, endpoint, Ollama Local 모델 조회와 기본
모델 선택은 GUI에서 바로 처리됩니다. OAuth provider의 브라우저/device-code
로그인은 현재 서버 터미널의 `aiw model`을 사용하며, 후속 단계에서 OAuth 상태
API를 추가할 예정입니다.

## 서버 실행

Mac 한 대에서만 테스트할 때:

```bash
AIW_WORKSPACE_ROOT="$HOME/AIWorkspace" \
AIW_HOST="127.0.0.1" \
AIW_PORT="8787" \
aiw serve
```

개발 중에는 다음 명령도 같습니다.

```bash
AIW_WORKSPACE_ROOT="$HOME/AIWorkspace" npm start
```

서버 확인:

```bash
aiw status
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/workspace
```

### iPhone과 iPad에서 연결

iPhone은 Mac의 `127.0.0.1`에 접속할 수 없습니다. 서버를 외부 인터페이스에 열고 Mac의 LAN 또는 Tailscale 주소를 사용해야 합니다.

```bash
AIW_WORKSPACE_ROOT="$HOME/AIWorkspace" \
AIW_HOST="0.0.0.0" \
AIW_PORT="8787" \
AIW_SERVER_TOKEN="충분히-긴-개인용-토큰" \
aiw serve
```

앱 설정 예시:

```text
Server URL: http://100.x.x.x:8787
Server token: 서버 실행 때 지정한 AIW_SERVER_TOKEN
```

Tailscale을 사용하지 않는다면 같은 Wi-Fi의 Mac LAN 주소를 사용할 수 있습니다. 학교나 공용 Wi-Fi는 기기 간 통신을 차단할 수 있으므로 개인 네트워크 또는 Tailscale 사용을 권장합니다.

## Apple 앱 실행

Xcode 프로젝트:

```text
client/apple/AIWorkspace.xcodeproj
```

### macOS 빌드

```bash
cd client/apple
xcodebuild \
  -project AIWorkspace.xcodeproj \
  -scheme AIWorkspace \
  -destination 'platform=macOS' \
  build
```

macOS 창은 기본 1120×740으로 열리며 상하·좌우로 조절할 수 있습니다. 내부 사이드바와 채팅 화면도 창 크기에 맞춰 다시 배치됩니다.

### iOS Simulator 빌드

```bash
xcodebuild \
  -project AIWorkspace.xcodeproj \
  -scheme 'AIWorkspace iOS' \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

### 실제 iPhone과 iPad

Xcode에서 `AIWorkspace iOS` 타깃을 선택하고 자신의 Apple Development Team을 지정해야 합니다. 개인 Apple 계정으로 설치한 앱은 인증서 정책에 따라 다시 빌드해야 할 수 있습니다.

iOS 앱은 다음 구조입니다.

- 기본 화면은 Chat
- 왼쪽 버튼 또는 가장자리 제스처로 Workspace 메뉴 열기
- Notes와 Code 파일 트리는 왼쪽 서랍에서 사용
- Notes, Code, Search 화면에서 오른쪽 가장자리 제스처로 전역 Chat 패널 열기
- 서버 주소와 토큰은 설정 화면에서 입력
- 서버 토큰은 Apple Keychain에 저장

## 자주 사용하는 CLI

```bash
aiw serve
aiw status
aiw doctor
aiw provider list
aiw model list
aiw auth list
aiw sessions list
aiw tasks list
aiw approvals list
aiw index status
aiw index search "architecture" --scope Notes --limit 10
aiw code create Code/demo-app "인사말을 수정해줘"
```

## 보안

서버를 `0.0.0.0`으로 열 때는 `AIW_SERVER_TOKEN` 설정을 권장합니다.

토큰이 설정되면 `/api/health`를 제외한 HTTP API는 다음 인증을 요구합니다.

```text
Authorization: Bearer <token>
```

WebSocket과 raw 파일 URL은 token query를 사용할 수 있습니다. Apple 앱은 입력한 토큰을 HTTP, WebSocket, raw 파일 요청에 자동으로 적용합니다.

인증 토큰과 API 키가 들어 있는 `.ai-workspace/config`를 공개 Git 저장소에 커밋하지 마세요.

## 주요 데이터 위치

```text
<Workspace>/.ai-workspace/config/       모델, 프로바이더, 인증 설정
<Workspace>/.ai-workspace/sessions/     채팅 세션과 메시지
<Workspace>/.ai-workspace/tasks/        작업 상태
<Workspace>/.ai-workspace/approvals/    승인 대기 항목
<Workspace>/.ai-workspace/memory/       장기 메모리와 검토 후보
<Workspace>/.ai-workspace/index/        파일 및 검색 인덱스
<Workspace>/.ai-workspace/diffs/        패치와 diff 산출물
<Workspace>/.ai-workspace/tool-logs/    도구 실행 기록
```

## 현재 한계와 앞으로의 작업

- 네이티브 벡터 RAG 백엔드는 초기 인터페이스 단계입니다.
- OCR 기반 PDF 검색은 아직 계획 단계입니다.
- PDF 필기와 Apple Pencil 주석 저장은 완성되지 않았습니다.
- Code 화면은 아직 VS Code 수준의 LSP, 디버거, 확장 기능을 제공하지 않습니다.
- 모델별 OAuth 흐름은 프로바이더마다 구현 수준이 다릅니다.
- 도구 sandbox와 세밀한 파일 권한 정책은 추가 강화가 필요합니다.
- 자동 패치 생성, 검사 실패 분석, 자동 수리 반복은 개발 중입니다.
- iPhone과 iPad UI는 실제 기기 테스트를 반복하며 계속 조정할 예정입니다.

## 개발 문서

- [제품 목표](docs/01-product-goal.md)
- [아키텍처](docs/02-architecture.md)
- [API 설계](docs/03-api-design.md)
- [데이터 모델](docs/04-data-model.md)
- [MVP 로드맵](docs/05-mvp-roadmap.md)
- [런타임 이관 기록](docs/06-runtime-migration.md)
- [내장 모델 설정 런타임](docs/13-vendored-model-runtime.md)
- [Apple 클라이언트](docs/07-apple-client.md)
- [실행 명령어](docs/08-run-commands.md)
- [API 계약](docs/api-contract.md)
- [RAG 백엔드 설계](docs/rag-backend-design.md)
- [docsearch MCP 연동](docs/docsearch-mcp-integration.md)

## 프로젝트 방향

초기 프로토타입은 로컬 Hermes의 동작을 참고했지만 최종 제품 구조는 Hermes 서버의 wrapper가 아닙니다.

```text
AI Workspace App
        ↓
AI Workspace Server
        ↓
AI Workspace 자체 session / model / tool / approval / workspace runtime
```

Hermes는 초기 동작과 설계를 참고한 대상이며, 목표는 `aiw serve` 하나로 AI Workspace의 서버와 런타임을 실행하는 독립적인 AI 작업 공간입니다.
