import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { PersonasService } from './personas.service';

@Module({ controllers: [UsersController], providers: [PersonasService] })
export class UsersModule {}
