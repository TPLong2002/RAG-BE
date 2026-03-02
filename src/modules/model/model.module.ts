import { Module } from '@nestjs/common';
import { ModelController } from './model.controller';
import { LlmModule } from '../llm/llm.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';

@Module({
  imports: [LlmModule, EmbeddingsModule],
  controllers: [ModelController],
})
export class ModelModule {}
