import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { FileClassification } from '@carrental/database';

export class UploadFileDto {
  @ApiProperty({ enum: FileClassification })
  @IsEnum(FileClassification)
  classification!: FileClassification;
}
