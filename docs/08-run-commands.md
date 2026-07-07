# 실행 명령어

이 문서는 현재 MVP를 로컬 Mac에서 실행하는 순서를 정리한다.

현재 구조는 세 단계다.

```text
Hermes serve
  -> Workspace Server
  -> Apple SwiftUI app
```

## 0. 위치

레포지토리 위치:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
```

Apple 앱 위치:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
```

## 1. Hermes 서버 실행

터미널 1에서 Hermes dashboard/API 서버를 먼저 실행한다.

```bash
hermes serve --host 0.0.0.0 --port 9119
```

정상 실행 예시:

```text
HERMES_DASHBOARD_READY port=9119
Hermes Web UI -> http://0.0.0.0:9119
```

로컬 Mac에서만 테스트할 때 Workspace Server는 다음 주소로 Hermes에 붙는다.

```text
http://127.0.0.1:9119
```

같은 네트워크나 Tailscale에서 Hermes 자체 접속을 확인하려면 Mac의 IP 또는
Tailscale IP를 사용한다.

```text
http://<Mac-IP>:9119
http://<Tailscale-IP>:9119
```

## 2. Workspace Server 실행

터미널 2에서 Workspace Server를 실행한다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes

export HERMES_WORKSPACE_ROOT="$HOME/HermesWorkspace"
export HERMES_SERVER_URL="http://127.0.0.1:9119"
export HERMES_DASHBOARD_USERNAME="admin"
export HERMES_DASHBOARD_PASSWORD="admin"

npm start
```

정상 실행 예시:

```text
[workspace] listening on http://127.0.0.1:8787
[workspace] root /Users/user/HermesWorkspace
[workspace] hermes http://127.0.0.1:9119
```

서버 상태 확인:

```bash
curl http://127.0.0.1:8787/api/health
```

정상 응답:

```json
{
  "ok": true,
  "service": "ai-workspace-on-hermes"
}
```

Workspace 정보 확인:

```bash
curl http://127.0.0.1:8787/api/workspace
```

Hermes 세션 목록 확인:

```bash
curl http://127.0.0.1:8787/api/hermes/sessions
```

Hermes 모델 목록 확인:

```bash
curl http://127.0.0.1:8787/api/hermes/models
```

## 3. Apple macOS 앱 실행

터미널 3에서 SwiftUI 앱을 실행한다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
swift run AIWorkspace
```

앱이 열리면 좌하단 Workspace Server 주소가 다음 값인지 확인한다.

```text
http://127.0.0.1:8787
```

그 다음 순서:

1. 새로고침 버튼으로 Workspace Server 연결 확인
2. Chat 탭에서 모델 선택
3. 번개 아이콘으로 Hermes live session 연결
4. 메시지 입력 후 전송

## 4. 백그라운드로 Workspace Server 실행

매번 터미널을 열어두기 싫으면 Workspace Server를 백그라운드로 실행할 수 있다.

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes

HERMES_SERVER_URL="http://127.0.0.1:9119" \
HERMES_WORKSPACE_ROOT="$HOME/HermesWorkspace" \
HERMES_DASHBOARD_USERNAME="admin" \
HERMES_DASHBOARD_PASSWORD="admin" \
node server/index.mjs > /tmp/ai-workspace-on-hermes.log 2>&1 &

echo $! > /tmp/ai-workspace-on-hermes.pid
```

상태 확인:

```bash
curl http://127.0.0.1:8787/api/health
```

로그 확인:

```bash
tail -f /tmp/ai-workspace-on-hermes.log
```

종료:

```bash
kill "$(cat /tmp/ai-workspace-on-hermes.pid)"
```

## 5. 개발 검증 명령어

서버 테스트:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes
npm run check
```

Apple 앱 빌드:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
swift build
```

Apple 앱 실행:

```bash
cd /Users/user/Desktop/AI-Workspace-on-hermes/client/apple
swift run AIWorkspace
```

## 6. 현재 원격 접속 주의점

현재 Workspace Server는 코드상 `127.0.0.1:8787`로 실행된다.

즉 현재 상태에서는 macOS 앱을 같은 Mac에서 실행하는 로컬 개발 흐름이 기준이다.
iPad, iPhone, 다른 Mac에서 Workspace Server에 직접 접속하려면 이후 작업에서
Workspace Server의 bind host를 `0.0.0.0` 또는 설정값으로 바꾸는 기능을 추가해야 한다.

Hermes serve 자체는 아래처럼 실행하면 외부 접속을 받을 수 있다.

```bash
hermes serve --host 0.0.0.0 --port 9119
```

하지만 Apple 앱이 붙는 대상은 Hermes가 아니라 Workspace Server다.
따라서 모바일/원격 클라이언트 지원은 Workspace Server의 외부 바인딩까지 구현한 뒤
테스트해야 한다.

