import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const cancellationReasons = [
  'CHANGE_OF_PLANS',
  'BOOKED_ANOTHER_VEHICLE',
  'TRIP_CANCELLED',
  'SCHEDULE_CHANGED',
  'VEHICLE_OR_LISTING_CONCERN',
  'VEHICLE_UNAVAILABLE',
  'VEHICLE_MAINTENANCE',
  'OWNER_SCHEDULE_CONFLICT',
  'RENTER_OR_TRIP_CONCERN',
  'SAFETY_CONCERN',
  'EMERGENCY',
  'PLATFORM_SYSTEM_FAULT',
  'PAYMENT_OR_FRAUD_RISK',
  'SAFETY_INTERVENTION',
  'POLICY_VIOLATION',
  'IDENTITY_OR_ELIGIBILITY',
  'LEGAL_OR_REGULATORY',
  'FORCE_MAJEURE',
  'DUPLICATE_OR_INVALID_BOOKING',
  'OTHER',
  'OTHER_APPROVED',
] as const;

export class CancellationPreviewDto {
  @ApiProperty({ enum: cancellationReasons })
  @IsIn(cancellationReasons)
  reasonCode!: (typeof cancellationReasons)[number];

  @ApiPropertyOptional()
  @ValidateIf(
    (input: CancellationPreviewDto) => input.reasonCode === 'OTHER' || input.detail !== undefined,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  detail?: string;
}

export class ExecuteCancellationDto extends CancellationPreviewDto {
  @ApiProperty() @IsString() @MinLength(32) @MaxLength(2000) previewToken!: string;
}

export const handoverCancellationReasons = [
  'VEHICLE_CONDITION_DIFFERS_FROM_INSPECTION',
  'UNDISCLOSED_DAMAGE',
  'SAFETY_CONCERN',
  'MECHANICAL_OR_WARNING_LIGHT',
  'VEHICLE_CLEANLINESS_OR_CONDITION',
  'VEHICLE_DOES_NOT_MATCH_BOOKING',
  'OWNER_RENTER_COULD_NOT_AGREE',
  'OTHER',
] as const;

export class CreateBookingHoldDto {
  @ApiProperty() @IsUUID() quoteId!: string;
}

export class CancelBookingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class PreCustodyCancellationDto {
  @ApiProperty({ enum: handoverCancellationReasons })
  @IsIn(handoverCancellationReasons)
  reasonCode!: (typeof handoverCancellationReasons)[number];

  @ApiPropertyOptional()
  @ValidateIf(
    (input: PreCustodyCancellationDto) =>
      input.reasonCode === 'OTHER' || input.reasonText !== undefined,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reasonText?: string;
}

export class RejectBookingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
