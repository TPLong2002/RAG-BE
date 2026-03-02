import { IsString, IsOptional } from 'class-validator';
import { EmbeddingProvider } from '../../../common/types';

export class UploadDocumentDto {
  @IsString()
  @IsOptional()
  embeddingProvider?: EmbeddingProvider;

  @IsString()
  @IsOptional()
  embeddingModel?: string;
}
