import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';

@Module({
  controllers: [HealthController],
  imports: [TerminusModule],
  providers: [ReadinessService],
})
export class HealthModule {}
