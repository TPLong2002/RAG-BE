import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';

export interface MssqlColumnInfo {
  name: string;
  type: string;
  maxLength: number | null;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface MssqlForeignKeyInfo {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  constraintName: string;
}

export interface MssqlTableInfo {
  tableName: string;
  schemaName: string;
  objectId: number;
  columns?: MssqlColumnInfo[];
}

@Injectable()
export class MssqlService implements OnModuleInit, OnModuleDestroy {
  private pool: sql.ConnectionPool;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const config: sql.config = {
      server: this.configService.get<string>('mssql.server', 'localhost'),
      port: this.configService.get<number>('mssql.port', 1433),
      database: this.configService.get<string>('mssql.database', ''),
      user: this.configService.get<string>('mssql.user', ''),
      password: this.configService.get<string>('mssql.password', ''),
      options: {
        encrypt: this.configService.get<boolean>('mssql.options.encrypt', false),
        trustServerCertificate: this.configService.get<boolean>(
          'mssql.options.trustServerCertificate',
          true,
        ),
      },
    };

    try {
      this.pool = await new sql.ConnectionPool(config).connect();
      console.log('MSSQL connection pool established');
    } catch (error) {
      console.error('Failed to connect to MSSQL:', error.message);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.pool?.close();
    console.log('MSSQL connection pool closed');
  }

  getPool(): sql.ConnectionPool {
    if (!this.pool) {
      throw new Error('MSSQL pool not initialized');
    }
    return this.pool;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.pool.request().query('SELECT 1 AS test');
      return true;
    } catch {
      return false;
    }
  }

  async getTables(): Promise<MssqlTableInfo[]> {
    const query = `
      SELECT
        SCHEMA_NAME(t.schema_id) AS schemaName,
        t.name AS tableName,
        t.object_id AS objectId
      FROM sys.tables t
      ORDER BY schemaName, tableName
    `;

    const result = await this.pool.request().query(query);
    return result.recordset.map((row: any) => ({
      schemaName: row.schemaName,
      tableName: row.tableName,
      objectId: Number(row.objectId),
    }));
  }

  async getTableSchema(
    tableName: string,
    schemaName: string = 'dbo',
  ): Promise<MssqlColumnInfo[]> {
    const query = `
      SELECT
        c.COLUMN_NAME AS name,
        c.DATA_TYPE AS type,
        c.CHARACTER_MAXIMUM_LENGTH AS maxLength,
        CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS isPrimaryKey
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
          ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ) pk ON c.TABLE_SCHEMA = pk.TABLE_SCHEMA
          AND c.TABLE_NAME = pk.TABLE_NAME
          AND c.COLUMN_NAME = pk.COLUMN_NAME
      WHERE c.TABLE_SCHEMA = @schemaName
        AND c.TABLE_NAME = @tableName
      ORDER BY c.ORDINAL_POSITION
    `;

    const request = this.pool.request();
    request.input('schemaName', sql.NVarChar, schemaName);
    request.input('tableName', sql.NVarChar, tableName);

    const result = await request.query(query);
    return result.recordset.map((row) => ({
      name: row.name,
      type: row.type,
      maxLength: row.maxLength,
      nullable: Boolean(row.nullable),
      isPrimaryKey: Boolean(row.isPrimaryKey),
    }));
  }

  async getAllTablesWithSchema(): Promise<MssqlTableInfo[]> {
    const tables = await this.getTables();

    const tablesWithSchema = await Promise.all(
      tables.map(async (table) => {
        const columns = await this.getTableSchema(table.tableName, table.schemaName);
        return {
          ...table,
          columns,
        };
      }),
    );

    return tablesWithSchema;
  }

  async getForeignKeys(): Promise<MssqlForeignKeyInfo[]> {
    const query = `
      SELECT
        tp.name AS fromTable,
        cp.name AS fromColumn,
        tr.name AS toTable,
        cr.name AS toColumn,
        fk.name AS constraintName
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc
        ON fk.object_id = fkc.constraint_object_id
      INNER JOIN sys.tables tp
        ON fkc.parent_object_id = tp.object_id
      INNER JOIN sys.columns cp
        ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
      INNER JOIN sys.tables tr
        ON fkc.referenced_object_id = tr.object_id
      INNER JOIN sys.columns cr
        ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
      ORDER BY tp.name, cp.name
    `;

    const result = await this.pool.request().query(query);
    return result.recordset.map((row) => ({
      fromTable: row.fromTable,
      fromColumn: row.fromColumn,
      toTable: row.toTable,
      toColumn: row.toColumn,
      constraintName: row.constraintName,
    }));
  }
}
