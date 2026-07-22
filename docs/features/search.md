# 현재 검색 구조

## 저장 위치

```text
<Workspace>/.codmes/index/search.json
<Workspace>/.codmes/documents/<document-key>/index/extraction.json
<Workspace>/.codmes/documents/<document-key>/index/content.md
```

`search.json`은 검색용 item/chunk index다. `extraction.json`은 page, bbox, source,
table 등 구조를 보존하고 `content.md`는 같은 문서를 사람이 읽기 쉬운 Markdown으로
남긴 파생물이다. 현재 검색은 Markdown 파일 자체를 RAG source로 다시 읽는 것이
아니라 구조화된 extraction block을 index에 넣는다.

## 색인 대상

- Markdown, text와 주요 source code
- PDF와 image
- DOC/DOCX, PPT/PPTX, HWP/HWPX, ODT/ODP
- XLS/XLSX와 ZIP 내부 지원 문서
- PDF text/image annotation

문서 worker는 PyMuPDF4LLM/PyMuPDF와 bootstrap으로 설치한 Python library를
사용한다. PDF 표는 Markdown table과 구조화된 table metadata로 보존한다.
text가 부족한 PDF page와 image는 Search 설정의 VLM OCR을 사용할 수 있다.
handwriting stroke OCR은 아직 없다.

## 갱신과 삭제

`POST /api/index/rebuild` 또는 `codmes index rebuild`는 전체 index를 만든다.
서버 실행 중에는 설정된 root watcher가 create/update/delete를 debounce하여
`updateSearchIndex`로 보낸다. 파일 API의 move/copy/delete와 annotation 저장도
연결된 index 및 document cache를 갱신한다.

recursive watch를 지원하지 않는 환경에서는 watcher 오류를 기록하며 수동 rebuild를
사용할 수 있다.

## 사용자 전역 검색

`GET /api/global-search`는 cursor pagination을 사용한다. 한 요청은 최대 100개지만
`nextCursor`가 있는 동안 다음 100개를 계속 요청할 수 있으므로 전체 결과를 100개로
자르지 않는다.

파일 결과는 다음 순서로 정리한다.

1. 같은 파일 경로를 하나의 문서 group으로 묶는다.
2. 문서는 파일명 exact, prefix, contains 일치 순으로 정렬한다.
3. 그다음 일치한 PDF page 수와 본문 결과 수를 사용한다.
4. 문서 내부에서는 title 결과를 먼저, PDF 결과는 page와 bbox 순으로 둔다.

page별 relevance score를 계산해 재정렬하지 않는다. 같은 page에 검색어가 여러 번
있다면 서로 다른 chunk/bbox 결과를 유지할 수 있다. PDF group의 첫 title 결과는
문서 표지를 사용하고 본문 결과 thumbnail은 해당 page를 렌더링해 검색어 영역을
highlight한다.

## Runtime 검색

`POST /api/search`와 `codmes_search` tool은 model context에 넣을 작은 chunk를 찾는다.
index가 없으면 제한된 workspace scan으로 fallback한다. 이 경로는 향후 UI 검색과
분리된 hybrid retriever로 발전할 수 있다.

현재 ranking은 filename/text match 기반이다. Search 설정의 embedding provider,
model, dimension은 index metadata에 기록되지만 embedding 생성, vector store,
semantic reranking은 구현되지 않았다.

## VLM OCR

VLM은 일반 chat 답변이 아니라 결정적인 OCR 작업으로 호출한다. temperature는 0,
streaming과 가능한 thinking 옵션은 끄고 출력 길이를 제한한다. provider 이름만
믿지 않고 실제 image input이 모델까지 전달되는지 probe로 확인해야 한다.

관련 구현:

- `server/lib/search-service.mjs`
- `server/lib/document-ingest.mjs`
- `server/lib/vlm-runtime.mjs`
- `server/workers/document-ingest/extract_document.py`
- `client/apple/Sources/Codmes/SearchView.swift`
