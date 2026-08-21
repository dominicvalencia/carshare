import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../infrastructure/database/database.service';
import { RedisService } from '../infrastructure/redis/redis.service';

type DependencyStatus = 'up' | 'down';

export interface ReadinessResult {
  readonly checks: {
    readonly database: DependencyStatus;
    readonly redis: DependencyStatus;
  };
  readonly status: 'ready';
}

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async check(): Promise<ReadinessResult> {
    const [database, redis] = await Promise.allSettled([this.database.ping(), this.redis.ping()]);
    const checks = {
      database: database.status === 'fulfilled' ? ('up' as const) : ('down' as const),
      redis: redis.status === 'fulfilled' ? ('up' as const) : ('down' as const),
    };

    if (checks.database === 'down' || checks.redis === 'down') {
      throw new ServiceUnavailableException('One or more required dependencies are unavailable.');
    }

    return { checks, status: 'ready' };
  }
}
