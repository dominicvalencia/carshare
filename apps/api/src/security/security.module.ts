import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { RateLimitService } from './rate-limit.service';
import { SecurityEventService } from './security-event.service';

@Global()
@Module({
  exports: [CryptoService, RateLimitService, SecurityEventService],
  providers: [CryptoService, RateLimitService, SecurityEventService],
})
export class SecurityModule {}
