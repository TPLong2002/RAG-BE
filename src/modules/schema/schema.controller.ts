import { Controller, Get, Post, Put, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { SchemaService } from './schema.service';
import { ImportTablesDto, CreateForeignKeyDto, UpdateForeignKeyDto, SyncTablesDto, UpdateTableDto } from './dto/schema.dto';

@Controller('api/schema')
export class SchemaController {
  constructor(private readonly schemaService: SchemaService) {}

  @Get('comparison')
  async getComparison() {
    try {
      return await this.schemaService.getComparison();
    } catch (error) {
      throw new HttpException(
        `Failed to get schema comparison: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('import')
  async importTables(@Body() dto: ImportTablesDto) {
    try {
      const result = await this.schemaService.importTables(dto.tableNames);
      return result;
    } catch (error) {
      throw new HttpException(
        `Failed to import tables: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('foreign-keys')
  async createForeignKey(@Body() dto: CreateForeignKeyDto) {
    try {
      await this.schemaService.createForeignKey(
        dto.fromTable,
        dto.fromColumn,
        dto.toTable,
        dto.toColumn,
      );
      return { success: true };
    } catch (error) {
      throw new HttpException(
        `Failed to create foreign key: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('foreign-keys')
  async updateForeignKey(@Body() dto: UpdateForeignKeyDto) {
    try {
      await this.schemaService.updateForeignKey(
        dto.oldFromTable,
        dto.oldFromColumn,
        dto.oldToTable,
        dto.oldToColumn,
        dto.newFromTable,
        dto.newFromColumn,
        dto.newToTable,
        dto.newToColumn,
      );
      return { success: true };
    } catch (error) {
      throw new HttpException(
        `Failed to update foreign key: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('sync')
  async syncTables(@Body() dto: SyncTablesDto) {
    try {
      return await this.schemaService.syncTables(dto.tableNames);
    } catch (error) {
      throw new HttpException(
        `Failed to sync tables: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('mssql-foreign-keys')
  async getMssqlForeignKeys() {
    try {
      return await this.schemaService.getMssqlForeignKeys();
    } catch (error) {
      throw new HttpException(
        `Failed to get MSSQL foreign keys: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('tables/:name')
  async updateTable(@Param('name') name: string, @Body() dto: UpdateTableDto) {
    try {
      await this.schemaService.updateTable(name, dto);
      return { success: true };
    } catch (error) {
      throw new HttpException(
        `Failed to update table: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
