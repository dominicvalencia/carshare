import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InspectionConfirmationDecision,
  InspectionPerspective,
  PostReturnClaimCategory,
  RentalIncidentCategory,
  RentalIncidentSeverity,
  RentalIncidentStatus,
} from '@carrental/database';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InspectionMediaDto {
  @ApiProperty() @IsUUID() fileAssetId!: string;
  @ApiProperty({ enum: InspectionPerspective })
  @IsEnum(InspectionPerspective)
  perspective!: InspectionPerspective;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) evidenceSequence?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() clientCapturedAt?: string;
}

export class SubmitInspectionDto {
  @ApiProperty({ example: '20000000', description: 'Normalized integer odometer metres.' })
  @IsString()
  @Matches(/^\d{1,15}$/)
  odometerMeters!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  fuelBasisPoints?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  batterySocBasisPoints?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) notes?: string;

  @ApiProperty({ type: [InspectionMediaDto] })
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => InspectionMediaDto)
  media!: InspectionMediaDto[];
}

export class VerifyPickupDto {
  @ApiProperty({ example: '123456' }) @IsString() @Matches(/^\d{6}$/) code!: string;
}

export class ReturnConfirmationDto {
  @ApiProperty({ enum: InspectionConfirmationDecision })
  @IsEnum(InspectionConfirmationDecision)
  decision!: InspectionConfirmationDecision;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(1000) reason?: string;
}

export class CreateClaimDto {
  @ApiProperty({ enum: PostReturnClaimCategory })
  @IsEnum(PostReturnClaimCategory)
  category!: PostReturnClaimCategory;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(3000) description!: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  evidenceFileIds?: string[];
}

export class CreateIncidentDto {
  @ApiProperty({ enum: RentalIncidentCategory })
  @IsEnum(RentalIncidentCategory)
  category!: RentalIncidentCategory;
  @ApiProperty({ enum: RentalIncidentSeverity })
  @IsEnum(RentalIncidentSeverity)
  severity!: RentalIncidentSeverity;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(3000) description!: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  evidenceFileIds?: string[];
}

export class OperationalHoldDto {
  @ApiProperty() @IsBoolean() hold!: boolean;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

export class IncidentStatusDto {
  @ApiProperty({ enum: RentalIncidentStatus })
  @IsEnum(RentalIncidentStatus)
  status!: RentalIncidentStatus;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}

export class AdminHandoverResolutionDto {
  @ApiProperty({ enum: ['CONFIRM_PICKUP', 'CONFIRM_RETURN'] })
  @IsIn(['CONFIRM_PICKUP', 'CONFIRM_RETURN'])
  action!: 'CONFIRM_PICKUP' | 'CONFIRM_RETURN';
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() occurredAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() incidentId?: string;
}
