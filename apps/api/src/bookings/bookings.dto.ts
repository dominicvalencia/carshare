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
