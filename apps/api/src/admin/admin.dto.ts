import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminRole, AdminStatus, OwnerProfileStatus, UserStatus } from '@carrental/database';
import { LoginDto } from '../auth/auth.dto';

export class AdminLoginDto extends LoginDto {}

export class AdminUserQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(320) query?: string;
}

export class AdminOwnerQueryDto {
  @ApiPropertyOptional({ enum: OwnerProfileStatus })
  @IsOptional()
  @IsEnum(OwnerProfileStatus)
  status?: OwnerProfileStatus;
}

export class ChangeUserStatusDto {
  @ApiProperty({ enum: UserStatus }) @IsEnum(UserStatus) status!: UserStatus;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class AdminReasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class AdminStaffQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(320) query?: string;
  @ApiPropertyOptional({ enum: AdminRole }) @IsOptional() @IsEnum(AdminRole) role?: AdminRole;
  @ApiPropertyOptional({ enum: AdminStatus })
  @IsOptional()
  @IsEnum(AdminStatus)
  status?: AdminStatus;
}

export class CreateAdminStaffDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(150) displayName!: string;
  @ApiProperty() @IsEmail() @MaxLength(320) email!: string;
  @ApiProperty({ enum: AdminRole }) @IsEnum(AdminRole) role!: AdminRole;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateAdminStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  displayName?: string;
  @ApiPropertyOptional({ enum: AdminRole }) @IsOptional() @IsEnum(AdminRole) role?: AdminRole;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}

export class ActivateAdminInvitationDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(500) token!: string;
  @ApiProperty() @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
