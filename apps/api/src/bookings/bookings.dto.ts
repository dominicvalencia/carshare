import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EndFulfillmentMethod, StartFulfillmentMethod } from '@carrental/database';

export class AmendmentDestinationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) barangay?: string;
  @ApiProperty() @IsString() @MaxLength(120) city!: string;
  @ApiProperty() @IsString() @MaxLength(120) province!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(12) postalCode?: string;
  @ApiPropertyOptional({ default: 'PH' }) @IsOptional() @IsString() @MaxLength(2) country?: string;
  @ApiProperty() @IsNumber() @IsLatitude() latitude!: number;
  @ApiProperty() @IsNumber() @IsLongitude() longitude!: number;
}

export class BookingAmendmentPreviewDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) proposedPickupAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) proposedReturnAt?: string;
  @ApiPropertyOptional({ enum: StartFulfillmentMethod })
  @IsOptional()
  @IsEnum(StartFulfillmentMethod)
  proposedStartMethod?: StartFulfillmentMethod;
  @ApiPropertyOptional({ enum: EndFulfillmentMethod })
  @IsOptional()
  @IsEnum(EndFulfillmentMethod)
  proposedEndMethod?: EndFulfillmentMethod;
  @ApiPropertyOptional({ nullable: true, type: AmendmentDestinationDto })
  @IsOptional()
  @Type(() => AmendmentDestinationDto)
  @ValidateNested()
  proposedDeliveryDestination?: AmendmentDestinationDto | null;
  @ApiPropertyOptional({ nullable: true, type: AmendmentDestinationDto })
  @IsOptional()
  @Type(() => AmendmentDestinationDto)
  @ValidateNested()
  proposedCollectionDestination?: AmendmentDestinationDto | null;
}

export class SubmitBookingAmendmentDto {
  @ApiProperty() @IsString() @MinLength(16) @MaxLength(20_000) previewToken!: string;
}

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
