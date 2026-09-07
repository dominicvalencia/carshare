import './instrument';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { API_PREFIX } from '@carrental/api-contracts';
import { createLogger } from '@carrental/logger';
import type { ApiEnvironment } from '@carrental/config';
import { AppModule } from './app.module';
import { apiTelemetry } from './instrument';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const configuration = app.get<ConfigService<ApiEnvironment, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({
    credentials: true,
    origin: configuration.getOrThrow('CORS_ORIGINS', { infer: true }),
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  const openApiConfiguration = new DocumentBuilder()
    .setTitle('Car Rental Platform API')
    .setDescription('Versioned REST API for the peer-to-peer car rental marketplace.')
    .setVersion('1.0')
    .addBearerAuth(undefined, 'bearer')
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfiguration);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/openapi.json',
  });

  await app.listen(
    configuration.getOrThrow('API_PORT', { infer: true }),
    configuration.getOrThrow('API_HOST', { infer: true }),
  );
}

void bootstrap().catch((error: unknown) => {
  apiTelemetry.captureException(error, {
    name: 'api.bootstrap.failed',
    environment: process.env.APP_ENV ?? 'local',
    release: process.env.RELEASE_VERSION ?? 'development',
    context: { route: 'bootstrap' },
  });
  const logger = createLogger({
    environment: process.env.APP_ENV ?? 'local',
    level: process.env.LOG_LEVEL ?? 'error',
    service: 'api-bootstrap',
  });
  logger.fatal({ err: error }, 'API bootstrap failed');
  process.exitCode = 1;
});
