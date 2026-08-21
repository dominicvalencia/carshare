import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX, CORRELATION_ID_HEADER } from '@carrental/api-contracts';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';

describe('API foundation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ ping: async () => undefined })
      .overrideProvider(RedisService)
      .useValue({ ping: async () => undefined })
      .compile();

    app = module.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix(API_PREFIX);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a successful readiness envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .set(CORRELATION_ID_HEADER, 'phase1-test-correlation')
      .expect(200);

    expect(response.headers[CORRELATION_ID_HEADER]).toBe('phase1-test-correlation');
    expect(response.body).toEqual({
      success: true,
      data: {
        checks: { database: 'up', redis: 'up' },
        status: 'ready',
      },
    });
  });

  it('creates a correlation ID when one is not supplied', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(response.headers[CORRELATION_ID_HEADER]).toMatch(/^[A-Za-z0-9-]{8,128}$/);
  });

  it('uses the standardized error envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/missing').expect(404);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'NOT_FOUND',
      },
    });
  });
});
