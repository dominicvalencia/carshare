import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AddressMatchAssessment } from '@carrental/database';

export const RENTER_DRAFT_STAGES = [
  'PERSONAL_INFORMATION',
  'RESIDENTIAL_ADDRESS',
  'DRIVER_INFORMATION',
  'EMERGENCY_CONTACT',
] as const;

export const EMERGENCY_CONTACT_RELATIONSHIPS = [
  'PARENT',
  'SPOUSE',
  'SIBLING',
  'CHILD',
  'RELATIVE',
  'GUARDIAN',
  'FRIEND',
  'PARTNER',
  'COLLEAGUE',
  'OTHER',
] as const;

const legalName = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;

export class UpdateRenterVerificationProfileDto {
  @ApiProperty({ enum: RENTER_DRAFT_STAGES }) @IsIn(RENTER_DRAFT_STAGES) stage!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(legalName)
  legalFirstName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(legalName)
  middleName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(legalName)
  legalLastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) regionCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) addressScopeCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) provinceCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) cityMunicipalityCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) barangayCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}$/) postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]$/)
  driverLicenseNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) driverLicenseExpiry?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  driverLicenseClass?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  driverLicenseRestrictions?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) emergencyContactMobile?: string;
  @ApiPropertyOptional({ enum: EMERGENCY_CONTACT_RELATIONSHIPS })
  @IsOptional()
  @IsIn(EMERGENCY_CONTACT_RELATIONSHIPS)
  emergencyContactRelation?: string;
  @ApiPropertyOptional()
  @ValidateIf(
    (input: UpdateRenterVerificationProfileDto) => input.emergencyContactRelation === 'OTHER',
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  emergencyContactRelationOther?: string;
}

export class AttachRenterDocumentDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) definitionCode!: string;
  @ApiProperty() @IsUUID() fileAssetId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) expiresAt?: string;
}

export class VerificationDecisionDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class AddressAssessmentDto {
  @ApiProperty({ enum: AddressMatchAssessment })
  @IsIn(Object.values(AddressMatchAssessment))
  assessment!: AddressMatchAssessment;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
