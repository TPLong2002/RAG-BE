import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../neo4j/neo4j.service';
import { MssqlService, MssqlTableInfo, MssqlForeignKeyInfo } from '../mssql/mssql.service';

export interface ColumnChange {
  columnName: string;
  changeType: 'added' | 'removed' | 'modified' | 'type-changed' | 'nullability-changed' | 'primary-key-changed';
  oldValue?: any;
  newValue?: any;
}

export interface TableDetail {
  name: string;
  displayName: string;
  objectId?: number;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey: boolean;
  }[];
  source: 'mssql' | 'neo4j';
  oldName?: string;
  columnChanges?: ColumnChange[];
  changeSummary?: string;
  neo4jColumns?: {
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey: boolean;
  }[];
}

export interface SchemaComparisonResult {
  newTables: TableDetail[];
  existingTables: TableDetail[];
  changedTables: TableDetail[];
  renamedTables: TableDetail[];
  mssqlForeignKeys: MssqlForeignKeyInfo[];
}

@Injectable()
export class SchemaService {
  constructor(
    private readonly neo4jService: Neo4jService,
    private readonly mssqlService: MssqlService,
  ) {}

  async getComparison(): Promise<SchemaComparisonResult> {
    const [mssqlTables, neo4jTables, mssqlForeignKeys] = await Promise.all([
      this.mssqlService.getAllTablesWithSchema(),
      this.getNeo4jTables(),
      this.mssqlService.getForeignKeys(),
    ]);

    // Create map for Neo4j tables by name (primary key) and objectId (for rename detection)
    const neo4jByName = new Map<string, TableDetail>();
    const neo4jByObjectId = new Map<number, TableDetail>();

    for (const table of neo4jTables) {
      neo4jByName.set(table.name, table);
      if (table.objectId) {
        neo4jByObjectId.set(table.objectId, table);
      }
    }

    const newTables: TableDetail[] = [];
    const changedTables: TableDetail[] = [];
    const renamedTables: TableDetail[] = [];

    // Process each MSSQL table - match by name first, then objectId for rename detection
    for (const mssqlTable of mssqlTables) {
      const mssqlTableDetail = this.convertMssqlToTableDetail(mssqlTable);
      const neo4jMatchByName = neo4jByName.get(mssqlTable.tableName);

      if (neo4jMatchByName) {
        // Found by name - table exists in Neo4j, check if columns changed
        const mssqlCols = mssqlTableDetail.columns.map((c) => `${c.name}:${c.type}:${c.nullable}:${c.isPrimaryKey}`).sort().join(',');
        const neo4jCols = (neo4jMatchByName.columns || []).map((c) => `${c.name}:${c.type}:${c.nullable}:${c.isPrimaryKey}`).sort().join(',');
        if (mssqlCols !== neo4jCols) {
          const columnChanges = this.getColumnChanges(
            mssqlTableDetail.columns,
            neo4jMatchByName.columns || []
          );
          const changeTypes = columnChanges.map(c => c.changeType);
          const changeSummary = columnChanges.length > 0
            ? `Column changes: ${columnChanges.length} (${[...new Set(changeTypes)].join(', ')})`
            : 'Schema changed';
          const changedTable = {
            ...mssqlTableDetail,
            neo4jColumns: neo4jMatchByName.columns,
            columnChanges,
            changeSummary
          };
          changedTables.push(changedTable);
        }
      } else {
        // Not found by name - check objectId for rename detection
        const neo4jMatchByObjectId = mssqlTable.objectId ? neo4jByObjectId.get(mssqlTable.objectId) : null;

        if (neo4jMatchByObjectId) {
          // Found by objectId but different name - table was renamed
          const columnChanges = this.getColumnChanges(
            mssqlTableDetail.columns,
            neo4jMatchByObjectId.columns || []
          );
          const renamedTable = {
            ...mssqlTableDetail,
            oldName: neo4jMatchByObjectId.name,
            neo4jColumns: neo4jMatchByObjectId.columns,
            columnChanges,
            changeSummary: `Table renamed from "${neo4jMatchByObjectId.name}" to "${mssqlTable.tableName}"${columnChanges.length > 0 ? ` + ${columnChanges.length} column change(s)` : ''}`
          };
          renamedTables.push(renamedTable);
        } else {
          // Not found by name or objectId - new table
          newTables.push(mssqlTableDetail);
        }
      }
    }

    // Existing tables are ALL tables in Neo4j
    const existingTables = neo4jTables;

    return {
      newTables,
      existingTables,
      changedTables,
      renamedTables,
      mssqlForeignKeys,
    };
  }

  private async getNeo4jTables(): Promise<TableDetail[]> {
    const query = `
      MATCH (t:Table)
      RETURN t.name AS name,
             t.displayName AS displayName,
             t.columns AS columns,
             t.source AS source,
             t.objectId AS objectId
    `;

    const result = await this.neo4jService.runQuery<{
      name: string;
      displayName: string;
      columns: string;
      source: string;
      objectId: number | null;
    }>(query);

    return result.map((row) => ({
      name: row.name,
      displayName: row.displayName || row.name,
      columns: row.columns ? JSON.parse(row.columns) : [],
      source: (row.source as 'mssql' | 'neo4j') || 'neo4j',
      objectId: row.objectId || undefined,
    }));
  }

