import { HttpStatus, Injectable } from '@nestjs/common';
import { IdentityErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { RedisService } from '../infrastructure/redis/redis.service';
import { CryptoService } from './crypto.service';

@Injectable()
export class RateLimitService {
  constructor(
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
  ) {}

  async assertAllowed(
    scope: string,
    dimensions: readonly string[],
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    for (const dimension of dimensions.filter(Boolean)) {
      const key = `rate:${scope}:${this.crypto.hashIdentifier(dimension)}`;
      const remaining = await this.redis.consumeLimit(key, limit, windowSeconds);
      if (remaining < 0) {
        throw new ApplicationException(
          IdentityErrorCode.RATE_LIMITED,
          'Too many requests. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }
}
