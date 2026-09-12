import { Module } from '@nestjs/common';
import { GoogleLocationProvider } from './google-location.provider';
import { LocationsController } from './locations.controller';

@Module({ controllers: [LocationsController], providers: [GoogleLocationProvider] })
export class LocationsModule {}
