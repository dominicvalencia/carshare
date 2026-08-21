import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { VehicleFuelType, VehiclePowertrain, VehicleTransmission } from '@carrental/database';

export enum VehicleSearchSort {
  RECOMMENDED = 'RECOMMENDED',
  DISTANCE = 'DISTANCE',
  PRICE_LOW_TO_HIGH = 'PRICE_LOW_TO_HIGH',
  PRICE_HIGH_TO_LOW = 'PRICE_HIGH_TO_LOW',
  NEWEST = 'NEWEST',
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
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) cursor?: string;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class AvailabilityQueryDto {
  @ApiProperty() @IsDateString() start!: string;
  @ApiProperty() @IsDateString() end!: string;
}

export class CreatePricingQuoteDto extends AvailabilityQueryDto {}

export class FavoriteVehicleParamDto {
  @ApiProperty() @IsUUID() vehicleId!: string;
}
