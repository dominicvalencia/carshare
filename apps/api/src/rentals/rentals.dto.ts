import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InspectionConfirmationDecision,
  HandoverPhase,
  HandoverTravelStatus,
  InspectionAmendmentStatus,
  InspectionConditionCategory,
  InspectionConditionClassification,
  InspectionConditionDisclosureState,
  InspectionConditionVehicleArea,
  InspectionPerspective,
  PostReturnClaimCategory,
  RentalIncidentCategory,
  RentalIncidentSeverity,
  RentalIncidentStatus,
  PickupHandoverOperationsOutcome,
  PickupDiscrepancyResponseType,
  PickupDiscrepancyResolutionDecision,
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

export class UpsertInspectionDraftMediaDto extends InspectionMediaDto {
  @ApiProperty({ description: 'Replace the current perspective slot instead of appending.' })
  @IsBoolean()
  replace!: boolean;
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
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => InspectionMediaDto)
  media!: InspectionMediaDto[];

  @ApiPropertyOptional({ enum: InspectionConditionDisclosureState })
  @IsOptional()
  @IsEnum(InspectionConditionDisclosureState)
  conditionDisclosureState?: InspectionConditionDisclosureState;

  @ApiPropertyOptional({ type: () => [InspectionConditionIssueDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => InspectionConditionIssueDto)
  conditionIssues?: InspectionConditionIssueDto[];
}

export class InspectionConditionIssueDto {
  @ApiPropertyOptional({ description: 'Active vehicle known issue selected for this snapshot.' })
  @IsOptional()
  @IsUUID()
  knownIssueId?: string;
  @ApiPropertyOptional({ description: 'Persist a newly discovered issue for future handovers.' })
  @IsOptional()
  @IsBoolean()
  persistAsKnownIssue?: boolean;
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

export class VerifyPickupDto {
  @ApiProperty({ example: '123456' }) @IsString() @Matches(/^\d{6}$/) code!: string;
}

export class HandoverTravelTransitionDto {
  @ApiProperty({ enum: HandoverPhase })
  @IsEnum(HandoverPhase)
  phase!: HandoverPhase;

  @ApiProperty({ enum: HandoverTravelStatus })
  @IsEnum(HandoverTravelStatus)
  status!: HandoverTravelStatus;
}

export class PickupInspectionReviewDto {
  @ApiProperty({ enum: InspectionConfirmationDecision })
  @IsEnum(InspectionConfirmationDecision)
  decision!: InspectionConfirmationDecision;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;
}

export class PickupDiscrepancyResponseDto {
  @ApiProperty({ enum: PickupDiscrepancyResponseType })
  @IsEnum(PickupDiscrepancyResponseType)
  responseType!: PickupDiscrepancyResponseType;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) responseText!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() acknowledgedConditionIssueId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() referencedInspectionMediaId?: string;
  @ApiPropertyOptional({ type: () => InspectionConditionIssueDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InspectionConditionIssueDto)
  acknowledgedCondition?: InspectionConditionIssueDto;
}

export class PickupDiscrepancyResolutionReviewDto {
  @ApiProperty({ enum: PickupDiscrepancyResolutionDecision })
  @IsEnum(PickupDiscrepancyResolutionDecision)
  decision!: PickupDiscrepancyResolutionDecision;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(1000) reason?: string;
}

export class PickupHandoverOperationsResolutionDto {
  @ApiProperty({ enum: PickupHandoverOperationsOutcome })
  @IsEnum(PickupHandoverOperationsOutcome)
  outcome!: PickupHandoverOperationsOutcome;

  @ApiProperty() @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
  @ApiProperty() @IsUUID() incidentId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() disputeId?: string;
}

export class ReturnConfirmationDto {
  @ApiProperty({ enum: InspectionConfirmationDecision })
  @IsEnum(InspectionConfirmationDecision)
  decision!: InspectionConfirmationDecision;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(1000) reason?: string;
}

export class HandoverEvidenceWaiverDto {
  @ApiProperty() @IsIn(['HANDOVER_EVIDENCE_WAIVER_V1']) acknowledgementVersion!: string;
  @ApiProperty() @IsIn([true]) acknowledged!: boolean;
  @ApiPropertyOptional({
    description: 'Required participant-reported physical handover or Return time.',
  })
  @IsOptional()
  @IsDateString()
  reportedPhysicalHandoverAt?: string;
}

export class PickupHandoverResponseDto {
  @ApiProperty({ enum: ['CONFIRMED', 'DISPUTED', 'NOT_RECEIVED'] })
  @IsIn(['CONFIRMED', 'DISPUTED', 'NOT_RECEIVED'])
  decision!: 'CONFIRMED' | 'DISPUTED' | 'NOT_RECEIVED';

  @ApiPropertyOptional({ description: 'Required only when proposing a different handover time.' })
  @IsOptional()
  @IsDateString()
  proposedPhysicalHandoverAt?: string;
}

export class ConfirmVehicleReceiptDto {
  @ApiProperty() @IsIn([true]) vehicleReceived!: boolean;
}

export class OverdueHandoverRecoveryDto {
  @ApiProperty({ enum: ['START', 'RETURN', 'BOTH'] })
  @IsIn(['START', 'RETURN', 'BOTH'])
  scope!: 'START' | 'RETURN' | 'BOTH';
  @ApiPropertyOptional() @IsOptional() @IsDateString() reportedPickupAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() reportedReturnAt?: string;
  @ApiProperty() @IsIn(['OVERDUE_HANDOVER_RECOVERY_V1']) acknowledgementVersion!: string;
  @ApiProperty() @IsIn([true]) acknowledged!: boolean;
}

export class OverdueHandoverRecoveryResponseDto {
  @ApiProperty({ enum: ['CONFIRMED', 'DISPUTED'] })
  @IsIn(['CONFIRMED', 'DISPUTED'])
  decision!: 'CONFIRMED' | 'DISPUTED';
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

export class RequestInspectionCorrectionDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,15}$/)
  proposedOdometerMeters?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  proposedFuelBasisPoints?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  proposedBatterySocBasisPoints?: number;
}

export class ReviewInspectionCorrectionDto {
  @ApiProperty() @IsBoolean() approved!: boolean;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(1000) reason!: string;
}

export class AdminInspectionCorrectionQueryDto {
  @ApiPropertyOptional({ enum: InspectionAmendmentStatus })
  @IsOptional()
  @IsEnum(InspectionAmendmentStatus)
  status?: InspectionAmendmentStatus;
}
