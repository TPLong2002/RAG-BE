import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Neo4jModule } from '../neo4j/neo4j.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { LlmModule } from '../llm/llm.module';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [Neo4jModule, EmbeddingsModule, LlmModule, GraphModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
