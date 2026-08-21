import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PayoutDestinationType, PayoutEligibilityStatus } from '@carrental/database';

export class CreatePayoutAccountDto {
  @ApiProperty({ enum: PayoutDestinationType })
  @IsEnum(PayoutDestinationType)
  type!: PayoutDestinationType;

  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) destinationChannel!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(255) accountHolderName!: string;
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(40) accountIdentifier!: string;
}

export class DisablePayoutAccountDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class SetPayoutEligibilityDto {
  @ApiProperty({ enum: PayoutEligibilityStatus })
  @IsEnum(PayoutEligibilityStatus)
  status!: PayoutEligibilityStatus;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class CreatePayoutDto {
  @ApiProperty() @IsUUID() ownerProfileId!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maximumAmountMinor?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() payoutAccountId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class CreatePayoutBatchDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  ownerProfileIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class PayoutApprovalDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) note!: string;
}

export class PayoutReasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
