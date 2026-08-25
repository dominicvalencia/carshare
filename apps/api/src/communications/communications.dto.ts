import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CursorQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cursor?: string;
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}

export class SendMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) body!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() replyToMessageId?: string;
}

export class MarkConversationReadDto {
  @ApiProperty() @IsUUID() messageId!: string;
}

export class ReportContentDto {
  @ApiProperty({ enum: ['MESSAGE', 'REVIEW', 'USER'] })
  @IsIn(['MESSAGE', 'REVIEW', 'USER'])
  targetType!: 'MESSAGE' | 'REVIEW' | 'USER';
  @ApiProperty() @IsUUID() targetId!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(3000) details?: string;
}

export class ModerateMessageDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
