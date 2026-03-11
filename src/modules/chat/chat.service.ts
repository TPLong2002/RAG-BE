import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Document } from '@langchain/core/documents';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { LlmService } from '../llm/llm.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import { GraphService } from '../graph/graph.service';
import { Neo4jHybridRetriever } from './neo4j-retriever';
import type { ChatRequest, ChatSource, EmbeddingProvider } from '../../common/types';

const SYSTEM_PROMPT = `You are a knowledgeable assistant specialized in answering questions based on provided documents.

STRICT Instructions:
- Answer ONLY based on the provided context. Do not make up information.
- **Keep your answers short and concise**.
- If the context doesn't contain enough information, say so clearly.
- When information comes from multiple documents, synthesize the answer and cite each source.
- Reference sources by their document name, e.g. "(from filename.pdf)".
- For technical/database questions, be precise with table names, column names, relationships, and data types.
- If context chunks are labeled [neighbor] or [similar], they provide additional related context.
- If a [schema] section is provided, it contains extracted database table definitions (columns, types, primary keys, foreign keys). Use this structured schema to give precise answers about table design, relationships, and data modeling.

Context:
{context}`;

@Injectable()
export class ChatService {
  private prompt: ChatPromptTemplate;

  constructor(
    private embeddingsService: EmbeddingsService,
    private llmService: LlmService,
    private neo4jService: Neo4jService,
    private graphService: GraphService,
    private configService: ConfigService,
  ) {
    this.prompt = ChatPromptTemplate.fromMessages([
      ['system', SYSTEM_PROMPT],
      ['human', '{question}'],
    ]);
  }

  private buildContext(docs: Document[]): string {
    const sorted = [...docs].sort((a, b) => {
      const docCmp = String(a.metadata.documentId).localeCompare(String(b.metadata.documentId));
      if (docCmp !== 0) return docCmp;
      return (a.metadata.chunkIndex as number) - (b.metadata.chunkIndex as number);
    });

    return sorted
      .map((d, i) => {
        const tag = d.metadata._graphSource ? ` [${d.metadata._graphSource}]` : '';
        return `[${i + 1}] (${d.metadata.fileName || 'unknown'})${tag} ${d.pageContent}`;
      })
      .join('\n\n');
  }

  private buildSources(docs: Document[]): ChatSource[] {
    return docs.map((d) => ({
      documentId: d.metadata.documentId as string,
      fileName:
        d.metadata._graphSource === 'schema'
          ? 'Database Schema'
          : (d.metadata.fileName as string) || 'unknown',
      chunkIndex: d.metadata.chunkIndex as number,
      content: d.pageContent,
      score: (d.metadata._score as number) ?? 0,
      graphSource: (d.metadata._graphSource as string) || undefined,
    }));
  }

  private async enhanceWithGraphContext(docs: Document[]): Promise<Document[]> {
    try {
      const chunkIds = docs.map((d) => {
        const docId = d.metadata.documentId as string;
        const idx = d.metadata.chunkIndex as number;
        return `${docId}_chunk_${idx}`;
      });

      const seenChunkIds = new Set(chunkIds);
      const additional: Document[] = [];

      // 1. Neighbor chunks (prev/next)
      const neighbors = await this.graphService.getNeighborChunks(chunkIds);
      for (const n of neighbors) {
        if (n.prevChunkId && !seenChunkIds.has(n.prevChunkId) && n.prevText) {
          seenChunkIds.add(n.prevChunkId);
          const [docId] = n.prevChunkId.split('_chunk_');
          additional.push(
            new Document({
              pageContent: n.prevText,
              metadata: { documentId: docId, fileName: n.prevFileName, chunkIndex: n.prevIndex, _graphSource: 'neighbor' },
            }),
          );
        }
        if (n.nextChunkId && !seenChunkIds.has(n.nextChunkId) && n.nextText) {
          seenChunkIds.add(n.nextChunkId);
          const [docId] = n.nextChunkId.split('_chunk_');
          additional.push(
            new Document({
              pageContent: n.nextText,
              metadata: { documentId: docId, fileName: n.nextFileName, chunkIndex: n.nextIndex, _graphSource: 'neighbor' },
            }),
          );
        }
      }

      // 2. Cross-document similar chunks
      const similar = await this.graphService.getSimilarChunksFromGraph(chunkIds, 3);
      for (const sc of similar) {
        if (!seenChunkIds.has(sc.chunkId)) {
          seenChunkIds.add(sc.chunkId);
          additional.push(
            new Document({
              pageContent: sc.text,
              metadata: {
                documentId: sc.documentId,
                fileName: sc.fileName,
                chunkIndex: sc.chunkIndex,
                _graphSource: 'similar',
              },
            }),
          );
        }
      }

      // 3. Table schema context (via MENTIONS_TABLE)
      const tableContext = await this.graphService.getTableContextForChunks(chunkIds);
      if (tableContext) {
        additional.push(
          new Document({
            pageContent: tableContext,
            metadata: { _graphSource: 'schema', documentId: 'schema', chunkIndex: -1 },
          }),
        );
      }

      return [...docs, ...additional];
    } catch (err) {
      console.error('Graph enhancement failed:', err);
      return docs;
    }
  }

  async chatStream(
    req: ChatRequest,
    onChunk: (text: string) => void,
  ): Promise<ChatSource[]> {
    const defaultProvider = this.configService.get<string>('embedding.defaultProvider', 'openai') as EmbeddingProvider;
    const defaultModel = this.configService.get<string>('embedding.defaultModel', 'text-embedding-3-small');

    console.log(
      '🚀 ~ chatStream ~ config.embedding',
      defaultProvider,
      defaultModel,
    );

    const embeddings = this.embeddingsService.createEmbeddings(
      defaultProvider,
      defaultModel,
    );
    const llm = this.llmService.createLLM(req.provider, req.model);

    const retriever = new Neo4jHybridRetriever({
      embeddings,
      neo4jService: this.neo4jService,
      configService: this.configService,
      k: this.configService.get<number>('search.topK'),
      documentIds: req.documentIds,
      userId: req.userId,
    });

    const docs = await retriever.invoke(req.question);
    // TODO: enhance with graph context
    const enhancedDocs = await this.enhanceWithGraphContext(docs);

    const context = this.buildContext(enhancedDocs);

    const chain = this.prompt.pipe(llm).pipe(new StringOutputParser());
    const stream = await chain.stream({ context, question: req.question });

    for await (const chunk of stream) {
      onChunk(chunk);
    }

    return this.buildSources(enhancedDocs);
  }
}
