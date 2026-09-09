import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminStaffService } from './admin-staff.service';

@Module({ controllers: [AdminController], providers: [AdminService, AdminStaffService] })
export class AdminModule {}
