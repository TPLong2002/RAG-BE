import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { Document } from '@langchain/core/documents';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { LlmService } from '../llm/llm.service';
import { Neo4jService } from '../neo4j/neo4j.service';
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
    const enhancedDocs = docs;

    const context = this.buildContext(enhancedDocs);

    const chain = this.prompt.pipe(llm).pipe(new StringOutputParser());
    const stream = await chain.stream({ context, question: req.question });

    for await (const chunk of stream) {
      onChunk(chunk);
    }

    return this.buildSources(enhancedDocs);
  }
}
