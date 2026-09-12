import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  EndFulfillmentMethod,
  StartFulfillmentMethod,
  VehicleFuelType,
  VehiclePowertrain,
  VehicleTransmission,
} from '@carrental/database';

export enum VehicleSearchSort {
  RECOMMENDED = 'RECOMMENDED',
  DISTANCE = 'DISTANCE',
  PRICE_LOW_TO_HIGH = 'PRICE_LOW_TO_HIGH',
  PRICE_HIGH_TO_LOW = 'PRICE_HIGH_TO_LOW',
  NEWEST = 'NEWEST',
}

export enum VehicleHandoverFilter {
  ANY = 'ANY',
  PICKUP_AVAILABLE = 'PICKUP_AVAILABLE',
  DELIVERY_AVAILABLE = 'DELIVERY_AVAILABLE',
  PICKUP_AND_DELIVERY = 'PICKUP_AND_DELIVERY',
}

export enum VehicleSearchMode {
  LIST = 'LIST',
  MAP = 'MAP',
}

const commaSeparated = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : value;

export class SearchVehiclesDto {
  @ApiProperty() @IsString() latitude!: string;
  @ApiProperty() @IsString() longitude!: string;
  @ApiProperty({ maximum: 100, minimum: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  radius!: number;
  @ApiPropertyOptional({ enum: VehicleSearchMode, default: VehicleSearchMode.LIST })
  @IsOptional()
  @IsEnum(VehicleSearchMode)
  mode: VehicleSearchMode = VehicleSearchMode.LIST;
  @ApiPropertyOptional() @IsOptional() @IsDateString() start?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() end?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) make?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) model?: string;
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
  @ApiPropertyOptional() @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(20) seats?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsOptional() @IsInt() @Min(0) minPrice?: number;
  @ApiPropertyOptional() @Type(() => Number) @IsOptional() @IsInt() @Min(0) maxPrice?: number;
  @ApiPropertyOptional({ type: [String] })
  @Transform(commaSeparated)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  featureIds?: string[];
  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true')
  @IsOptional()
  unlimitedMileage?: boolean;
  @ApiPropertyOptional({ enum: VehicleSearchSort, default: VehicleSearchSort.RECOMMENDED })
  @IsOptional()
  @IsEnum(VehicleSearchSort)
  sort: VehicleSearchSort = VehicleSearchSort.RECOMMENDED;
  @ApiPropertyOptional({ enum: VehicleHandoverFilter, default: VehicleHandoverFilter.ANY })
  @IsOptional()
  @IsEnum(VehicleHandoverFilter)
  handover: VehicleHandoverFilter = VehicleHandoverFilter.ANY;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) cursor?: string;
  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}

export class AvailabilityQueryDto {
  @ApiProperty() @IsDateString() start!: string;
  @ApiProperty() @IsDateString() end!: string;
}

export class FulfillmentDestinationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) barangay?: string;
  @ApiProperty() @IsString() @MaxLength(120) city!: string;
  @ApiProperty() @IsString() @MaxLength(120) province!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(12) postalCode?: string;
  @ApiPropertyOptional({ default: 'PH' }) @IsOptional() @IsString() @MaxLength(2) country = 'PH';
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
}

export class CreatePricingQuoteDto extends AvailabilityQueryDto {
  @ApiPropertyOptional({
    enum: StartFulfillmentMethod,
    default: StartFulfillmentMethod.RENTER_PICKUP,
  })
  @IsOptional()
  @IsEnum(StartFulfillmentMethod)
  startMethod: StartFulfillmentMethod = StartFulfillmentMethod.RENTER_PICKUP;

  @ApiPropertyOptional({ enum: EndFulfillmentMethod, default: EndFulfillmentMethod.RENTER_RETURN })
  @IsOptional()
  @IsEnum(EndFulfillmentMethod)
  endMethod: EndFulfillmentMethod = EndFulfillmentMethod.RENTER_RETURN;

  @ApiPropertyOptional({ type: FulfillmentDestinationDto })
  @ValidateIf(
    (input: CreatePricingQuoteDto) => input.startMethod === StartFulfillmentMethod.OWNER_DELIVERY,
  )
  @ValidateNested()
  @Type(() => FulfillmentDestinationDto)
  deliveryDestination?: FulfillmentDestinationDto;

  @ApiPropertyOptional({ type: FulfillmentDestinationDto })
  @ValidateIf(
    (input: CreatePricingQuoteDto) =>
      input.endMethod === EndFulfillmentMethod.OWNER_COLLECTION && !input.collectionSameAsDelivery,
  )
  @ValidateNested()
  @Type(() => FulfillmentDestinationDto)
  collectionDestination?: FulfillmentDestinationDto;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  collectionSameAsDelivery = false;
}

export class FavoriteVehicleParamDto {
  @ApiProperty() @IsUUID() vehicleId!: string;
}
