# Codmes Search 쉬운 설명

이 문서는 Codmes Search가 지금 어떤 순서로 동작하는지, PDF와 이미지 문서는 어떻게 처리되는지, 그리고 Ollama/LM Studio VLM 테스트에서 무엇을 확인했는지 쉽게 정리합니다.

## 한 줄 요약

Codmes Search는 사용자의 파일을 채팅 프롬프트에 통째로 붙이는 방식이 아니라, 서버가 workspace 파일을 읽고 작은 조각으로 색인한 뒤 필요한 조각만 찾아서 모델에게 넘기는 구조입니다.

```text
사용자 질문
  -> Codmes Runtime
  -> codmes_search tool
  -> Codmes Search Index
  -> 관련 파일/페이지/문단 찾기
  -> 찾은 내용만 모델에게 전달
  -> 답변 생성
```

## 왜 이런 구조가 필요한가

Notes, PDF, 코드, 첨부파일을 전부 채팅에 넣으면 너무 커집니다. 특히 PDF나 폴더 전체 질문은 프롬프트가 길어지고, 모델이 중요한 부분을 놓치기 쉽습니다.

그래서 Codmes는 다음 역할을 서버가 담당합니다.

- 어떤 파일을 검색할지 결정
- PDF나 문서에서 텍스트 추출
- 긴 문서를 작은 chunk로 나누기
- 검색 결과에 파일 경로, 페이지, 좌표 정보를 붙이기
- 모델에게 필요한 일부 내용만 넘기기

Apple 앱은 검색 엔진을 직접 구현하지 않습니다. 앱은 파일 탐색, 설정, 채팅 UI를 담당하고, 검색과 색인은 Codmes Server가 담당합니다.

## 현재 Search의 실제 구현 상태

현재 구현은 다음 단계까지 완료되어 있습니다.

- Markdown, 텍스트, 코드 파일 검색
- PDF 텍스트 레이어 추출
- PDF 페이지/block metadata 저장
- DOCX, PPTX, XLSX, HWPX 등 문서 추출 경로
- ZIP 내부 지원 문서 추출
- chunk index 저장
- 파일 생성/수정/삭제 감지 후 부분 색인
- `codmes_search` tool 제공
- Search 설정에서 embedding model과 VLM model 선택 UI 제공
- PDF annotation 텍스트 박스와 첨부 이미지 OCR 검색

하지만 아직 완성되지 않은 부분도 있습니다.

- 실제 embedding vector 생성
- vector similarity ranking
- 앱 자체 OCR 엔진
- 스캔 PDF의 selectable text overlay

즉, 지금 검색은 기본적으로 **문서 추출 + 텍스트 chunk 검색**입니다. embedding 설정은 저장되지만, 실제 벡터 검색 랭킹은 다음 Search Runtime 단계입니다.

## 인덱스 파일은 어디에 저장되나

Workspace 안에 저장됩니다.

```text
<Workspace>/.codmes/index/search.json
```

문서 추출 캐시는 다음 경로에 저장됩니다.

```text
<Workspace>/.codmes/index/documents/
```

이 파일들은 사용자의 workspace 상태 데이터입니다. 공개 Git 저장소에 커밋하면 안 됩니다.

## 파일이 추가되거나 수정되면 어떻게 되나

`codmes serve`가 실행 중이면 Codmes는 설정된 검색 범위를 감시합니다.

```text
파일 생성/수정/삭제
  -> watcher 감지
  -> 변경된 파일 경로만 확인
  -> 해당 파일 chunk만 다시 생성
  -> search.json 갱신
```

전체 rebuild가 항상 필요한 구조가 아닙니다. 일반적인 노트 수정이나 PDF 추가는 부분 색인으로 처리하는 방향입니다.

## PDF는 어떻게 검색되나

텍스트가 들어 있는 일반 PDF는 다음처럼 처리됩니다.

```text
PDF 파일
  -> PyMuPDF4LLM / PyMuPDF
  -> 페이지별 텍스트와 block 정보 추출
  -> chunk 생성
  -> search index에 저장
  -> 검색 결과에 page / bbox 포함
```

검색 결과에 `page`와 `bbox`가 있기 때문에, 나중에 PDF 뷰어에서 해당 페이지로 이동하거나 하이라이트하는 기능을 붙일 수 있습니다.

## 이미지 PDF나 스캔 PDF는 어떻게 처리하나

스캔 PDF는 일반 PDF와 다릅니다. 파일 안에 텍스트 레이어가 없고, 페이지가 이미지처럼 들어 있습니다.

이 경우에는 VLM 또는 OCR이 필요합니다.

Codmes의 현재 1차 구현 방향은 다음입니다.

