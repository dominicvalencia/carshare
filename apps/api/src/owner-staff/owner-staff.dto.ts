import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { OwnerStaffRole, OwnerStaffStatus, OwnerStaffVehicleScopeMode } from '@carrental/database';

export enum OwnerStaffPreset {
  MANAGER = 'MANAGER',
  OPERATIONS_STAFF = 'OPERATIONS_STAFF',
  SUPPORT_STAFF = 'SUPPORT_STAFF',
  CUSTOM = 'CUSTOM',
}

export class OwnerStaffQueryDto {
  @ApiPropertyOptional({ enum: OwnerStaffRole })
  @IsOptional()
  @IsEnum(OwnerStaffRole)
  role?: OwnerStaffRole;

  @ApiPropertyOptional({ enum: OwnerStaffStatus })
  @IsOptional()
  @IsEnum(OwnerStaffStatus)
  status?: OwnerStaffStatus;
}

export class InviteOwnerStaffDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(150) displayName!: string;
  @ApiProperty({ example: '09171234567' })
  @IsString()
  @MaxLength(32)
  mobileNumber!: string;
  @ApiProperty({ enum: OwnerStaffRole }) @IsEnum(OwnerStaffRole) role!: OwnerStaffRole;
  @ApiProperty({ enum: OwnerStaffPreset }) @IsEnum(OwnerStaffPreset) preset!: OwnerStaffPreset;
  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((input: InviteOwnerStaffDto) => input.preset === OwnerStaffPreset.CUSTOM)
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
  @ApiProperty({ enum: OwnerStaffVehicleScopeMode })
  @IsEnum(OwnerStaffVehicleScopeMode)
  vehicleScopeMode!: OwnerStaffVehicleScopeMode;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  vehicleIds?: string[];
}

export class UpdateOwnerStaffDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  displayName!: string;
}

export class UpdateOwnerStaffPermissionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateOwnerStaffScopeDto {
  @ApiProperty({ enum: OwnerStaffVehicleScopeMode })
  @IsEnum(OwnerStaffVehicleScopeMode)
  vehicleScopeMode!: OwnerStaffVehicleScopeMode;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  vehicleIds?: string[];
}

export class OwnerStaffReasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class AcceptOwnerStaffInvitationDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(500) token!: string;
}
