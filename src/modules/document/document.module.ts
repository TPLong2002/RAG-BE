import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { FileParserService } from './file-parser.service';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { GoogleDriveService } from './google-drive.service';

@Module({
  imports: [
    Neo4jModule,
    EmbeddingsModule,
    MulterModule.register({
      dest: './uploads',
    }),
  ],
  controllers: [DocumentController],
  providers: [DocumentService, FileParserService, GoogleDriveService],
})
export class DocumentModule {}
