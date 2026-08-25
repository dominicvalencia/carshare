import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReviewModerationStatus, ReviewType } from '@carrental/database';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ enum: ReviewType }) @IsEnum(ReviewType) type!: ReviewType;
  @ApiProperty() @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiProperty() @IsObject() categoryRatings!: Record<string, number>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) text?: string;
}
export class ModerateReviewDto {
  @ApiProperty({ enum: ReviewModerationStatus })
  @IsEnum(ReviewModerationStatus)
  status!: ReviewModerationStatus;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
