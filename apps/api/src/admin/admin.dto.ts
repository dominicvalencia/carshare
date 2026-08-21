import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OwnerProfileStatus, UserStatus } from '@carrental/database';
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
