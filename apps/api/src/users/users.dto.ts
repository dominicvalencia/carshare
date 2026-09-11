import { ApiPropertyOptional } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const selfServicePersonas = ['RENTER', 'OWNER'] as const;
export type SelfServicePersona = (typeof selfServicePersonas)[number];

export class EnrollPersonaDto {
  @ApiProperty({ enum: selfServicePersonas })
  @IsString()
  @IsIn(selfServicePersonas)
  persona!: SelfServicePersona;
}

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) middleName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() avatarFileId?: string;
}
