import { Global, Module } from '@nestjs/common';
import { OwnerAccessGuard } from './owner-access.guard';
import { OwnerAccessService } from './owner-access.service';

@Global()
@Module({
  exports: [OwnerAccessGuard, OwnerAccessService],
  providers: [OwnerAccessGuard, OwnerAccessService],
})
export class OwnerAccessModule {}
