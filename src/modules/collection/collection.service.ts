import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../neo4j/neo4j.service';
import { v4 as uuidv4 } from 'uuid';

export interface CollectionMeta {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  documentCount: number;
  createdAt: string;
}

@Injectable()
export class CollectionService {
  constructor(private neo4jService: Neo4jService) {}

  async createCollection(
    name: string,
    ownerId: string,
    description?: string,
  ): Promise<CollectionMeta> {
    const collectionId = uuidv4();
    const createdAt = new Date().toISOString();

    await this.neo4jService.runQuery(
      `CREATE (c:Collection {
        collectionId: $collectionId, name: $name, description: $description,
        ownerId: $ownerId, createdAt: $createdAt
      })`,
      { collectionId, name, description: description || '', ownerId, createdAt },
    );

    return {
      id: collectionId,
      name,
      description: description || '',
      ownerId,
      documentCount: 0,
      createdAt,
    };
  }

  async listCollections(userId?: string): Promise<CollectionMeta[]> {
    const cypher = userId
      ? `MATCH (c:Collection)
         WHERE c.ownerId = $userId
         OPTIONAL MATCH (c)-[:CONTAINS_DOCUMENT]->(d:Document)
         RETURN c.collectionId AS id, c.name AS name, c.description AS description,
                c.ownerId AS ownerId, c.createdAt AS createdAt, count(d) AS documentCount
         ORDER BY c.createdAt DESC`
      : `MATCH (c:Collection)
         OPTIONAL MATCH (c)-[:CONTAINS_DOCUMENT]->(d:Document)
         RETURN c.collectionId AS id, c.name AS name, c.description AS description,
                c.ownerId AS ownerId, c.createdAt AS createdAt, count(d) AS documentCount
         ORDER BY c.createdAt DESC`;

    const results = await this.neo4jService.runQuery<CollectionMeta>(
      cypher,
      userId ? { userId } : {},
    );

    return results;
  }

  async getCollection(collectionId: string): Promise<{
    collection: CollectionMeta;
    documents: { documentId: string; fileName: string; fileType: string; uploadedAt: string }[];
  } | null> {
    const colResults = await this.neo4jService.runQuery<CollectionMeta>(
      `MATCH (c:Collection {collectionId: $collectionId})
       OPTIONAL MATCH (c)-[:CONTAINS_DOCUMENT]->(d:Document)
       RETURN c.collectionId AS id, c.name AS name, c.description AS description,
              c.ownerId AS ownerId, c.createdAt AS createdAt, count(d) AS documentCount`,
      { collectionId },
    );

    if (!colResults.length) return null;

    const docResults = await this.neo4jService.runQuery<{
      documentId: string;
      fileName: string;
      fileType: string;
      uploadedAt: string;
    }>(
      `MATCH (c:Collection {collectionId: $collectionId})-[:CONTAINS_DOCUMENT]->(d:Document)
       RETURN d.documentId AS documentId, d.fileName AS fileName,
              d.fileType AS fileType, d.uploadedAt AS uploadedAt
       ORDER BY d.uploadedAt DESC`,
      { collectionId },
    );

    return { collection: colResults[0], documents: docResults };
  }

  async updateCollection(
    collectionId: string,
    updates: { name?: string; description?: string },
  ): Promise<boolean> {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { collectionId };

    if (updates.name !== undefined) {
      setClauses.push('c.name = $name');
      params.name = updates.name;
    }
    if (updates.description !== undefined) {
      setClauses.push('c.description = $description');
      params.description = updates.description;
    }

    if (!setClauses.length) return false;

    const result = await this.neo4jService.runQuery(
      `MATCH (c:Collection {collectionId: $collectionId})
       SET ${setClauses.join(', ')}
       RETURN c.collectionId AS id`,
      params,
    );

    return result.length > 0;
  }

  async deleteCollection(collectionId: string): Promise<void> {
    await this.neo4jService.runQuery(
      `MATCH (c:Collection {collectionId: $collectionId})
       DETACH DELETE c`,
      { collectionId },
    );
  }

  async addDocuments(collectionId: string, documentIds: string[]): Promise<number> {
    const result = await this.neo4jService.runQuery<{ added: number }>(
      `MATCH (c:Collection {collectionId: $collectionId})
       UNWIND $documentIds AS docId
       MATCH (d:Document {documentId: docId})
       MERGE (c)-[:CONTAINS_DOCUMENT]->(d)
       RETURN count(*) AS added`,
      { collectionId, documentIds },
    );

    return result[0]?.added ?? 0;
  }

  async removeDocument(collectionId: string, documentId: string): Promise<void> {
    await this.neo4jService.runQuery(
      `MATCH (c:Collection {collectionId: $collectionId})-[r:CONTAINS_DOCUMENT]->(d:Document {documentId: $documentId})
       DELETE r`,
      { collectionId, documentId },
    );
  }

  async getDocumentIdsByCollectionIds(collectionIds: string[]): Promise<string[]> {
    const results = await this.neo4jService.runQuery<{ documentId: string }>(
      `UNWIND $collectionIds AS colId
       MATCH (c:Collection {collectionId: colId})-[:CONTAINS_DOCUMENT]->(d:Document)
       RETURN DISTINCT d.documentId AS documentId`,
      { collectionIds },
    );

    return results.map((r) => r.documentId);
  }
}
