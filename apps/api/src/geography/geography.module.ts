import { Module } from '@nestjs/common';
import { GeographyController } from './geography.controller';
import { GeographyService } from './geography.service';

@Module({
  controllers: [GeographyController],
  exports: [GeographyService],
  providers: [GeographyService],
})
export class GeographyModule {}
