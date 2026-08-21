import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommissionScope } from '@carrental/database';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCommissionRuleDto {
  @ApiProperty({ enum: CommissionScope }) @IsEnum(CommissionScope) scope!: CommissionScope;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerProfileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vehicleCategoryId?: string;
  @ApiProperty() @IsInt() @Min(0) @Max(10_000) rateBasisPoints!: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) fixedAmountMinor?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minimumAmountMinor?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) maximumAmountMinor?: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class DisableCommissionRuleDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
