import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  BookingAmendmentFinancialDirection,
  BookingAmendmentScope,
  BookingAmendmentStatus,
  BookingStatus,
} from '@carrental/database';
import { IsBooleanString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminBookingAmendmentQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() query?: string;
  @ApiPropertyOptional({ enum: BookingAmendmentStatus })
  @IsOptional()
  @IsEnum(BookingAmendmentStatus)
  status?: BookingAmendmentStatus;
  @ApiPropertyOptional({ enum: BookingAmendmentFinancialDirection })
  @IsOptional()
  @IsEnum(BookingAmendmentFinancialDirection)
  direction?: BookingAmendmentFinancialDirection;
  @ApiPropertyOptional({ enum: BookingAmendmentScope })
  @IsOptional()
  @IsEnum(BookingAmendmentScope)
  scope?: BookingAmendmentScope;
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  bookingStatus?: BookingStatus;
  @ApiPropertyOptional() @IsOptional() @IsBooleanString() reconciliationRequired?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
