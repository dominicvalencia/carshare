import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global()
@Module({ exports: [AuditService], providers: [AuditService] })
export class AuditModule {}
