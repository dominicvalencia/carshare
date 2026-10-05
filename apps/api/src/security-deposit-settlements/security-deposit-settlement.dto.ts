import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SecurityDepositSettlementReasonDto {
  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  reason!: string;
}

export class PaymentOperationAdminEvidenceDto extends SecurityDepositSettlementReasonDto {
  @ApiProperty({ maxLength: 255, required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerOperationId?: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  providerStatus!: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  reference!: string;
}