  private formatColumnType(col: { type: string; maxLength?: number | null }): string {
    const typesWithLength = ['varchar', 'nvarchar', 'char', 'nchar', 'varbinary', 'binary'];
    if (typesWithLength.includes(col.type) && col.maxLength != null) {
      return `${col.type}(${col.maxLength === -1 ? 'MAX' : col.maxLength})`;
    }
    return col.type;
  }

  private convertMssqlToTableDetail(mssqlTable: MssqlTableInfo): TableDetail {
    return {
      name: mssqlTable.tableName,
      displayName: mssqlTable.tableName,
      objectId: mssqlTable.objectId,
      columns: (mssqlTable.columns || []).map((col) => ({
        name: col.name,
        type: this.formatColumnType(col),
        nullable: col.nullable,
        isPrimaryKey: col.isPrimaryKey,
      })),
      source: 'mssql',
    };
  }

  private getColumnChanges(
    mssqlColumns: Array<{name: string; type: string; nullable: boolean; isPrimaryKey: boolean}>,
    neo4jColumns: Array<{name: string; type: string; nullable: boolean; isPrimaryKey: boolean}>
  ): ColumnChange[] {
    const changes: ColumnChange[] = [];
    const mssqlColMap = new Map(mssqlColumns.map(col => [col.name, col]));
    const neo4jColMap = new Map(neo4jColumns.map(col => [col.name, col]));

    // Check for added columns (in MSSQL but not in Neo4j)
    for (const [colName, mssqlCol] of mssqlColMap) {
      if (!neo4jColMap.has(colName)) {
        changes.push({
          columnName: colName,
          changeType: 'added',
          newValue: `${mssqlCol.type}${mssqlCol.nullable ? ' NULL' : ' NOT NULL'}${mssqlCol.isPrimaryKey ? ' PK' : ''}`,
        });
      }
    }

    // Check for removed columns (in Neo4j but not in MSSQL)
    for (const [colName, neo4jCol] of neo4jColMap) {
      if (!mssqlColMap.has(colName)) {
        changes.push({
          columnName: colName,
          changeType: 'removed',
          oldValue: `${neo4jCol.type}${neo4jCol.nullable ? ' NULL' : ' NOT NULL'}${neo4jCol.isPrimaryKey ? ' PK' : ''}`,
        });
      }
    }

    // Check for modified columns (same name, different properties)
    for (const [colName, mssqlCol] of mssqlColMap) {
      const neo4jCol = neo4jColMap.get(colName);
      if (!neo4jCol) continue;

      if (mssqlCol.type !== neo4jCol.type) {
        changes.push({
          columnName: colName,
          changeType: 'type-changed',
          oldValue: neo4jCol.type,
          newValue: mssqlCol.type,
        });
      }

      if (mssqlCol.nullable !== neo4jCol.nullable) {
        changes.push({
          columnName: colName,
          changeType: 'nullability-changed',
          oldValue: neo4jCol.nullable ? 'NULL' : 'NOT NULL',
          newValue: mssqlCol.nullable ? 'NULL' : 'NOT NULL',
        });
      }

      if (mssqlCol.isPrimaryKey !== neo4jCol.isPrimaryKey) {
        changes.push({
          columnName: colName,
          changeType: 'primary-key-changed',
          oldValue: neo4jCol.isPrimaryKey ? 'PK' : 'non-PK',
          newValue: mssqlCol.isPrimaryKey ? 'PK' : 'non-PK',
        });
      }
    }

    return changes;
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
            type: this.formatColumnType(col),
            nullable: col.nullable,
            isPrimaryKey: col.isPrimaryKey,
          })),
        );

        await this.neo4jService.runQuery(
          `
          MERGE (t:Table {name: $name})
          ON CREATE SET t.createdAt = datetime()
          SET t.objectId = $objectId,
              t.displayName = $displayName,
              t.columns = $columns,
              t.description = $description,
              t.source = $source,
              t.updatedAt = datetime()
        `,
          {
            objectId: mssqlTable.objectId,
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

  async syncTables(tableNames: string[]): Promise<{ synced: number; errors: string[] }> {
    const errors: string[] = [];
    let synced = 0;

    console.log(`[SchemaService] syncTables called with: ${JSON.stringify(tableNames)}`);
    const mssqlTables = await this.mssqlService.getAllTablesWithSchema();
    console.log(`[SchemaService] Total MSSQL tables: ${mssqlTables.length}`);

    for (const tableName of tableNames) {
      try {
        const mssqlTable = mssqlTables.find((t) => t.tableName === tableName);
        if (!mssqlTable) {
          const errorMsg = `Table ${tableName} not found in MSSQL`;
          errors.push(errorMsg);
          console.log(`[SchemaService] ${errorMsg}`);
          continue;
        }

        console.log(`[SchemaService] Processing table: ${tableName}, objectId: ${mssqlTable.objectId}`);
        const columnsJson = JSON.stringify(
          (mssqlTable.columns || []).map((col) => ({
            name: col.name,
            type: this.formatColumnType(col),
            nullable: col.nullable,
            isPrimaryKey: col.isPrimaryKey,
          })),
        );
        console.log(`[SchemaService] Columns JSON length: ${columnsJson.length}`);

        // Find existing table by name first, then objectId for rename detection
        // Priority: 1. name (primary key, has UNIQUE constraint), 2. objectId (rename detection), 3. create new
        interface Neo4jTableInfo {
          name: string;
          objectId?: number;
        }

        let existingTable: Neo4jTableInfo | null = null;

        // Try to find by name first (primary matching key)
        const byName = await this.neo4jService.runQuery<Neo4jTableInfo>(
          'MATCH (t:Table {name: $name}) RETURN t.name AS name, t.objectId AS objectId',
          { name: tableName }
        );
        if (byName.length > 0) {
          existingTable = byName[0];
          console.log(`[SchemaService] Found by name:`, existingTable);
        } else if (mssqlTable.objectId) {
          // Not found by name - try objectId for rename detection
          const byObjectId = await this.neo4jService.runQuery<Neo4jTableInfo>(
            'MATCH (t:Table {objectId: $objectId}) RETURN t.name AS name, t.objectId AS objectId',
            { objectId: mssqlTable.objectId }
          );
          if (byObjectId.length > 0) {
            existingTable = byObjectId[0];
            console.log(`[SchemaService] Found by objectId (table renamed from "${existingTable.name}" to "${tableName}"):`, existingTable);
          }
        }

        let query = '';
        const params: Record<string, any> = {
          columns: columnsJson,
          newName: tableName,
          displayName: tableName,
          source: 'mssql'
        };

        if (existingTable) {
          // Update existing table (found by name or objectId)
          console.log(`[SchemaService] Updating existing table: ${existingTable.name} (objectId: ${existingTable.objectId})`);

          const whereClause = 'MATCH (t:Table {name: $currentName})';
          params.currentName = existingTable.name;

          const setClauses = [
            't.columns = $columns',
            't.name = $newName',
            't.displayName = $displayName',
            "t.source = 'mssql'",
            't.updatedAt = datetime()'
          ];

          // Always update objectId from MSSQL (it may have changed due to table recreation)
          if (mssqlTable.objectId) {
            setClauses.push('t.objectId = $objectId');
            params.objectId = mssqlTable.objectId;
          }

          query = `
            ${whereClause}
            SET ${setClauses.join(', ')}
          `;
        } else {
          // Create new table - MERGE by name (has UNIQUE constraint in Neo4j)
          console.log(`[SchemaService] Creating new table: ${tableName}`);

          const onCreateSet = [
            't.createdAt = datetime()',
            't.displayName = $displayName',
            't.columns = $columns',
            "t.source = 'mssql'",
            't.updatedAt = datetime()'
          ];

          if (mssqlTable.objectId) {
            onCreateSet.push('t.objectId = $objectId');
            params.objectId = mssqlTable.objectId;
          }

          query = `
            MERGE (t:Table {name: $newName})
            ON CREATE SET ${onCreateSet.join(', ')}
            ON MATCH SET ${onCreateSet.join(', ')}
          `;
        }

        console.log(`[SchemaService] Executing Neo4j query:\n${query}`);
        console.log(`[SchemaService] Query params:`, params);

        const result = await this.neo4jService.runQuery(query, params);
        console.log(`[SchemaService] Query result:`, result);

        // Verify the update
        const verifyNode = await this.neo4jService.runQuery(
          'MATCH (t:Table {name: $newName}) RETURN t.name AS name, t.objectId AS objectId, t.columns AS columns',
          { newName: tableName }
        );
        console.log(`[SchemaService] Verify after sync:`, verifyNode);

        console.log(`[SchemaService] Successfully synced table: ${tableName}`);
        synced++;
      } catch (error) {
        const errorMsg = `Failed to sync ${tableName}: ${error.message}`;
        errors.push(errorMsg);
        console.error(`[SchemaService] ${errorMsg}`, error);
      }
    }

    console.log(`[SchemaService] syncTables result: synced=${synced}, errors=${errors.length}`);
    return { synced, errors };
  }

  async updateForeignKey(
    oldFromTable: string,
    oldFromColumn: string,
    oldToTable: string,
    oldToColumn: string,
    newFromTable: string,
    newFromColumn: string,
    newToTable: string,
    newToColumn: string,
  ): Promise<void> {
    // Delete old FK
    await this.neo4jService.runQuery(
      `MATCH (from:Table {name: $oldFromTable})-[fk:FOREIGN_KEY {fromColumn: $oldFromColumn, toColumn: $oldToColumn}]->(to:Table {name: $oldToTable})
       DELETE fk`,
      { oldFromTable, oldFromColumn, oldToTable, oldToColumn },
    );

    // Create new FK
    await this.createForeignKey(newFromTable, newFromColumn, newToTable, newToColumn);
  }

  async getMssqlForeignKeys(): Promise<MssqlForeignKeyInfo[]> {
    return this.mssqlService.getForeignKeys();
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
