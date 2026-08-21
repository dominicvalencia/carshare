import { Global, Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard';
import { PolicyGuard } from './policy.guard';
import { OptionalAccessTokenGuard } from './optional-access-token.guard';

@Global()
@Module({
  exports: [AccessTokenGuard, OptionalAccessTokenGuard, PolicyGuard],
  providers: [AccessTokenGuard, OptionalAccessTokenGuard, PolicyGuard],
})
export class AuthorizationModule {}
