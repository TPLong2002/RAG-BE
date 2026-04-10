import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Neo4jService } from '../neo4j/neo4j.service';
import neo4j from 'neo4j-driver';
import { ChunkNeighbors } from 'src/common/types';

export interface SimilarityPair {
  sourceChunkId: string;
  targetChunkId: string;
  score: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties: Record<string, any>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  properties: Record<string, any>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RelatedDocument {
  documentId: string;
  fileName: string;
  score: number;
  connectionCount: number;
}

@Injectable()
export class GraphService {
  constructor(
    private readonly neo4jService: Neo4jService,
    private readonly configService: ConfigService,
  ) {}

  private async runWithDeadlockRetry(
    cypher: string,
    params: Record<string, unknown>,
    maxRetries = 3,
  ): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.neo4jService.runQuery(cypher, params);
        return;
      } catch (err: any) {
        const isDeadlock = err?.code === 'Neo.TransientError.Transaction.DeadlockDetected'
          || err?.message?.includes('deadlock');
        if (isDeadlock && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 100 + Math.random() * 100;
          console.warn(`Deadlock detected, retrying (${attempt + 1}/${maxRetries}) after ${Math.round(delay)}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  async getRelatedDocuments(documentId: string): Promise<RelatedDocument[]> {
    return this.neo4jService.runQuery<RelatedDocument>(
      `MATCH (d:Document {documentId: $documentId})-[r:RELATED_TO]-(other:Document)
       RETURN other.documentId AS documentId, other.fileName AS fileName,
              r.score AS score, r.connectionCount AS connectionCount
       ORDER BY r.score DESC`,
      { documentId },
    );
  }

  async getDocumentGraph(documentId?: string): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeSet = new Set<string>();

    if (documentId) {
      const results = await this.neo4jService.runQuery<{
        docId: string;
        docName: string;
        docType: string;
        chunks: number;
        relDocId: string | null;
        relDocName: string | null;
        relScore: number | null;
        relCount: number | null;
        edgeSrc: string | null;
        edgeTgt: string | null;
      }>(
        `MATCH (d:Document {documentId: $documentId})
         OPTIONAL MATCH (d)-[r1:RELATED_TO]->(tgt:Document)
         WITH d, collect({r: r1, other: tgt, src: d, tgtNode: tgt}) AS outgoing
         OPTIONAL MATCH (src:Document)-[r2:RELATED_TO]->(d)
         WITH d, outgoing, collect({r: r2, other: src, src: src, tgtNode: d}) AS incoming
         WITH d, outgoing + incoming AS allRels
         UNWIND (CASE WHEN size(allRels) = 0 THEN [null] ELSE allRels END) AS rel
         RETURN d.documentId AS docId, d.fileName AS docName, d.fileType AS docType,
                d.totalChunks AS chunks,
                CASE WHEN rel IS NULL THEN null ELSE rel.other.documentId END AS relDocId,
                CASE WHEN rel IS NULL THEN null ELSE rel.other.fileName END AS relDocName,
                CASE WHEN rel IS NULL THEN null ELSE rel.r.score END AS relScore,
                CASE WHEN rel IS NULL THEN null ELSE rel.r.connectionCount END AS relCount,
                CASE WHEN rel IS NULL THEN null ELSE rel.src.documentId END AS edgeSrc,
                CASE WHEN rel IS NULL THEN null ELSE rel.tgtNode.documentId END AS edgeTgt`,
        { documentId },
      );

      for (const row of results) {
        if (!nodeSet.has(row.docId)) {
          nodeSet.add(row.docId);
          nodes.push({
            id: row.docId,
            label: row.docName,
            type: 'document',
            properties: { fileType: row.docType, totalChunks: row.chunks },
          });
        }
        if (row.relDocId && !nodeSet.has(row.relDocId)) {
          nodeSet.add(row.relDocId);
          nodes.push({
            id: row.relDocId,
            label: row.relDocName!,
            type: 'document',
            properties: {},
          });
        }
        if (row.relDocId && row.edgeSrc && row.edgeTgt) {
          edges.push({
            source: row.edgeSrc,
            target: row.edgeTgt,
            type: 'RELATED_TO',
            properties: { score: row.relScore, connectionCount: row.relCount },
          });
        }
      }
    } else {
      const results = await this.neo4jService.runQuery<{
        docId: string;
        docName: string;
        docType: string;
        chunks: number;
      }>(
        `MATCH (d:Document)
         RETURN d.documentId AS docId, d.fileName AS docName, d.fileType AS docType,
                d.totalChunks AS chunks
         ORDER BY d.uploadedAt DESC LIMIT 50`,
      );

      for (const row of results) {
        nodes.push({
          id: row.docId,
          label: row.docName,
          type: 'document',
          properties: { fileType: row.docType, totalChunks: row.chunks },
        });
        nodeSet.add(row.docId);
      }

      const rels = await this.neo4jService.runQuery<{
        source: string;
        target: string;
        score: number;
        count: number;
      }>(
        `MATCH (d1:Document)-[r:RELATED_TO]->(d2:Document)
         WHERE d1.documentId IN $ids AND d2.documentId IN $ids
         RETURN d1.documentId AS source, d2.documentId AS target,
                r.score AS score, r.connectionCount AS count`,
        { ids: [...nodeSet] },
      );

      for (const rel of rels) {
        if (!nodeSet.has(rel.source)) {
          nodeSet.add(rel.source);
          nodes.push({ id: rel.source, label: rel.source, type: 'document', properties: {} });
        }
        if (!nodeSet.has(rel.target)) {
          nodeSet.add(rel.target);
          nodes.push({ id: rel.target, label: rel.target, type: 'document', properties: {} });
        }
        edges.push({
          source: rel.source,
          target: rel.target,
          type: 'RELATED_TO',
          properties: { score: rel.score, connectionCount: rel.count },
        });
      }
    }

    return { nodes, edges };
  }

  async getChunkGraph(documentId: string): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeSet = new Set<string>();

    const chunks = await this.neo4jService.runQuery<{
      chunkId: string;
      chunkIndex: number;
      fileName: string;
      textPreview: string;
    }>(
      `MATCH (d:Document {documentId: $documentId})-[:HAS_CHUNK]->(c:Chunk)
       RETURN c.chunkId AS chunkId, c.chunkIndex AS chunkIndex,
              c.fileName AS fileName, left(c.text, 100) AS textPreview
       ORDER BY c.chunkIndex`,
      { documentId },
    );

    for (const c of chunks) {
      nodeSet.add(c.chunkId);
      nodes.push({
        id: c.chunkId,
        label: `Chunk ${c.chunkIndex}`,
        type: 'chunk',
        properties: { fileName: c.fileName, textPreview: c.textPreview },
      });
    }

    const nextLinks = await this.neo4jService.runQuery<{ from: string; to: string }>(
      `MATCH (d:Document {documentId: $documentId})-[:HAS_CHUNK]->(c:Chunk)-[:NEXT_CHUNK]->(n:Chunk)
       RETURN c.chunkId AS from, n.chunkId AS to`,
      { documentId },
    );

    for (const link of nextLinks) {
      edges.push({ source: link.from, target: link.to, type: 'NEXT_CHUNK', properties: {} });
    }

    const simLinks = await this.neo4jService.runQuery<{
      from: string;
      to: string;
      toFileName: string;
      score: number;
    }>(
      `CALL {
         MATCH (d:Document {documentId: $documentId})-[:HAS_CHUNK]->(c:Chunk)
         MATCH (c)-[s:SIMILAR_TO]->(other:Chunk) WHERE other.documentId <> $documentId
         RETURN c.chunkId AS from, other.chunkId AS to, other.fileName AS toFileName, s.score AS score
         UNION
         MATCH (d:Document {documentId: $documentId})-[:HAS_CHUNK]->(c:Chunk)
         MATCH (other:Chunk)-[s:SIMILAR_TO]->(c) WHERE other.documentId <> $documentId
         RETURN c.chunkId AS from, other.chunkId AS to, other.fileName AS toFileName, s.score AS score
       }
       RETURN from, to, toFileName, score
       LIMIT 20`,
      { documentId },
    );

    for (const link of simLinks) {
      if (!nodeSet.has(link.to)) {
        nodeSet.add(link.to);
        nodes.push({
          id: link.to,
          label: `${link.toFileName} (external)`,
          type: 'chunk',
          properties: { external: true },
        });
      }
      edges.push({
        source: link.from,
        target: link.to,
        type: 'SIMILAR_TO',
        properties: { score: link.score },
      });
    }

    return { nodes, edges };
  }

  async getSchemaGraph(documentId?: string): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeSet = new Set<string>();

    if (documentId) {
      const results = await this.neo4jService.runQuery<{
        tableName: string;
        displayName: string;
        description: string;
        columns: string;
        relatedTable: string | null;
        relatedDisplayName: string | null;
        relatedDescription: string | null;
        relatedColumns: string | null;
        fkFromCol: string | null;
        fkToCol: string | null;
        fkDirection: string | null;
      }>(
        `MATCH (d:Document {documentId: $documentId})-[:HAS_TABLE]->(t:Table)
         OPTIONAL MATCH (t)-[fk:FOREIGN_KEY]->(other:Table)
         RETURN t.name AS tableName, t.displayName AS displayName,
                t.description AS description, t.columns AS columns,
                other.name AS relatedTable, other.displayName AS relatedDisplayName,
                other.description AS relatedDescription, other.columns AS relatedColumns,
                fk.fromColumn AS fkFromCol, fk.toColumn AS fkToCol, 'out' AS fkDirection
         UNION
         MATCH (d:Document {documentId: $documentId})-[:HAS_TABLE]->(t:Table)
         OPTIONAL MATCH (other:Table)-[fk:FOREIGN_KEY]->(t)
         WHERE other IS NOT NULL
         RETURN t.name AS tableName, t.displayName AS displayName,
                t.description AS description, t.columns AS columns,
                other.name AS relatedTable, other.displayName AS relatedDisplayName,
                other.description AS relatedDescription, other.columns AS relatedColumns,
                fk.fromColumn AS fkFromCol, fk.toColumn AS fkToCol, 'in' AS fkDirection`,
        { documentId },
      );

      for (const row of results) {
        if (!nodeSet.has(row.tableName)) {
          nodeSet.add(row.tableName);
          nodes.push({
            id: row.tableName,
            label: row.displayName,
            type: 'table',
            properties: { description: row.description, columns: row.columns },
          });
        }
        if (row.relatedTable && !nodeSet.has(row.relatedTable)) {
          nodeSet.add(row.relatedTable);
          nodes.push({
            id: row.relatedTable,
            label: row.relatedDisplayName!,
            type: 'table',
            properties: { description: row.relatedDescription, columns: row.relatedColumns },
          });
        }
        if (row.relatedTable && row.fkFromCol) {
          const source = row.fkDirection === 'out' ? row.tableName : row.relatedTable;
          const target = row.fkDirection === 'out' ? row.relatedTable : row.tableName;
          edges.push({
            source,
            target,
            type: 'FOREIGN_KEY',
            properties: { fromColumn: row.fkFromCol, toColumn: row.fkToCol },
          });
        }
      }
    } else {
      const tables = await this.neo4jService.runQuery<{
        name: string;
        displayName: string;
        description: string;
        columns: string;
      }>(
        `MATCH (t:Table)
         RETURN t.name AS name, t.displayName AS displayName,
                t.description AS description, t.columns AS columns
         LIMIT 200`,
      );

      for (const t of tables) {
        nodeSet.add(t.name);
        nodes.push({
          id: t.name,
          label: t.displayName,
          type: 'table',
          properties: { description: t.description, columns: t.columns },
        });
      }

      const fks = await this.neo4jService.runQuery<{
        from: string;
        to: string;
        fromCol: string;
        toCol: string;
      }>(
        `MATCH (t1:Table)-[fk:FOREIGN_KEY]->(t2:Table)
         WHERE t1.name IN $names AND t2.name IN $names
         RETURN t1.name AS from, t2.name AS to,
                fk.fromColumn AS fromCol, fk.toColumn AS toCol`,
        { names: [...nodeSet] },
      );

      for (const fk of fks) {
        edges.push({
          source: fk.from,
          target: fk.to,
          type: 'FOREIGN_KEY',
          properties: { fromColumn: fk.fromCol, toColumn: fk.toCol },
        });
      }
    }

    // Deduplicate edges
    const edgeSet = new Set<string>();
    const uniqueEdges = edges.filter((e) => {
      const key = `${e.source}->${e.target}:${e.properties.fromColumn}->${e.properties.toColumn}`;
      if (edgeSet.has(key)) return false;
      edgeSet.add(key);
      return true;
    });

    return { nodes, edges: uniqueEdges };
  }

  async computeCrossDocumentSimilarity(
    documentId: string,
    chunkTexts: string[],
    vectors: number[][],
  ): Promise<void> {
    const topK = this.configService.get<number>('graph.similarityTopK', 5);
    const threshold = this.configService.get<number>('graph.similarityThreshold', 0.8);

    const chunkSearches = chunkTexts.map(async (_, i) => {
      const sourceChunkId = `${documentId}_chunk_${i}`;
      try {
        const results = await this.neo4jService.runQuery<{
          chunkId: string;
          score: number;
        }>(
          `CALL db.index.vector.queryNodes('chunk_embeddings', $topK, $vector)
           YIELD node, score
           WHERE node.documentId <> $documentId AND score >= $threshold
           RETURN node.chunkId AS chunkId, score
           LIMIT $topK`,
          { topK: neo4j.int(topK), vector: vectors[i], documentId, threshold },
        );
        return results.map((r) => ({
          sourceChunkId,
          targetChunkId: r.chunkId,
          score: r.score,
        }));
      } catch (err) {
        console.error(`Similarity search failed for chunk ${i}:`, err);
        return [];
      }
    });

    const pairsNested = await Promise.all(chunkSearches);
    const pairs: SimilarityPair[] = pairsNested.flat();

    if (pairs.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
        const batch = pairs.slice(i, i + BATCH_SIZE);
        await this.runWithDeadlockRetry(
          `UNWIND $pairs AS pair
           MATCH (a:Chunk {chunkId: pair.sourceChunkId})
           MATCH (b:Chunk {chunkId: pair.targetChunkId})
           WITH a, b, pair,
                CASE WHEN pair.sourceChunkId < pair.targetChunkId THEN a ELSE b END AS src,
                CASE WHEN pair.sourceChunkId < pair.targetChunkId THEN b ELSE a END AS tgt
           MERGE (src)-[r:SIMILAR_TO]->(tgt)
           SET r.score = CASE WHEN r.score IS NULL OR pair.score > r.score THEN pair.score ELSE r.score END`,
          { pairs: batch },
        );
      }
    }
  }

  async getAffectedDocumentIds(documentId: string): Promise<string[]> {
    // Dùng undirected (-) để bắt cả 2 chiều của SIMILAR_TO
    const results = await this.neo4jService.runQuery<{ documentId: string }>(
      `MATCH (d:Document {documentId: $documentId})-[:HAS_CHUNK]->(:Chunk)
             -[:SIMILAR_TO]-(:Chunk)<-[:HAS_CHUNK]-(other:Document)
       WHERE other.documentId <> $documentId
       RETURN DISTINCT other.documentId AS documentId`,
      { documentId },
    );
    return results.map((r) => r.documentId);
  }

  async computeDocumentRelationships(documentId: string): Promise<void> {
    const minConnections = this.configService.get<number>('graph.minRelatedConnections', 2);

    // Dùng CASE để chuẩn hóa chiều: luôn MERGE theo id nhỏ → id lớn
    // Tránh tạo cả 2 chiều A→B và B→A khi recompute từ cả 2 phía
    await this.runWithDeadlockRetry(
      `MATCH (d1:Document {documentId: $documentId})-[:HAS_CHUNK]->(:Chunk)-[s:SIMILAR_TO]-(:Chunk)<-[:HAS_CHUNK]-(d2:Document)
       WHERE d1 <> d2
       WITH d1, d2, count(s) AS connectionCount, avg(s.score) AS avgScore
       WHERE connectionCount >= $minConnections
       WITH CASE WHEN d1.documentId < d2.documentId THEN d1 ELSE d2 END AS src,
            CASE WHEN d1.documentId < d2.documentId THEN d2 ELSE d1 END AS tgt,
            connectionCount, avgScore
       MERGE (src)-[r:RELATED_TO]->(tgt)
       SET r.score = avgScore, r.connectionCount = connectionCount`,
      { documentId, minConnections: neo4j.int(minConnections) },
    );

    // Xóa stale RELATED_TO: các relationship không còn đủ connectionCount
    await this.runWithDeadlockRetry(
      `MATCH (d:Document {documentId: $documentId})-[r:RELATED_TO]-(other:Document)
       WITH d, other, r
       OPTIONAL MATCH (d)-[:HAS_CHUNK]->(:Chunk)-[s:SIMILAR_TO]-(:Chunk)<-[:HAS_CHUNK]-(other)
       WITH d, other, r, count(s) AS cntForward
       OPTIONAL MATCH (d)-[:HAS_CHUNK]->(:Chunk)<-[s2:SIMILAR_TO]-(:Chunk)<-[:HAS_CHUNK]-(other)
       WITH r, cntForward, count(s2) AS cntReverse
       WHERE (cntForward + cntReverse) < $minConnections
       DELETE r`,
      { documentId, minConnections: neo4j.int(minConnections) },
    );
  }

  async deleteTable(tableName: string): Promise<void> {
    await this.neo4jService.runQuery(`MATCH (t:Table {name: $name}) DETACH DELETE t`, {
      name: tableName,
    });
  }

  async deleteForeignKey(
    fromTable: string,
    toTable: string,
    fromColumn: string,
    toColumn: string,
  ): Promise<void> {
    await this.neo4jService.runQuery(
      `MATCH (from:Table {name: $fromTable})-[fk:FOREIGN_KEY {fromColumn: $fromColumn, toColumn: $toColumn}]->(to:Table {name: $toTable})
       DELETE fk`,
      { fromTable, toTable, fromColumn, toColumn },
    );
  }
  
  // ==================== Retrieval Enhancement ====================

  async getNeighborChunks(chunkIds: string[]): Promise<ChunkNeighbors[]> {
    return this.neo4jService.runQuery<ChunkNeighbors>(
      `UNWIND $chunkIds AS cid
       MATCH (c:Chunk {chunkId: cid})
       OPTIONAL MATCH (prev:Chunk)-[:NEXT_CHUNK]->(c)
       OPTIONAL MATCH (c)-[:NEXT_CHUNK]->(next:Chunk)
       RETURN c.chunkId AS chunkId,
              prev.chunkId AS prevChunkId, prev.text AS prevText, prev.chunkIndex AS prevIndex, prev.fileName AS prevFileName,
              next.chunkId AS nextChunkId, next.text AS nextText, next.chunkIndex AS nextIndex, next.fileName AS nextFileName`,
      { chunkIds },
    );
  }

  async getSimilarChunksFromGraph(
    chunkIds: string[],
    limit: number = 3,
  ): Promise<
    Array<{
      chunkId: string;
      text: string;
      documentId: string;
      fileName: string;
      chunkIndex: number;
      similarityScore: number;
    }>
  > {
    return this.neo4jService.runQuery(
      `UNWIND $chunkIds AS cid
       MATCH (c:Chunk {chunkId: cid})-[s:SIMILAR_TO]-(related:Chunk)
       WHERE NOT related.chunkId IN $chunkIds
       WITH related, max(s.score) AS similarityScore
       RETURN related.chunkId AS chunkId, related.text AS text,
              related.documentId AS documentId, related.fileName AS fileName,
              related.chunkIndex AS chunkIndex, similarityScore
       ORDER BY similarityScore DESC
       LIMIT $limit`,
      { chunkIds, limit: neo4j.int(limit) },
    );
  }

  async getTableContextForChunks(chunkIds: string[]): Promise<string> {
    if (!chunkIds.length) return '';

    const tables = await this.neo4jService.runQuery<{
      name: string;
      displayName: string;
      description: string;
      columns: string;
    }>(
      `UNWIND $chunkIds AS cid
       MATCH (c:Chunk {chunkId: cid})-[:MENTIONS_TABLE]->(t:Table)
       RETURN DISTINCT t.name AS name, t.displayName AS displayName,
              t.description AS description, t.columns AS columns`,
      { chunkIds },
    );

    if (!tables.length) return '';

    const tableNames = tables.map((t) => t.name);

    const fkTables = await this.neo4jService.runQuery<{
      name: string;
      displayName: string;
      description: string;
      columns: string;
      fkFrom: string;
      fkFromCol: string;
      fkToCol: string;
      direction: string;
    }>(
      `UNWIND $names AS tName
       MATCH (t:Table {name: tName})-[fk:FOREIGN_KEY]->(other:Table)
       WHERE NOT other.name IN $names
       RETURN DISTINCT other.name AS name, other.displayName AS displayName,
              other.description AS description, other.columns AS columns,
              t.name AS fkFrom, fk.fromColumn AS fkFromCol, fk.toColumn AS fkToCol, 'out' AS direction
       UNION
       UNWIND $names AS tName
       MATCH (other:Table)-[fk:FOREIGN_KEY]->(t:Table {name: tName})
       WHERE NOT other.name IN $names
       RETURN DISTINCT other.name AS name, other.displayName AS displayName,
              other.description AS description, other.columns AS columns,
              t.name AS fkFrom, fk.fromColumn AS fkFromCol, fk.toColumn AS fkToCol, 'in' AS direction`,
      { names: tableNames },
    );

    const allNames = [...new Set([...tableNames, ...fkTables.map((t) => t.name)])];
    const fks = await this.neo4jService.runQuery<{
      from: string;
      to: string;
      fromCol: string;
      toCol: string;
    }>(
      `MATCH (t1:Table)-[fk:FOREIGN_KEY]->(t2:Table)
       WHERE t1.name IN $names AND t2.name IN $names
       RETURN t1.name AS from, t2.name AS to,
              fk.fromColumn AS fromCol, fk.toColumn AS toCol`,
      { names: allNames },
    );

    const allTables = [...tables, ...fkTables];
    const seen = new Set<string>();
    const lines: string[] = ['=== DATABASE SCHEMA CONTEXT ==='];

    for (const t of allTables) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);

      lines.push(`\nTable: ${t.displayName}`);
      if (t.description) lines.push(`  Description: ${t.description}`);

      try {
        const cols = JSON.parse(t.columns) as Array<{
          name: string; type: string; nullable: boolean; isPrimaryKey: boolean; description?: string;
        }>;
        lines.push('  Columns:');
        for (const col of cols) {
          const pk = col.isPrimaryKey ? ' [PK]' : '';
          const nullable = col.nullable ? ' NULL' : ' NOT NULL';
          const desc = col.description ? ` -- ${col.description}` : '';
          lines.push(`    - ${col.name} ${col.type}${pk}${nullable}${desc}`);
        }
      } catch { /* skip */ }
    }

    if (fks.length > 0) {
      lines.push('\nForeign Key Relationships:');
      for (const fk of fks) {
        lines.push(`  ${fk.from}.${fk.fromCol} -> ${fk.to}.${fk.toCol}`);
      }
    }

    return lines.join('\n');
  }
}
