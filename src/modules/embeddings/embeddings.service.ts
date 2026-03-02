import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import type { Embeddings } from '@langchain/core/embeddings';
import type { EmbeddingProvider } from '../../common/types';

@Injectable()
export class EmbeddingsService {
  constructor(private configService: ConfigService) {}

  createEmbeddings(provider: EmbeddingProvider, model: string): Embeddings {
    const apiKeys = this.configService.get('apiKeys');

    switch (provider) {
      case 'openai':
        return new OpenAIEmbeddings({
          apiKey: apiKeys.openai,
          model,
        });
      case 'google':
        return new GoogleGenerativeAIEmbeddings({
          apiKey: apiKeys.google,
          model,
        });
      default:
        throw new Error(`Unsupported embedding provider: ${provider}`);
    }
  }

  getEmbeddingDimension(model: string): number {
    const dimensions = this.configService.get<Record<string, number>>('embeddingDimensions', {});
    return dimensions[model] ?? 1536;
  }

  getEmbeddingModels(): Record<EmbeddingProvider, { id: string; name: string }[]> {
    return {
      openai: [
        { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large (3072d)' },
        { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small (1536d)' },
        { id: 'text-embedding-ada-002', name: 'Ada 002 (1536d)' },
      ],
      google: [
        { id: 'gemini-embedding-001', name: 'Gemini Embedding 001 (3072d)' },
      ],
    };
  }
}
