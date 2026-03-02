import neo4j from 'neo4j-driver';
import { BaseRetriever } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import type { Embeddings } from '@langchain/core/embeddings';
import { Neo4jService } from '../neo4j/neo4j.service';
import { ConfigService } from '@nestjs/config';

export interface Neo4jHybridRetrieverOptions {
  embeddings: Embeddings;
  neo4jService: Neo4jService;
  configService: ConfigService;
  k?: number;
  documentIds?: string[];
  userId?: string;
}

export class Neo4jHybridRetriever extends BaseRetriever {
  lc_namespace = ['custom', 'neo4j'];

  private embeddings: Embeddings;
  private neo4jService: Neo4jService;
  private k: number;
  private documentIds?: string[];
  private userId?: string;
  private vectorWeight: number;
  private fulltextWeight: number;

  constructor(fields: Neo4jHybridRetrieverOptions) {
    super();
    this.embeddings = fields.embeddings;
    this.neo4jService = fields.neo4jService;
    this.k = fields.k ?? fields.configService.get<number>('search.topK') ?? 5;
    this.vectorWeight = fields.configService.get<number>('search.vectorWeight') ?? 0.7;
    this.fulltextWeight = fields.configService.get<number>('search.fulltextWeight') ?? 0.3;
    this.documentIds = fields.documentIds;
    this.userId = fields.userId;
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const queryVector = await this.embeddings.embedQuery(query);
    const candidateK = neo4j.int(this.k * 3);

    const vectorResults = await this.neo4jService.runQuery<{
      chunkId: string;
      text: string;
      documentId: string;
      fileName: string;
      fileType: string;
      chunkIndex: number;
      ownerId: string;
      accessControlPublic: boolean;
      allowedUsers: string[];
      score: number;
    }>(
      `CALL db.index.vector.queryNodes('chunk_embeddings', $topK, $vector)
       YIELD node, score
       RETURN node.chunkId AS chunkId, node.text AS text,
              node.documentId AS documentId, node.fileName AS fileName,
              node.fileType AS fileType, node.chunkIndex AS chunkIndex,
              node.ownerId AS ownerId,
              node.accessControlPublic AS accessControlPublic,
              node.allowedUsers AS allowedUsers,
              score`,
      { topK: candidateK, vector: queryVector },
    );

    const sanitizedQuery = query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').trim();
    const fulltextResults = sanitizedQuery
      ? await this.neo4jService.runQuery<{
          chunkId: string;
          text: string;
          documentId: string;
          fileName: string;
          fileType: string;
          chunkIndex: number;
          ownerId: string;
          accessControlPublic: boolean;
          allowedUsers: string[];
          score: number;
        }>(
          `CALL db.index.fulltext.queryNodes('chunk_fulltext', $query)
           YIELD node, score
           WITH node, score LIMIT $topK
           RETURN node.chunkId AS chunkId, node.text AS text,
                  node.documentId AS documentId, node.fileName AS fileName,
                  node.fileType AS fileType, node.chunkIndex AS chunkIndex,
                  node.ownerId AS ownerId,
                  node.accessControlPublic AS accessControlPublic,
                  node.allowedUsers AS allowedUsers,
                  score`,
          { query: sanitizedQuery, topK: candidateK },
        )
      : [];

    const vectorScoreMap = new Map<string, number>();
    for (const r of vectorResults) {
      vectorScoreMap.set(r.chunkId, r.score);
    }

    const rrf = new Map<string, { rrfScore: number; data: (typeof vectorResults)[0] }>();
    const rk = 60;

    vectorResults.forEach((r, i) => {
      const rrfScore = this.vectorWeight / (rk + i + 1);
      rrf.set(r.chunkId, { rrfScore, data: r });
    });

    fulltextResults.forEach((r, i) => {
      const rrfScore = this.fulltextWeight / (rk + i + 1);
      const existing = rrf.get(r.chunkId);
      if (existing) {
        existing.rrfScore += rrfScore;
      } else {
        rrf.set(r.chunkId, { rrfScore, data: r });
      }
    });

    let results = [...rrf.values()].sort((a, b) => b.rrfScore - a.rrfScore);

    if (this.userId) {
      results = results.filter((r) => {
        const d = r.data;
        return (
          d.accessControlPublic === true ||
          d.ownerId === this.userId ||
          (d.allowedUsers && d.allowedUsers.includes(this.userId!))
        );
      });
    }

    if (this.documentIds?.length) {
      results = results.filter((r) => this.documentIds!.includes(r.data.documentId));
    }

    return results.slice(0, this.k).map((r) => {
      const d = r.data;
      return new Document({
        pageContent: d.text,
        metadata: {
          documentId: d.documentId,
          fileName: d.fileName,
          fileType: d.fileType,
          chunkIndex: d.chunkIndex,
          ownerId: d.ownerId,
          _score: vectorScoreMap.get(d.chunkId) ?? d.score,
        },
      });
    });
  }
}
