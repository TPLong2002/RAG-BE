import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateCollectionDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateCollectionDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class AddDocumentsDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  documentIds: string[];
}
