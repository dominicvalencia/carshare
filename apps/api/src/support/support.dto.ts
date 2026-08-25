import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SupportMessageVisibility,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@carrental/database';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateSupportTicketDto {
  @ApiProperty({ enum: SupportTicketCategory })
  @IsEnum(SupportTicketCategory)
  category!: SupportTicketCategory;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) subject!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(5000) message!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bookingId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() paymentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() claimId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() payoutId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vehicleId?: string;
}
export class AddSupportMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @ApiPropertyOptional({ enum: SupportMessageVisibility })
  @IsOptional()
  @IsEnum(SupportMessageVisibility)
  visibility?: SupportMessageVisibility;
}
export class UpdateSupportTicketDto {
  @ApiPropertyOptional({ enum: SupportTicketStatus })
  @IsOptional()
  @IsEnum(SupportTicketStatus)
  status?: SupportTicketStatus;
  @ApiPropertyOptional({ enum: SupportTicketPriority })
  @IsOptional()
  @IsEnum(SupportTicketPriority)
  priority?: SupportTicketPriority;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedToUserId?: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class ResolveModerationReportDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) outcome?:
    'RESOLVED' | 'DISMISSED';
}
