import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NotificationCategory,
  NotificationAudience,
  NotificationChannel,
  PushProviderCode,
  SessionPlatform,
} from '@carrental/database';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class NotificationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cursor?: string;
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
  @ApiPropertyOptional({ enum: NotificationAudience })
  @IsOptional()
  @IsEnum(NotificationAudience)
  audience?: NotificationAudience;
}
export class NotificationPreferenceDto {
  @ApiProperty({ enum: NotificationCategory })
  @IsEnum(NotificationCategory)
  category!: NotificationCategory;
  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceDto] })
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceDto)
  preferences!: NotificationPreferenceDto[];
}
export class RegisterPushTokenDto {
  @ApiProperty({ enum: PushProviderCode }) @IsEnum(PushProviderCode) provider!: PushProviderCode;
  @ApiProperty({ enum: SessionPlatform }) @IsEnum(SessionPlatform) platform!: SessionPlatform;
  @ApiProperty() @IsString() @MaxLength(512) token!: string;
  @ApiProperty({ enum: ['local', 'test', 'staging', 'production'] })
  @IsString()
  @MaxLength(20)
  environment!: string;
  @ApiProperty()
  @IsString()
  @MaxLength(160)
  appIdentifier!: string;
}
