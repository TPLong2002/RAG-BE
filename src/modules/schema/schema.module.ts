import { Module } from '@nestjs/common';
import { SchemaController } from './schema.controller';
import { SchemaService } from './schema.service';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { MssqlModule } from '../mssql/mssql.module';

@Module({
  imports: [Neo4jModule, MssqlModule],
  controllers: [SchemaController],
  providers: [SchemaService],
  exports: [SchemaService],
})
export class SchemaModule {}
