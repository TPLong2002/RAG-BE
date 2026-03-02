import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LLMProvider } from '../../common/types';

@Injectable()
export class LlmService {
  constructor(private configService: ConfigService) {}

  createLLM(provider: LLMProvider, model: string): BaseChatModel {
    const apiKeys = this.configService.get('apiKeys');
    const aistudio = this.configService.get('aistudio');

    switch (provider) {
      case 'openai':
        return new ChatOpenAI({
          apiKey: apiKeys.openai,
          model,
          streaming: true,
        });
      case 'google':
        return new ChatGoogleGenerativeAI({
          apiKey: apiKeys.google,
          model,
          streaming: true,
        });
      case 'aistudio':
        return new ChatOpenAI({
          apiKey: apiKeys.aistudio,
          model,
          streaming: true,
          configuration: {
            baseURL: aistudio.baseURL,
          },
        });
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }

  getLLMModels(): Record<LLMProvider, { id: string; name: string }[]> {
    return {
      openai: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-4.1', name: 'GPT-4.1' },
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
        { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
        { id: 'gpt-5.2-2025-12-11', name: 'GPT-5.2 (2025-12-11)' },
      ],
      google: [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
        { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash' },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash' },
        { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
      ],
      aistudio: [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (AI Studio)' },
        { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash (AI Studio)' },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (AI Studio)' },
      ],
    };
  }
}
