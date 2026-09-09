import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, Matches } from 'class-validator';
import type { OwnerAnalyticsPeriod } from './owner-analytics.period';

export enum OwnerAnalyticsPeriodValue {
  TODAY = 'TODAY',
  THIS_WEEK = 'THIS_WEEK',
  THIS_MONTH = 'THIS_MONTH',
  CUSTOM = 'CUSTOM',
}

export class OwnerAnalyticsQueryDto {
  @ApiProperty({ enum: OwnerAnalyticsPeriodValue })
  @IsEnum(OwnerAnalyticsPeriodValue)
  period!: OwnerAnalyticsPeriod;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/u)
  endDate?: string;
}
