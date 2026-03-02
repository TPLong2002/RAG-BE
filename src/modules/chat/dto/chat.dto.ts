import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';
import { LLMProvider } from '../../../common/types';

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  question: string;

  @IsString()
  @IsNotEmpty()
  provider: LLMProvider;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsArray()
  @IsOptional()
  documentIds?: string[];
}
