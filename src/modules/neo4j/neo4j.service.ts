import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver, Session, ManagedTransaction } from 'neo4j-driver';

@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private driver: Driver;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const uri = this.configService.get<string>('neo4j.uri', 'bolt://localhost:7687');
    const username = this.configService.get<string>('neo4j.username', 'neo4j');
    const password = this.configService.get<string>('neo4j.password', 'neo4j_password');

    this.driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }

  async onModuleDestroy() {
    await this.driver?.close();
  }

  getDriver(): Driver {
    return this.driver;
  }

  getSession(): Session {
    if (!this.driver) {
      throw new Error('Neo4j driver not initialized');
    }
    const database = this.configService.get<string>('neo4j.database', 'neo4j');
    return this.driver.session({ database });
  }

  private toNative(val: unknown): unknown {
    if (val === null || val === undefined) return val;
    if (neo4j.isInt(val)) return val.toNumber();
    if (Array.isArray(val)) return val.map((v) => this.toNative(v));
    if (typeof val === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = this.toNative(v);
      }
      return out;
    }
    return val;
  }

  async runQuery<T = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const session = this.getSession();
    try {
      const result = await session.run(cypher, params);
      return result.records.map((record) => this.toNative(record.toObject()) as T);
    } finally {
      await session.close();
    }
  }

  async runWriteTransaction<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = this.getSession();
    try {
      return await session.executeWrite(work);
    } finally {
      await session.close();
    }
  }

  async initNeo4j(embeddingDimension?: number): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(
        'CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.documentId IS UNIQUE',
      );
      await session.run(
        'CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.chunkId IS UNIQUE',
      );
      await session.run(
        'CREATE INDEX chunk_document_id IF NOT EXISTS FOR (c:Chunk) ON (c.documentId)',
      );

      if (embeddingDimension) {
        try {
          await session.run(
            `CREATE VECTOR INDEX chunk_embeddings IF NOT EXISTS
             FOR (c:Chunk) ON (c.embedding)
             OPTIONS {indexConfig: {
               \`vector.dimensions\`: $dim,
               \`vector.similarity_function\`: 'cosine'
             }}`,
            { dim: neo4j.int(embeddingDimension) },
          );
          console.log(`Neo4j vector index ensured (dim=${embeddingDimension})`);
        } catch (err) {
          console.warn('Vector index creation skipped:', (err as Error).message);
        }
      }

      try {
        await session.run(
          `CREATE FULLTEXT INDEX chunk_fulltext IF NOT EXISTS
           FOR (c:Chunk) ON EACH [c.text]`,
        );
      } catch {
        // May already exist
      }

      await session.run(
        'CREATE CONSTRAINT table_name IF NOT EXISTS FOR (t:Table) REQUIRE t.name IS UNIQUE',
      );

      console.log('Neo4j constraints and indexes ensured');
    } finally {
      await session.close();
    }
  }
}
