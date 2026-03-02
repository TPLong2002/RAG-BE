import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { Neo4jModule } from './modules/neo4j/neo4j.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { LlmModule } from './modules/llm/llm.module';
import { ChatModule } from './modules/chat/chat.module';
import { DocumentModule } from './modules/document/document.module';
import { ModelModule } from './modules/model/model.module';
import { GraphModule } from './modules/graph/graph.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    Neo4jModule,
    EmbeddingsModule,
    LlmModule,
    ChatModule,
    DocumentModule,
    ModelModule,
    GraphModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
