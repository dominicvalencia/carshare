import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  Matches,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  AvailabilityPolicyType,
  EvReturnPolicyType,
  FuelReturnPolicyType,
  MileagePolicyType,
  VehicleBlockReason,
  VehicleFuelType,
  InspectionConditionCategory,
  InspectionConditionClassification,
  InspectionConditionVehicleArea,
  VehicleLifecycleStatus,
  VehicleOperationalStatus,
  VehiclePhotoPerspective,
  VehiclePowertrain,
  VehicleTransmission,
} from '@carrental/database';

export class CreateVehicleDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) make?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) model?: string;
}

export class UpdateVehicleDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) make?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) model?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) variant?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1900) @Max(2100) modelYear?: number;
  @ApiPropertyOptional({ enum: VehicleTransmission })
  @IsOptional()
  @IsEnum(VehicleTransmission)
  transmission?: VehicleTransmission;
  @ApiPropertyOptional({ enum: VehiclePowertrain })
  @IsOptional()
  @IsEnum(VehiclePowertrain)
  powertrain?: VehiclePowertrain;
  @ApiPropertyOptional({ enum: VehicleFuelType })
  @IsOptional()
  @IsEnum(VehicleFuelType)
  fuelType?: VehicleFuelType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(20) seatCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(6) doorCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(75) color?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) plateNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) vin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rentalRequirements?: string;
  @ApiPropertyOptional({
    enum: ['DETAILS', 'FEATURES', 'PHOTOS', 'DOCUMENTS', 'LOCATION', 'POLICIES', 'AVAILABILITY'],
  })
  @IsOptional()
  @IsIn(['DETAILS', 'FEATURES', 'PHOTOS', 'DOCUMENTS', 'LOCATION', 'POLICIES', 'AVAILABILITY'])
  lastCompletedSection?: string;
}

export class SetVehicleFeaturesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  featureIds!: string[];
}

export class AddVehiclePhotoDto {
  @ApiProperty() @IsUUID() fileAssetId!: string;
  @ApiProperty({ enum: VehiclePhotoPerspective })
  @IsEnum(VehiclePhotoPerspective)
  perspective!: VehiclePhotoPerspective;
  @ApiProperty() @IsInt() @Min(0) @Max(99) displayOrder!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCover?: boolean;
}

export class VehiclePhotoOrderItemDto {
  @ApiProperty() @IsUUID() photoId!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(99) displayOrder!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isCover?: boolean;
}

export class ReorderVehiclePhotosDto {
  @ApiProperty({ type: [VehiclePhotoOrderItemDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => VehiclePhotoOrderItemDto)
  photos!: VehiclePhotoOrderItemDto[];
}

export class AddVehicleDocumentDto {
  @ApiProperty() @IsUUID() definitionId!: string;
  @ApiProperty() @IsUUID() fileAssetId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() replacesDocumentId?: string;
}

export class SetVehicleLocationDto {
  @ApiProperty() @IsLatitude() latitude!: string;
  @ApiProperty() @IsLongitude() longitude!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) city!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) province!: string;
  @ApiPropertyOptional({ default: 'PH' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
  @ApiPropertyOptional({ default: 'Asia/Manila' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) pickupAreaLabel?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) regionCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) addressScopeCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) provinceCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) cityMunicipalityCode?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{10}$/) barangayCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) barangay?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) landmark?: string;
}

export class CreateVehiclePolicyVersionDto {
  @ApiProperty() @IsInt() @Min(1) dailyRateMinor!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4000)
  shortDurationDiscountBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(4000) weeklyDiscountBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(4000) extendedTripDiscountBps?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(4000) monthlyDiscountBps?: number;
  @ApiPropertyOptional({ default: 'PHP' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
  @ApiProperty() @IsInt() @Min(1) @Max(365) minimumRentalDays!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(365) maximumRentalDays!: number;
  @ApiProperty({ enum: MileagePolicyType })
  @IsEnum(MileagePolicyType)
  mileagePolicy!: MileagePolicyType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) includedKilometersPerDay?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) excessKilometerRateMinor?: number;
  @ApiPropertyOptional({ enum: FuelReturnPolicyType })
  @IsOptional()
  @IsEnum(FuelReturnPolicyType)
  fuelReturnPolicy?: FuelReturnPolicyType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) fuelTolerancePercent?: number;
  @ApiPropertyOptional({ enum: EvReturnPolicyType })
  @IsOptional()
  @IsEnum(EvReturnPolicyType)
  evReturnPolicy?: EvReturnPolicyType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) evRequiredPercentage?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) evTolerancePercent?: number;
  @ApiProperty({ enum: [120, 240, 360, 720, 1440] })
  @IsInt()
  turnaroundMinutes!: number;
  @ApiProperty({ enum: AvailabilityPolicyType })
  @IsEnum(AvailabilityPolicyType)
  availabilityPolicy!: AvailabilityPolicyType;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() monday?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() tuesday?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() wednesday?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() thursday?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() friday?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() saturday?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sunday?: boolean;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  supportsRenterPickup?: boolean;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  supportsOwnerDelivery?: boolean;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  supportsRenterReturn?: boolean;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  supportsOwnerCollection?: boolean;
  @ApiPropertyOptional({ description: 'Shared owner-service radius in meters.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50_000)
  fulfillmentServiceRadiusMeters?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFeeMinor?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  collectionFeeMinor?: number;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_080)
  fulfillmentMinimumNoticeMinutes?: number;
}

export class CreateVehicleBlockDto {
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;
  @ApiProperty({ enum: VehicleBlockReason })
  @IsEnum(VehicleBlockReason)
  reason!: VehicleBlockReason;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) privateNote?: string;
}

export class ChangeOperationalStatusDto {
  @ApiProperty({ enum: VehicleOperationalStatus })
  @IsEnum(VehicleOperationalStatus)
  status!: VehicleOperationalStatus;
}

export class CreateVehicleKnownIssueDto {
  @ApiProperty({ enum: InspectionConditionCategory })
  @IsEnum(InspectionConditionCategory)
  category!: InspectionConditionCategory;
  @ApiProperty({ enum: InspectionConditionVehicleArea })
  @IsEnum(InspectionConditionVehicleArea)
  vehicleArea!: InspectionConditionVehicleArea;
  @ApiProperty({ enum: InspectionConditionClassification })
  @IsEnum(InspectionConditionClassification)
  classification!: InspectionConditionClassification;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) description!: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  evidenceFileAssetIds?: string[];
}

export class UpdateVehicleKnownIssueDto extends CreateVehicleKnownIssueDto {}

export class VehicleReasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class AdminVehicleQueryDto {
  @ApiPropertyOptional({ enum: VehicleLifecycleStatus })
  @IsOptional()
  @IsEnum(VehicleLifecycleStatus)
  status?: VehicleLifecycleStatus;
}
