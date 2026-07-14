# Search And RAG Documentation

This folder documents Codmes Search and RAG as workspace-wide server features.
They are used by Notes, Code, Documents, PDF annotation indexing, and
conversation recall; they are not Notes-only features.

## Start Here

- [Codmes Search Integration](codmes-search-integration.md): built-in search API,
  extraction worker, OCR/VLM settings, and annotation OCR.
- [Codmes Search Explained](codmes-search-explained.md): beginner-friendly search
  and VLM walkthrough.
- [RAG Backend Design](rag-backend-design.md): server-side context routing and
  current RAG limitations.

## Scope

Codmes Search can index and retrieve from:

- Notes and Markdown/text files
- PDFs and PDF annotation text/image OCR blocks
- Documents and attachments such as Office, HWP/HWPX, image, and ZIP files
- Code files where the workspace search layer is appropriate
- Conversation/session/memory search paths exposed by runtime tools

Notes surface documentation links here when it describes how notes and PDFs
enter search/RAG, but ownership of the search runtime belongs here.
