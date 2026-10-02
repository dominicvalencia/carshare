import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum OwnerAmendmentListScope {
  NEEDS_RESPONSE = 'NEEDS_RESPONSE',
  UPCOMING = 'UPCOMING',
  ALL = 'ALL',
}

export class OwnerBookingAmendmentQueryDto {
  @ApiPropertyOptional({ enum: OwnerAmendmentListScope, default: OwnerAmendmentListScope.ALL })
  @IsOptional()
  @IsEnum(OwnerAmendmentListScope)
  scope: OwnerAmendmentListScope = OwnerAmendmentListScope.ALL;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}
