# Server 문서

- [아키텍처](architecture.md)
- [데이터와 저장 경로](data-model.md)
- [HTTP 및 WebSocket API](api-contract.md)

Search는 server index뿐 아니라 client UI와 LLM retrieval을 함께 다루는 독립
도메인이므로 [Search 문서](../search/README.md)에서 관리한다.

서버 route의 최종 기준은 `server/index.mjs`, 저장 경로와 runtime 동작의 최종
기준은 `server/lib` 구현과 test다.
