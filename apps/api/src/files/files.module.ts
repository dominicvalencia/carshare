import { Module } from '@nestjs/common';
import { FilesController, SignedFileAccessController } from './files.controller';
import { FilesService } from './files.service';
import { LocalObjectStorageProvider, ObjectStorageProvider } from './object-storage.provider';

@Module({
  controllers: [FilesController, SignedFileAccessController],
  exports: [FilesService],
  providers: [
    FilesService,
    { provide: ObjectStorageProvider, useClass: LocalObjectStorageProvider },
  ],
})
export class FilesModule {}
