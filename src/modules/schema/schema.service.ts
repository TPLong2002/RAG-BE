import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../neo4j/neo4j.service';
import { MssqlService, MssqlTableInfo } from '../mssql/mssql.service';

export interface TableDetail {
  name: string;
  displayName: string;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey: boolean;
  }[];
  source: 'mssql' | 'neo4j';
}

export interface SchemaComparisonResult {
  newTables: TableDetail[];
  existingTables: TableDetail[];
}

@Injectable()
export class SchemaService {
  constructor(
    private readonly neo4jService: Neo4jService,
    private readonly mssqlService: MssqlService,
  ) {}

  async getComparison(): Promise<SchemaComparisonResult> {
    const [mssqlTables, neo4jTables] = await Promise.all([
      this.mssqlService.getAllTablesWithSchema(),
      this.getNeo4jTables(),
    ]);

    const neo4jTableNames = new Set(neo4jTables.map((t) => t.name));

    const newTables: TableDetail[] = mssqlTables
      .filter((t) => !neo4jTableNames.has(t.tableName))
      .map((t) => this.convertMssqlToTableDetail(t));

    const existingTables: TableDetail[] = neo4jTables;

    return {
      newTables,
      existingTables,
    };
  }

  private async getNeo4jTables(): Promise<TableDetail[]> {
    const query = `
      MATCH (t:Table)
      RETURN t.name AS name,
             t.displayName AS displayName,
             t.columns AS columns,
             t.source AS source
    `;

    const result = await this.neo4jService.runQuery<{
      name: string;
      displayName: string;
      columns: string;
      source: string;
    }>(query);

    return result.map((row) => ({
      name: row.name,
      displayName: row.displayName || row.name,
      columns: row.columns ? JSON.parse(row.columns) : [],
      source: (row.source as 'mssql' | 'neo4j') || 'neo4j',
    }));
  }

  private convertMssqlToTableDetail(mssqlTable: MssqlTableInfo): TableDetail {
    return {
      name: mssqlTable.tableName,
      displayName: mssqlTable.tableName,
      columns: (mssqlTable.columns || []).map((col) => ({
        name: col.name,
        type: col.type,
        nullable: col.nullable,
        isPrimaryKey: col.isPrimaryKey,
      })),
      source: 'mssql',
    };
  }

  async importTables(tableNames: string[]): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;

    const mssqlTables = await this.mssqlService.getAllTablesWithSchema();

    for (const tableName of tableNames) {
      try {
        const mssqlTable = mssqlTables.find((t) => t.tableName === tableName);
        if (!mssqlTable) {
          errors.push(`Table ${tableName} not found in MSSQL`);
          continue;
        }

        const columnsJson = JSON.stringify(
          (mssqlTable.columns || []).map((col) => ({
            name: col.name,
            type: col.type,
            nullable: col.nullable,
            isPrimaryKey: col.isPrimaryKey,
          })),
        );

        await this.neo4jService.runQuery(
          `
          MERGE (t:Table {name: $name})
          ON CREATE SET t.createdAt = datetime()
          SET t.displayName = $displayName,
              t.columns = $columns,
              t.description = $description,
              t.source = $source,
              t.updatedAt = datetime()
        `,
          {
            name: tableName,
            displayName: tableName,
            columns: columnsJson,
            description: '',
            source: 'mssql',
          },
        );

        imported++;
      } catch (error) {
        errors.push(`Failed to import ${tableName}: ${error.message}`);
      }
    }

    return { imported, errors };
  }

  async createForeignKey(
    fromTable: string,
    fromColumn: string,
    toTable: string,
    toColumn: string,
  ): Promise<void> {
    await this.neo4jService.runQuery(
      `
      MATCH (from:Table {name: $fromTable})
      MATCH (to:Table {name: $toTable})
      MERGE (from)-[fk:FOREIGN_KEY {
        fromColumn: $fromColumn,
        toColumn: $toColumn
      }]->(to)
    `,
      {
        fromTable,
        fromColumn,
        toTable,
        toColumn,
      },
    );
  }

  async updateTable(
    tableName: string,
    updates: {
      displayName?: string;
      description?: string;
      columns?: Array<{
        name: string;
        type: string;
        nullable: boolean;
        isPrimaryKey: boolean;
        description?: string;
      }>;
    },
  ): Promise<void> {
    const setClauses: string[] = ['t.updatedAt = datetime()'];
    const params: Record<string, unknown> = { name: tableName };

    if (updates.displayName !== undefined) {
      setClauses.push('t.displayName = $displayName');
      params.displayName = updates.displayName;
    }

    if (updates.description !== undefined) {
      setClauses.push('t.description = $description');
      params.description = updates.description;
    }

    if (updates.columns !== undefined) {
      setClauses.push('t.columns = $columns');
      params.columns = JSON.stringify(updates.columns);
    }

    await this.neo4jService.runQuery(
      `
      MATCH (t:Table {name: $name})
      SET ${setClauses.join(', ')}
    `,
      params,
    );
  }
}
