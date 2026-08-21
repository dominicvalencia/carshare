import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabaseClient, PrismaClient } from '@carrental/database';
import type { ApiEnvironment } from '@carrental/config';

@Injectable()
export class DatabaseService implements OnApplicationShutdown, OnModuleInit {
  readonly client: PrismaClient;

  constructor(@Inject(ConfigService) configuration: ConfigService<ApiEnvironment, true>) {
    this.client = createDatabaseClient(configuration.getOrThrow('DATABASE_URL', { infer: true }));
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
}
