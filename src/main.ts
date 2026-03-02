import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Neo4jService } from './modules/neo4j/neo4j.service';
import { EmbeddingsService } from './modules/embeddings/embeddings.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe());
  app.enableCors();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3001;

  await app.listen(port);

  console.log(`Backend running on http://localhost:${port}`);

  // Initialize Neo4j after app is fully started
  try {
    const neo4jService = app.get(Neo4jService);
    const embeddingsService = app.get(EmbeddingsService);
    const defaultModel = configService.get<string>('embedding.defaultModel', 'text-embedding-3-small');
    const dim = embeddingsService.getEmbeddingDimension(defaultModel);
    await neo4jService.initNeo4j(dim);
  } catch (err) {
    console.error('Neo4j init failed (graph features disabled):', err);
  }
}

bootstrap();
