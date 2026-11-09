import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  configureApp(app);

  const port = Number(config.get<string>('PORT') ?? 3000);
  await app.listen(port);

  logger.log(`API escuchando en http://localhost:${port}/api/v1`);
}

void bootstrap();