- 기본 검색은 텍스트 레이어 PDF와 문서 추출 중심
- 텍스트가 거의 없는 PDF는 페이지별 PNG로 렌더링
- 각 페이지 이미지를 VLM에 따로 보내 OCR 텍스트 추출
- 이미지 파일도 VLM에 보내 OCR 텍스트 추출
- 추출 결과는 `source: "vlm-ocr"` block으로 문서 캐시에 저장
- Tesseract, LibreOffice 같은 무거운 네이티브 의존성을 기본 요구사항으로 넣지 않음
- 유료 Azure OCR 같은 cloud OCR도 기본 경로에 넣지 않음
- 사용자가 설정한 VLM이 실제 이미지 글자를 읽을 수 있는지 probe 테스트로 확인

흐름은 다음과 같습니다.

```text
스캔 PDF / 이미지 배경 PDF
  -> PyMuPDF로 페이지별 PNG 렌더링
  -> page 1 image -> VLM OCR 호출
  -> page 2 image -> VLM OCR 호출
  -> ...
  -> page number와 OCR text를 block으로 저장
  -> Search index에 포함
```

중요한 점은 PDF 전체를 한 번에 VLM에 넣지 않는다는 것입니다. 30페이지 PDF라면 30번의 작은 page OCR 호출로 나눕니다. 따라서 `max_tokens`는 전체 PDF 하나에 대한 제한이 아니라 기본적으로 각 페이지 OCR 호출의 출력 제한입니다.

## 왜 VLM probe 테스트가 필요한가

모델 이름에 vision이 들어가 있거나, 모델 설명에 multimodal이라고 쓰여 있어도 실제 서버 API에서 이미지가 제대로 전달되지 않을 수 있습니다.

그래서 Codmes는 단순히 “이 모델은 vision 모델이다”라고 믿으면 안 됩니다.

좋은 검증 방식은 다음입니다.

```text
테스트 이미지 생성
  -> 이미지에 CODMES VISION TEST / ANSWER IS 42 같은 글자 삽입
  -> 선택한 VLM endpoint로 전송
  -> 모델이 정확히 읽는지 확인
  -> 통과하면 VLM OCR용으로 사용
  -> 실패하면 Search 설정에서 경고 표시
```

## 2026-07-13 Ollama / LM Studio VLM 테스트 기록

같은 계열의 Gemma4 12B MLX 모델로 Ollama와 LM Studio를 비교했습니다.

### 테스트 환경

Ollama:

```text
ollama version: 0.31.2
model: gemma4:12b-mlx
```

Ollama 모델 정보:

```text
Capabilities
  completion
  tools
  thinking
```

중요한 점은 Ollama가 이 모델에 대해 `vision` capability를 노출하지 않았다는 것입니다.

LM Studio:

```text
server: http://127.0.0.1:1234/v1
model: gemma-4-12b-it-mlx
```

### 테스트 1: 단순 이미지 OCR

이미지 안에 크게 다음 문장을 넣었습니다.

```text
CODMES VISION TEST
ANSWER IS 42
KOREAN: 한정우
```

Ollama 결과:

- 이미지 내용과 관계없는 회사 소개문 또는 다른 문장을 출력
- 또는 이미지가 첨부되지 않은 것처럼 응답
- `/api/chat`과 `/api/generate` 모두 실패

LM Studio 결과:

```text
CODMES VISION TEST
ANSWER IS 42
KOREAN: 한정우
```

정확히 읽었습니다.

### 테스트 2: 첨부 PDF 첫 페이지 이미지

첨부 파일:

```text
/Users/user/Downloads/1.%20%EA%B3%B5%EA%B3%A0%EB%AC%B8.pdf
```

PDF 첫 페이지를 이미지로 렌더링한 뒤 VLM에 넣었습니다.

Ollama 결과:

- 공고문 이미지를 읽지 못함
- “이미지가 첨부되지 않았다”는 식으로 응답

LM Studio 결과:

```text
제목은 '2026 매스 & 사이언스 아트 작품공모전 안내'이며,
접수기간은 7.1.~8.23.입니다.
```

정상적으로 읽었습니다.

### 결론

현재 테스트 기준으로는 Codmes Search 로직 문제가 아닙니다.

문제는 다음에 가깝습니다.

```text
Ollama + gemma4:12b-mlx 조합에서 이미지 입력이 모델로 제대로 전달되지 않음
```

텍스트-only 대화와 PDF 텍스트 추출은 정상입니다. 깨지는 부분은 이미지 입력/VLM 경로입니다.

따라서 현재 Codmes에서 VLM OCR용으로는 다음 설정이 더 안전합니다.

```text
Provider: LM Studio
Base URL: http://127.0.0.1:1234/v1
Model: gemma-4-12b-it-mlx
```

Ollama를 VLM OCR용으로 쓰려면, 먼저 VLM probe를 통과하는 모델/태그/런타임 조합을 확인해야 합니다.

