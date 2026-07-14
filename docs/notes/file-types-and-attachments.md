# File Types And Attachments

Codmes treats Notes files, PDFs, and attachments as workspace resources owned by
the server. Apple clients display and edit them, while the server owns metadata,
extraction, indexing, and RAG retrieval.

## Workspace Roots

Default user-facing roots:

```text
Codmes/
├── Notes/
├── Code/
├── Documents/
├── Attachments/
└── .codmes/
```

Hidden Codmes state stays in `.codmes` folders. For PDF annotation state, the
hidden state is placed next to the document folder so copying or moving a folder
can carry editable PDF notes with it.

## File Classification

| File type | Typical root | Current behavior |
| --- | --- | --- |
| Markdown: `.md`, `.markdown`, `.mdx` | `Notes/` | Read as text, rendered as Markdown, indexed as note/search chunks, available through `read_note_file` and `codmes_search`. |
| Plain text and code-like text | `Notes/`, `Code/`, `Documents/` | Read as UTF-8 text when safe, indexed by the search layer, returned with snippets. |
| PDF: `.pdf` | `Notes/`, `Documents/`, `Attachments/` | Served as raw PDF for preview, extracted by the document ingest worker, indexed for search/RAG, and paired with optional `.codmes` annotation state. |
| PDF annotation state: `.codmes/annotations/*.codmes.json` | Hidden beside the PDF folder | Stores editable ink, text objects, and image objects. It is app state, not a user note to show in normal trees. |
| Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.tif`, `.tiff`, `.heic` | `Attachments/` or PDF annotation objects | Can be indexed through document ingest/OCR paths where configured. Image annotation objects can be OCRed and cached by content hash. |
| Office and HWP: `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx`, `.hwp`, `.hwpx`, `.odt`, `.odp` | `Documents/`, `Attachments/` | Sent through the document ingest worker and indexed when extraction succeeds. |
| ZIP: `.zip` | `Attachments/`, `Documents/` | Document ingest supports ZIP as a container for supported formats. |
| Unknown binary | Any root | Stored and listed as a file, but not guaranteed to be readable or searchable. |

## Attachment Rules

Attachments are normal workspace files unless they are embedded inside a PDF
annotation object. Embedded PDF image annotations store their payload in
`PDFAnnotationObject.dataBase64` and metadata such as MIME type, file name, and
OCR text when available.

Server-side indexing treats annotation objects as additional searchable blocks:

- Text annotation objects become `source: "annotation-text"` blocks.
- Image annotation objects become `source: "annotation-image-ocr"` blocks if
  they already have text metadata or if VLM OCR is enabled and succeeds.
- Image OCR cache files live under `.codmes/index/annotation-ocr/`.

## Search And RAG

The built-in search path is `codmes_search`. It searches indexed notes,
documents, PDFs, code, and conversation text. The current index is chunk based;
embedding provider/model settings are stored, but a native vector store and
semantic reranking remain future work.

For a Notes surface conversation:

1. Small known files can be read directly through `read_note_file`.
2. Broad questions should use `codmes_search` or `workspace_search`.
3. Retrieved chunks are passed back to the model as tool results or
   `workspaceContext.searchResults`.
4. The model answers from retrieved context instead of receiving a huge bundle
   of raw files.

## OCR Status

Implemented or wired in code:

- Text-layer PDF extraction through the document ingest worker.
- PDF Markdown/table extraction through PyMuPDF/PyMuPDF4LLM dependencies.
- VLM OCR blocks for scanned or text-poor PDFs/images when Search VLM settings
  enable a provider/model.
- OCR for embedded PDF image annotation objects, cached by image content hash.

Not implemented yet:

- Handwriting OCR over pen `inkStrokes`.
- Stable selectable OCR text overlays with bounding boxes for scanned pages.
- Page-level OCR/embedding invalidation after PDF insertion; current refresh is
  document-level.
