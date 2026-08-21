import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ClaimAdjudicationOutcome,
  ClaimEvidenceType,
  ClaimResponseDecision,
  DisputeStatus,
  EarningHoldMode,
  EarningHoldReason,
  PostReturnClaimCategory,
  PostReturnClaimStatus,
} from '@carrental/database';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ClaimEvidenceInputDto {
  @ApiProperty() @IsUUID() fileAssetId!: string;
  @ApiPropertyOptional({ enum: ClaimEvidenceType })
  @IsOptional()
  @IsEnum(ClaimEvidenceType)
  evidenceType?: ClaimEvidenceType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class CreatePostReturnClaimDto {
  @ApiProperty({ enum: PostReturnClaimCategory })
  @IsEnum(PostReturnClaimCategory)
  category!: PostReturnClaimCategory;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(3000) description!: string;
  @ApiPropertyOptional({ type: [ClaimEvidenceInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ClaimEvidenceInputDto)
  evidence?: ClaimEvidenceInputDto[];
}

export class AddClaimEvidenceDto {
  @ApiProperty({ type: [ClaimEvidenceInputDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ClaimEvidenceInputDto)
  evidence!: ClaimEvidenceInputDto[];
}

export class ClaimResponseDto {
  @ApiProperty({ enum: ClaimResponseDecision })
  @IsEnum(ClaimResponseDecision)
  decision!: ClaimResponseDecision;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) explanation?: string;
  @ApiPropertyOptional({ type: [ClaimEvidenceInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ClaimEvidenceInputDto)
  evidence?: ClaimEvidenceInputDto[];
}

export class ClaimReasonDto {
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(3000) reason!: string;
}

export class AdminAdjudicateClaimDto extends ClaimReasonDto {
  @ApiProperty({ enum: ClaimAdjudicationOutcome })
  @IsEnum(ClaimAdjudicationOutcome)
  outcome!: ClaimAdjudicationOutcome;
  @ApiPropertyOptional({ description: 'Minor PHP units; only admins may propose this value.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  approvedAmountMinor?: number;
}

export class ClaimListQueryDto {
  @ApiPropertyOptional({ enum: PostReturnClaimStatus })
  @IsOptional()
  @IsEnum(PostReturnClaimStatus)
  status?: PostReturnClaimStatus;
  @ApiPropertyOptional({ enum: PostReturnClaimCategory })
  @IsOptional()
  @IsEnum(PostReturnClaimCategory)
  category?: PostReturnClaimCategory;
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  @ApiPropertyOptional({ description: 'Only claims at least this many hours old.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8_760)
  minimumAgeHours?: number;
}

export class ResolveDisputeDto extends ClaimReasonDto {
  @ApiProperty({ enum: DisputeStatus }) @IsEnum(DisputeStatus) status!: DisputeStatus;
}

export class RefundAdditionalChargeDto extends ClaimReasonDto {
  @ApiProperty() @IsInt() @Min(1) amountMinor!: number;
}

export class CreateEarningHoldDto extends ClaimReasonDto {
  @ApiProperty({ enum: EarningHoldMode }) @IsEnum(EarningHoldMode) mode!: EarningHoldMode;
  @ApiProperty({ enum: EarningHoldReason })
  @IsEnum(EarningHoldReason)
  holdReason!: EarningHoldReason;
  @ApiProperty() @IsInt() @Min(1) amountMinor!: number;
}
