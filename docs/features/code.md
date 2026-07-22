# Code Surface

Code는 `<Workspace>/Code` 아래 project를 탐색하고 server의 code agent 작업을
제어하는 surface다.

## 현재 기능

- 재귀 file tree와 여러 folder 동시 expand
- source file 읽기와 편집
- file/folder 생성, rename, move, copy, delete와 다중 선택 drag
- 여러 언어의 Shiki syntax highlight
- code task 생성과 상태 조회
- patch 제안, 승인 적용과 거절
- 승인된 check 및 제한된 Git command 실행
- 현재 file/project context를 Chat에 전달

## Server 흐름

```text
Apple Code UI
  -> /api/agent/code-task
  -> CodeAgentRuntime
  -> task / patch / diff state under .codmes
  -> approval and checks
```

Code 작업은 Workspace의 `Code` 범위 안에서 실행하며 path traversal을 허용하지
않는다. patch 적용과 위험한 Git/shell 작업은 security policy와 approval을 따른다.

## 현재 경계

- 완전한 LSP, debugger, extension host는 없다.
- 기기 내부 terminal 대신 향후 server terminal session을 제어하는 방향이다.
- 자동 수정 반복은 task/check 결과를 기반으로 점진적으로 확장한다.

API는 [Server API 문서](../server/api-contract.md), 전체 남은 작업은
[roadmap](../roadmap.md)을 참고한다.
