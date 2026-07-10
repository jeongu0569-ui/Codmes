# 내장 모델 설정 런타임

## 목적

`aiw model`은 단순한 provider/model 목록을 새로 구현하지 않는다. Hermes Agent
0.18.0의 모델 설정, provider 분기, API key/OAuth, custom endpoint, 모델 조회
TUI 소스를 AI Workspace 저장소에 포함하고 AI Workspace 설정 저장소에 연결한다.

```text
aiw model
  -> vendor/hermes-agent/aiw_model.py
  -> vendored hermes_cli model flow
  -> <Workspace>/.ai-workspace/config/config.yaml
  -> <Workspace>/.ai-workspace/config/auth.json
  -> AI Workspace OpenAI-compatible runtime
```

외부 `hermes` 실행파일이나 `hermes serve`를 호출하지 않는다. 사용되는 원본 코드는
MIT 라이선스이며 `vendor/hermes-agent/LICENSE`와 출처 기록을 함께 보존한다.

## 설치

내장 Python 런타임은 다음 명령으로 준비한다.

```bash
npm run runtime:bootstrap
```

저장소의 `.aiw-runtime` 가상환경에 벤더링된 소스와 정확한 core dependency를
설치한다. 이 폴더는 Git에 포함하지 않는다. Python 선택 우선순위는 다음과 같다.

1. `AIW_RUNTIME_PYTHON`
2. 저장소의 `.aiw-runtime`
3. 저장소의 일반 `.venv`
4. 벤더 디렉터리의 `.venv`
5. 이전 Hermes 설치의 Python 환경 (migration fallback)
6. 의존성이 이미 설치된 `python3` 또는 `python`

## 설정 사용

전체 대화형 설정:

```bash
AIW_WORKSPACE_ROOT="$HOME/AIWorkspace" aiw model
```

자동화용 비대화형 명령은 그대로 유지한다.

```bash
aiw model show
aiw model list
aiw model set-default openai-api gpt-5.4-mini
```

TUI가 `provider`, `model.base_url`, `api_mode` 형식으로 저장한 endpoint를
AI Workspace 런타임이 직접 읽는다. 이전 custom endpoint 설정도 호환한다.

## Ollama

Ollama 0.31.2에서 `ollama launch hermes --config`를 격리 HOME으로 실행해 확인한
결과, Ollama는 지원 integration 이름과 각 제품의 설정 파일 생성 로직을 자체
바이너리에 포함한다. 따라서 AI Workspace 저장소만 수정해서
`ollama launch aiw`라는 literal command를 추가할 수 없다. Ollama upstream에
`aiw` integration이 등록되어야 한다.

AI Workspace의 기본 모델 picker에는 다음 구조를 추가했다.

```text
Ollama ▸
  Ollama Local
  Ollama Cloud
```

`Ollama Local`은 API key를 요구하지 않고 `/api/tags`에서 completion/tools/thinking
기능이 있는 모델만 조회하며 `provider: ollama-local`로 저장한다. CLI 단축 경로도
같은 provider를 사용한다.

```bash
aiw ollama
aiw ollama --model gemma4:e2b-mlx
aiw ollama --model gemma4:e2b-mlx --serve
```

이 명령은 `GET http://127.0.0.1:11434/api/tags`로 설치 모델을 확인하고,
`http://127.0.0.1:11434/v1`을 `ollama-local` endpoint로 저장한다.

## Apple 앱 GUI

앱의 `Settings > Model & Provider`는 다음 Workspace Server API를 사용한다.

- `GET /api/providers`
- `GET /api/providers/:id/models`
- `POST /api/auth/:provider`
- `POST /api/model/default`

API key와 endpoint는 서버에만 저장되고 앱은 기존 secret 값을 다시 내려받지 않는다.
Ollama Local 모델 조회도 Workspace Server가 수행하므로 iPhone은 Ollama에 직접
연결하지 않는다. OAuth provider는 별도 OAuth 상태/callback API가 추가될 때까지
서버의 `aiw model`에서 인증한다.

## 검증 항목

- 벤더링된 TUI에서 34개 provider/action 행 출력
- 임시 Workspace에서 `ollama-local` endpoint와 모델 저장
- `aiw model show/list`에서 저장 결과 확인
- 로컬 `gemma4:e2b-mlx`로 AI Workspace 자체 런타임 스트리밍 응답 확인
- Hermes-compatible custom config 회귀 테스트
- 모델 TUI가 Workspace별 설정 경로를 사용하는 테스트
- macOS/iOS 설정 GUI 빌드 및 provider 관리 API 실호출
