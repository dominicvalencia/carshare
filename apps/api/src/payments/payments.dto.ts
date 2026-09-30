import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AmendmentRefundEvidenceOutcome,
  AmendmentRefundEvidenceType,
  CommissionScope,
  PaymentProviderCode,
} from '@carrental/database';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

export class ResolveAmendmentRefundDto {
  @ApiProperty() @IsUUID() amendmentId!: string;
  @ApiProperty() @IsUUID() refundId!: string;
  @ApiProperty() @IsUUID() originalPaymentId!: string;
  @ApiProperty({ enum: PaymentProviderCode })
  @IsEnum(PaymentProviderCode)
  provider!: PaymentProviderCode;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) externalReference!: string;
  @ApiProperty({ enum: AmendmentRefundEvidenceType })
  @IsEnum(AmendmentRefundEvidenceType)
  evidenceType!: AmendmentRefundEvidenceType;
  @ApiProperty() @IsISO8601() evidenceAt!: string;
  @ApiProperty() @IsString() @Matches(/^\d+$/) resolvedAmountMinor!: string;
  @ApiProperty() @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiProperty({ enum: AmendmentRefundEvidenceOutcome })
  @IsEnum(AmendmentRefundEvidenceOutcome)
  outcome!: AmendmentRefundEvidenceOutcome;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) resolutionNote!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(200) idempotencyKey!: string;
}

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
