import { IsArray, IsString, IsOptional, IsBoolean } from 'class-validator';

export class ImportTablesDto {
  @IsArray()
  @IsString({ each: true })
  tableNames: string[];

  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

export class CreateForeignKeyDto {
  @IsString()
  fromTable: string;

  @IsString()
  fromColumn: string;

  @IsString()
  toTable: string;

  @IsString()
  toColumn: string;
}

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  columns?: Array<{
    name: string;
    type: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    description?: string;
  }>;
}