## 온도와 컨텍스트 윈도우 문제는?

온도와 컨텍스트 윈도우도 항상 확인해야 합니다.

다만 이번 테스트에서는 이미지가 매우 작고 단순했습니다.

- 테스트 PNG 크기: 약 523 KB
- PDF 페이지 이미지 크기: 약 293 KB
- 질문도 짧음
- LM Studio는 같은 이미지에서 즉시 성공

그래서 이번 실패의 주원인은 컨텍스트 윈도우 초과나 temperature 문제가 아니라, Ollama의 해당 모델 이미지 입력 처리 경로 문제로 보는 것이 가장 타당합니다.

## VLM 호출 기본값

VLM은 일반 대화처럼 창의적으로 답하는 모델이 아니라, 이미지/PDF 페이지에서 보이는 텍스트를 정확히 읽는 역할입니다.

그래서 Codmes 서버의 VLM 호출 기본 정책은 다음처럼 고정합니다.

```text
temperature: 0
reasoning/thinking: off
stream: false
max output: bounded
```

Provider별 요청 형식은 조금 다릅니다.

OpenAI-compatible VLM:

```json
{
  "temperature": 0,
  "stream": false,
  "max_tokens": 800
}
```

Ollama native VLM:

```json
{
  "stream": false,
  "think": false,
  "options": {
    "temperature": 0,
    "num_predict": 800
  }
}
```

이 정책은 `server/lib/vlm-runtime.mjs`에 공용 helper로 들어가 있습니다. VLM probe와 scanned PDF OCR 경로는 이 helper를 사용합니다.

PDF/image 문서 추출 단계의 VLM OCR 통합 지점은 다음 파일입니다.

```text
server/lib/document-ingest.mjs
```

VLM 설정이 없으면 기존 텍스트 추출만 수행합니다. VLM 설정이 있고 PDF 텍스트가 거의 없거나 이미지 파일이면 VLM OCR block을 추가합니다.

## PDF 위에 사용자가 붙인 이미지도 검색되나

네. 서버 annotation JSON에 저장된 PDF object도 검색 대상에 포함됩니다.

현재 지원되는 annotation 검색 source는 다음과 같습니다.

```text
annotation-text
  PDF 위에 사용자가 만든 텍스트 박스

annotation-image-ocr
  PDF 위에 사용자가 붙인 이미지/sticker/photo를 VLM OCR한 텍스트
```

흐름은 다음과 같습니다.

```text
사용자가 PDF 위에 이미지 첨부
  -> annotation object에 dataBase64 / bbox / pageIndex 저장
  -> Search index 생성 또는 갱신
  -> annotation image contentHash 확인
  -> OCR cache가 있으면 재사용
  -> OCR cache가 없으면 VLM OCR 실행
  -> source: "annotation-image-ocr" block 생성
  -> 검색 결과에서 현재 PDF/page/annotation bbox로 이동 가능
```

이미지 위치와 OCR 결과는 의도적으로 분리합니다.

```text
이미지 내용
  -> contentHash 기준 OCR cache
  -> .codmes/index/annotation-ocr/

이미지 위치/크기
  -> annotation object의 pageIndex/bbox
  -> 사용자가 이동/크기 변경할 때마다 최신 값 사용
```

따라서 사용자가 이미지를 옮기거나 크기만 바꾸면 VLM OCR은 다시 실행하지 않습니다. 검색 block은 같은 OCR 텍스트를 재사용하면서 bbox만 최신 annotation 값으로 바뀝니다. 이미지 내용 자체가 바뀌어 contentHash가 달라질 때만 OCR을 다시 실행합니다.

따라서 검색 source는 이렇게 나뉩니다.

```text
pdf-text                PDF 원본 텍스트 레이어
pdf-markdown            PDF 원본 구조/표 추출
vlm-ocr                 스캔 PDF 또는 이미지 배경 PDF 페이지 OCR
annotation-text         PDF 위 텍스트 박스
annotation-image-ocr    PDF 위 첨부 이미지 OCR
```

아직 손글씨 필기(`ink`) 자체의 handwriting OCR은 별도 단계입니다. 현재는 portable `inkStrokes` 저장/동기화와 이미지/text annotation 검색 기반을 분리해 둔 상태입니다.

## 앞으로 Search 설정에 들어가야 할 것

Search 설정에는 단순 모델 선택만 있으면 부족합니다.

필요한 기능:

- Embedding provider/model 선택
- VLM provider/model 선택
- indexing roots 설정
- index rebuild 버튼
- realtime indexing 상태 표시
- VLM probe 버튼
- 마지막 probe 성공/실패 기록
- PDF/image extraction 상태 확인

이렇게 해야 사용자는 “모델을 골랐는데 왜 OCR이 안 되지?” 같은 문제를 설정 화면에서 바로 확인할 수 있습니다.
