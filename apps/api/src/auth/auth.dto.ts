import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { OtpPurpose, SessionPlatform } from '@carrental/database';

export class DeviceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) deviceIdentifier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) deviceName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) appVersion?: string;
  @ApiPropertyOptional({ enum: SessionPlatform })
  @IsOptional()
  @IsEnum(SessionPlatform)
  platform: SessionPlatform = SessionPlatform.UNKNOWN;
}

export class RegisterDto extends DeviceDto {
  @ApiProperty() @IsEmail() @MaxLength(320) email!: string;
  @ApiProperty() @IsString() @Length(12, 128) password!: string;
  @ApiPropertyOptional() @IsOptional() @IsPhoneNumber('PH') mobileNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) lastName?: string;
}

export class LoginDto extends DeviceDto {
  @ApiProperty({ description: 'Email address or Philippine mobile number' })
  @IsString()
  @MaxLength(320)
  identifier!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
}

export class StaffAccessLoginDto extends DeviceDto {
  @ApiProperty() @IsPhoneNumber('PH') mobileNumber!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
}

export class RefreshDto {
  @ApiPropertyOptional({
    description: 'Required for mobile; admin web may use its HttpOnly cookie.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class TokenDto {
  @ApiProperty() @IsString() token!: string;
}

export class EmailDto {
  @ApiProperty() @IsEmail() @MaxLength(320) email!: string;
}

export class PasswordResetDto extends TokenDto {
  @ApiProperty() @IsString() @Length(12, 128) newPassword!: string;
}

export class OtpRequestDto extends DeviceDto {
  @ApiProperty() @IsPhoneNumber('PH') mobileNumber!: string;
  @ApiProperty({ enum: [OtpPurpose.LOGIN] }) @IsIn([OtpPurpose.LOGIN]) purpose!: OtpPurpose;
}

export class MobileVerificationRequestDto extends DeviceDto {
  @ApiProperty() @IsPhoneNumber('PH') mobileNumber!: string;
}

export class OtpVerifyDto extends DeviceDto {
  @ApiProperty() @IsUUID() challengeId!: string;
  @ApiProperty() @IsString() @Length(6, 6) code!: string;
}
