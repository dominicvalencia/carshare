import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestPrincipal } from '../security/security-context';
import { UpdateProfileDto } from './users.dto';

@ApiBearerAuth()
@ApiTags('Current user')
@Controller('me')
@UseGuards(AccessTokenGuard)
export class UsersController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  getMe(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.database.client.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: {
        createdAt: true,
        email: true,
        emailVerifiedAt: true,
        id: true,
        mobileNumber: true,
        mobileVerifiedAt: true,
        ownerProfile: { select: { id: true, status: true } },
        profile: true,
        roles: { select: { role: { select: { code: true } } } },
        status: true,
        verifications: {
          orderBy: { updatedAt: 'desc' },
          select: {
            expiresAt: true,
            rejectionReason: true,
            status: true,
            submittedAt: true,
            type: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  @Patch('profile')
  async updateProfile(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: UpdateProfileDto,
  ) {
    if (input.avatarFileId) {
      await this.database.client.fileAsset.findFirstOrThrow({
        where: { id: input.avatarFileId, uploadedById: principal.userId, status: 'READY' },
      });
    }
    return this.database.client.userProfile.upsert({
      create: {
        userId: principal.userId,
        ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
        ...(input.middleName !== undefined ? { middleName: input.middleName.trim() } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
        ...(input.dateOfBirth ? { dateOfBirth: new Date(input.dateOfBirth) } : {}),
        ...(input.avatarFileId ? { avatarFileId: input.avatarFileId } : {}),
      },
      update: {
        ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
        ...(input.middleName !== undefined ? { middleName: input.middleName.trim() } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
        ...(input.dateOfBirth ? { dateOfBirth: new Date(input.dateOfBirth) } : {}),
        ...(input.avatarFileId ? { avatarFileId: input.avatarFileId } : {}),
      },
      where: { userId: principal.userId },
    });
  }
}
