import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { Neo4jService } from '../neo4j/neo4j.service';
import { FileParserService } from './file-parser.service';
import type { DocumentMeta, UploadOptions, AccessControl } from '../../common/types';

@Injectable()
export class DocumentService {
  private splitter: RecursiveCharacterTextSplitter;

  constructor(
    private embeddingsService: EmbeddingsService,
    private neo4jService: Neo4jService,
    private fileParserService: FileParserService,
    private configService: ConfigService,
  ) {
    const chunkSize = this.configService.get<number>('chunking.chunkSize');
    const chunkOverlap = this.configService.get<number>('chunking.chunkOverlap');

    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });
  }

  async uploadDocument(
    filePath: string,
    originalName: string,
    mimeType: string,
    fileSize: number,
    options: UploadOptions,
  ): Promise<DocumentMeta> {
    const { embeddingProvider, embeddingModel, ownerId = 'system' } = options;

    const dimension = this.embeddingsService.getEmbeddingDimension(embeddingModel);
    await this.neo4jService.initNeo4j(dimension);

    const { docs: parsedDocs, fileType } = await this.fileParserService.parseFile(filePath, mimeType);
    if (!parsedDocs.length) throw new Error('No text content extracted from file');

    const splitDocs = await this.splitter.splitDocuments(parsedDocs);
    if (!splitDocs.length) throw new Error('No chunks after splitting');

    const chunks = splitDocs.map((d) => d.pageContent);

    console.log('🚀 ~ uploadDocument ~ embeddingProvider, embeddingModel:', embeddingProvider, embeddingModel);
    const embeddings = this.embeddingsService.createEmbeddings(embeddingProvider, embeddingModel);
    const vectors = await embeddings.embedDocuments(chunks);

    const documentId = uuidv4();
    const accessControl: AccessControl = {
      public: true,
      allowedUsers: [],
      allowedGroups: [],
    };

    const meta: DocumentMeta = {
      id: documentId,
      fileName: originalName,
      fileType,
      fileSize,
      totalChunks: chunks.length,
      ownerId,
      accessControl,
      embeddingProvider,
      embeddingModel,
      uploadedAt: new Date().toISOString(),
    };

    await this.neo4jService.runQuery(
      `CREATE (d:Document {
        documentId: $documentId, fileName: $fileName, fileType: $fileType,
        fileSize: $fileSize, totalChunks: $totalChunks, ownerId: $ownerId,
        accessControl: $accessControl,
        embeddingProvider: $embeddingProvider, embeddingModel: $embeddingModel,
        uploadedAt: $uploadedAt
      })`,
      {
        documentId,
        fileName: originalName,
        fileType,
        fileSize,
        totalChunks: chunks.length,
        ownerId,
        accessControl: JSON.stringify(accessControl),
        embeddingProvider,
        embeddingModel,
        uploadedAt: meta.uploadedAt,
      },
    );

    const chunkData = chunks.map((text, i) => ({
      chunkId: `${documentId}_chunk_${i}`,
      chunkIndex: i,
      text,
      embedding: vectors[i],
      fileName: originalName,
      fileType,
      ownerId,
      accessControlPublic: accessControl.public,
      allowedUsers: accessControl.allowedUsers,
    }));

    const batchSize = 50;
    for (let start = 0; start < chunkData.length; start += batchSize) {
      const batch = chunkData.slice(start, start + batchSize);
      await this.neo4jService.runQuery(
        `MATCH (d:Document {documentId: $documentId})
         UNWIND $chunks AS chunk
         CREATE (c:Chunk {
           chunkId: chunk.chunkId, documentId: $documentId,
           chunkIndex: chunk.chunkIndex, text: chunk.text,
           embedding: chunk.embedding,
           fileName: chunk.fileName, fileType: chunk.fileType,
           ownerId: chunk.ownerId,
           accessControlPublic: chunk.accessControlPublic,
           allowedUsers: chunk.allowedUsers
         })
         CREATE (d)-[:HAS_CHUNK {position: chunk.chunkIndex}]->(c)`,
        { documentId, chunks: batch },
      );
    }

    if (chunks.length > 1) {
      await this.neo4jService.runQuery(
        `MATCH (d:Document {documentId: $documentId})-[:HAS_CHUNK]->(c:Chunk)
         WITH c ORDER BY c.chunkIndex
         WITH collect(c) AS chunks
         UNWIND range(0, size(chunks) - 2) AS i
         WITH chunks[i] AS current, chunks[i + 1] AS next
         CREATE (current)-[:NEXT_CHUNK]->(next)`,
        { documentId },
      );
    }

    return meta;
  }

  async listDocuments(userId?: string): Promise<DocumentMeta[]> {
    let cypher: string;
    const params: Record<string, unknown> = {};

    const returnFields = `RETURN d.documentId AS documentId, d.fileName AS fileName,
      d.fileType AS fileType, d.fileSize AS fileSize, d.totalChunks AS totalChunks,
      d.ownerId AS ownerId, d.accessControl AS accessControl,
      d.embeddingProvider AS embeddingProvider, d.embeddingModel AS embeddingModel,
      d.uploadedAt AS uploadedAt`;

    if (userId) {
      cypher = `MATCH (d:Document)
        WHERE d.ownerId = $userId
          OR d.accessControl CONTAINS '"public":true'
        ${returnFields} ORDER BY d.uploadedAt DESC LIMIT 1000`;
      params.userId = userId;
    } else {
      cypher = `MATCH (d:Document) ${returnFields} ORDER BY d.uploadedAt DESC LIMIT 1000`;
    }

    const results = await this.neo4jService.runQuery<{
      documentId: string;
      fileName: string;
      fileType: string;
      fileSize: number;
      totalChunks: number;
      ownerId: string;
      accessControl: string;
      embeddingProvider: string;
      embeddingModel: string;
      uploadedAt: string;
    }>(cypher, params);

    return results.map((d) => {
      let ac: AccessControl;
      try {
        ac = JSON.parse(d.accessControl);
      } catch {
        ac = { public: true, allowedUsers: [], allowedGroups: [] };
      }
      return {
        id: d.documentId,
        fileName: d.fileName,
        fileType: d.fileType,
        fileSize: d.fileSize,
        totalChunks: d.totalChunks,
        ownerId: d.ownerId,
        accessControl: ac,
        embeddingProvider: d.embeddingProvider,
        embeddingModel: d.embeddingModel,
        uploadedAt: d.uploadedAt,
      } as DocumentMeta;
    });
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.neo4jService.runQuery(
      `MATCH (d:Document {documentId: $documentId})-[ht:HAS_TABLE]->(t:Table)
       OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)-[mt:MENTIONS_TABLE]->(t)
       DELETE mt, ht`,
      { documentId },
    );

    await this.neo4jService.runQuery(
      `MATCH (d:Document {documentId: $documentId})
       OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
       DETACH DELETE c, d`,
      { documentId },
    );
  }
}
