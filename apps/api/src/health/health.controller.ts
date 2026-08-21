import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck } from '@nestjs/terminus';
import { ReadinessService } from './readiness.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

  @Get()
  @ApiOperation({ summary: 'Return API service health information' })
  health() {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    } as const;
  }

  @Get('live')
  @HealthCheck()
  @ApiOperation({ summary: 'Report whether the API process is alive' })
  live() {
    return { status: 'alive' } as const;
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Check required database and Redis dependencies' })
  ready() {
    return this.readiness.check();
  }
}
