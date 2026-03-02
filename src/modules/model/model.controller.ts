import { Controller, Get } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';

@Controller('api/models')
export class ModelController {
  constructor(
    private llmService: LlmService,
    private embeddingsService: EmbeddingsService,
  ) {}

  @Get('llm')
  getLlmModels() {
    return { models: this.llmService.getLLMModels() };
  }

  @Get('embedding')
  getEmbeddingModels() {
    return { models: this.embeddingsService.getEmbeddingModels() };
  }
}
