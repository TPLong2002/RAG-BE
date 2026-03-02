# Migration từ Express sang NestJS

## Cấu trúc mới

```
src/
├── common/
│   ├── types/index.ts          # Types từ src-old/types
│   ├── guards/auth.guard.ts    # Auth middleware
│   └── decorators/user-id.decorator.ts
├── config/
│   └── configuration.ts        # Config từ src-old/config
├── modules/
│   ├── neo4j/                  # Neo4j service
│   ├── embeddings/             # Embeddings service
│   ├── llm/                    # LLM service
│   ├── chat/                   # Chat module (SSE streaming)
│   ├── document/               # Document upload/list/delete
│   └── model/                  # Model listing endpoints
├── app.module.ts
└── main.ts
```

## Chuyển đổi chính

### 1. Config
- `src-old/config/index.ts` → `src/config/configuration.ts`
- Sử dụng `@nestjs/config` với `ConfigService`

### 2. Neo4j
- `src-old/lib/neo4j.ts` → `src/modules/neo4j/neo4j.service.ts`
- Implements `OnModuleInit`, `OnModuleDestroy`

### 3. Embeddings & LLM
- `src-old/lib/embeddings.ts` → `src/modules/embeddings/embeddings.service.ts`
- `src-old/lib/llm.ts` → `src/modules/llm/llm.service.ts`

### 4. Chat Module
- `src-old/routes/chat.routes.ts` → `src/modules/chat/chat.controller.ts`
- `src-old/services/chat.service.ts` → `src/modules/chat/chat.service.ts`
- `src-old/lib/neo4j-retriever.ts` → `src/modules/chat/neo4j-retriever.ts`
- **Giữ nguyên SSE streaming**

### 5. Document Module
- `src-old/routes/document.routes.ts` → `src/modules/document/document.controller.ts`
- `src-old/services/document.service.ts` → `src/modules/document/document.service.ts`
- `src-old/services/file-parser.service.ts` → `src/modules/document/file-parser.service.ts`
- Sử dụng `@nestjs/platform-express` với `FilesInterceptor`

### 6. Auth
- `src-old/middleware/auth.ts` → `src/common/guards/auth.guard.ts`
- Thêm decorator `@UserId()` để lấy userId

## API Endpoints (giống Express)

- `POST /api/chat` - Chat với SSE streaming
- `POST /api/documents/upload` - Upload files
- `GET /api/documents` - List documents
- `DELETE /api/documents/:id` - Delete document
- `GET /api/models/llm` - List LLM models
- `GET /api/models/embedding` - List embedding models
- `GET /health` - Health check

## Chạy app

```bash
# Development
npm run start:dev

# Production build
npm run build
npm run start:prod
```

## Các tính năng chưa migrate

- Graph service (computeCrossDocumentSimilarity, etc.)
- Schema extraction service
- Graph routes

Có thể thêm sau nếu cần.

## Dependencies đã thêm

- `@nestjs/config` - Config management
- `class-validator` - DTO validation
- `class-transformer` - DTO transformation
- Các packages langchain, neo4j như cũ

## Notes

- Đã move `src-old` ra ngoài project để tránh conflict
- Tất cả logic business giữ nguyên
- SSE streaming hoạt động như cũ
- Neo4j auto-init khi start app
