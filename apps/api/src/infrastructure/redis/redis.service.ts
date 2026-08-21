import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { ApiEnvironment } from '@carrental/config';

@Injectable()
export class RedisService implements OnApplicationShutdown, OnModuleInit {
  private readonly client: Redis;

  constructor(@Inject(ConfigService) configuration: ConfigService<ApiEnvironment, true>) {
    this.client = new Redis(configuration.getOrThrow('REDIS_URL', { infer: true }), {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async consumeLimit(key: string, limit: number, windowSeconds: number): Promise<number> {
    const result = await this.client.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
      1,
      key,
      windowSeconds,
    );
    const count = Number(result);
    return limit - count;
  }
}
