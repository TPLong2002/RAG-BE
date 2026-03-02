import { Controller, Get, Delete, Param, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { GraphService } from './graph.service';

@Controller('api/graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Get('documents')
  async getDocumentGraphAll() {
    const graph = await this.graphService.getDocumentGraph();
    return graph;
  }

  @Get('documents/:id')
  async getDocumentGraph(@Param('id') id: string) {
    const graph = await this.graphService.getDocumentGraph(id);
    return graph;
  }

  @Get('documents/:id/related')
  async getRelatedDocuments(@Param('id') id: string) {
    const related = await this.graphService.getRelatedDocuments(id);
    return { related };
  }

  @Get('documents/:id/chunks')
  async getChunkGraph(@Param('id') id: string) {
    const graph = await this.graphService.getChunkGraph(id);
    return graph;
  }

  @Get('schema')
  async getSchemaGraph(@Query('documentId') documentId?: string) {
    const graph = await this.graphService.getSchemaGraph(documentId);
    return graph;
  }

  @Delete('schema/tables/:name')
  @HttpCode(HttpStatus.OK)
  async deleteTable(@Param('name') name: string) {
    await this.graphService.deleteTable(name);
    return { success: true };
  }

  @Delete('schema/foreign-keys')
  @HttpCode(HttpStatus.OK)
  async deleteForeignKey(
    @Body() body: { fromTable: string; toTable: string; fromColumn: string; toColumn: string },
  ) {
    const { fromTable, toTable, fromColumn, toColumn } = body;
    if (!fromTable || !toTable || !fromColumn || !toColumn) {
      throw new Error('Missing required fields: fromTable, toTable, fromColumn, toColumn');
    }
    await this.graphService.deleteForeignKey(fromTable, toTable, fromColumn, toColumn);
    return { success: true };
  }
}
