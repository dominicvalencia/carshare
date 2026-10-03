import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OwnerFinancialActivityScope } from '@carrental/api-contracts';

export class OwnerFinancialActivityQueryDto {
  @ApiPropertyOptional({ enum: OwnerFinancialActivityScope })
  @IsOptional()
  @IsEnum(OwnerFinancialActivityScope)
  scope: OwnerFinancialActivityScope = OwnerFinancialActivityScope.UPCOMING;

  @ApiPropertyOptional({ default: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}
